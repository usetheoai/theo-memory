/**
 * createLocalMemory factory — T7.1 of v0-1-local-runtime plan v1.3.
 *
 * Wires the 5 DIPs (VectorStore, Embedder, LLM, optional HistoryManager,
 * optional ReflectionPolicy) into a runtime Memory facade that exposes the
 * v0.0 contract surface (Memory + ScopedMemory).
 *
 * Embedder dimension probe (EC-5): at construction time, calls
 * embedder.embed('__themem_probe__') once. If the returned vector length
 * != MAX_EMBEDDING_DIM, throws EmbeddingMismatch BEFORE the first user call —
 * turns a runtime-silent-drop into a startup-loud-error.
 *
 * Per ADR-0005, reflection is explicit-only at v0.0; LocalScopedMemory.reflect
 * throws ReflectionNotConfigured unless config.reflectionPolicy is provided.
 *
 * Per ADR-0011 (supersedes ADR-0006 runtime clause): recall honors `options.asOf`
 * from v1.1 on the local runtime; EC-3 boundary validation throws `InvalidScope`
 * when asOf is an invalid Date (NaN).
 *
 * Per EC-12, forget(unknown_id) throws MemoryNotFound.
 * Per EC-13, reset({}) throws InvalidScope (prevents whole-table wipe).
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T7.1
 */
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Tracer } from '@opentelemetry/api';
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

import { MAX_EMBEDDING_DIM } from '../core/constants.js';
import type { ConflictResolutionResult } from '../core/dip/conflict-resolution-policy.js';
import type { Embedder } from '../core/dip/embedder.js';
import {
  type RecallCacheStore,
  type RecallCacheStoreConfig,
  validateRecallCacheStoreConfig,
} from '../core/dip/recall-cache-store.js';
import type { ReflectionPolicy } from '../core/dip/reflection-policy.js';
import type { VectorStore } from '../core/dip/vector-store.js';
// BiTemporalNotSupportedLocally NOT imported here per ADR-0011 — local runtime
// no longer throws it. The class stays exported via src/core/errors.ts →
// src/core/index.ts (public API) so consumers retain the ability to catch it
// for forward-compat with cloud runtime.
import {
  EmbeddingMismatch,
  InvalidCacheConfig,
  InvalidEmbeddingDim,
  InvalidScope,
  MemoryNotFound,
  ReflectionNotConfigured,
} from '../core/errors.js';
import { runExtractionPipeline } from '../core/extraction/pipeline.js';
import type { HistoryEntry } from '../core/history-entry.js';
import { emitEvent } from '../core/memory-event.js';
import type { MemoryItem, MemoryItemWithScore } from '../core/memory-item.js';
import type {
  Memory,
  MemoryConfig,
  ScopedMemory,
} from '../core/memory-store.js';
import type { Message } from '../core/message.js';
import type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from '../core/options.js';
import { executeReflection } from '../core/reflection/execute.js';
import { validateProvenance } from '../core/reflection/provenance.js';
import type { ReflectionResult } from '../core/reflection-result.js';
import { runRetrievalPipeline } from '../core/retrieval/pipeline.js';
import type { Filters, Scope } from '../core/scope.js';
import type { ScopedSkillMemory } from '../core/skill.js';

import {
  CapacityBasedTrigger,
  PgEvictor,
  PgHalfLifePersister,
  PgNearestNeighborProvider,
  TimeBasedTrigger,
  TriadicScoringPolicy,
} from './eviction/index.js';
import type { LocalEvictionConfig } from './eviction/index.js';
import { PgvectorStore as PgvectorStoreClass } from './pgvector-store.js';
import { LocalScopedSkillMemory } from './scoped-skill-memory.js';
import type { VectorStoreWithSkillInsert } from './skill-store-args.js';
// NOTE: `./recall-cache/*` is intentionally DYNAMIC-imported inside
// `resolveRecallCacheStore` so the v1.5 cache impl does NOT enter the default
// `@usetheo/memory` bundle's static-import graph (T4.1 bundle isolation per
// blueprint Rec #3 + EC-26 precedent). Consumers who opt in via
// `recallCache: { ... }` pay the lazy load cost at factory time only.

export { InMemoryVectorStore } from './in-memory-store.js';
export { PgvectorStore } from './pgvector-store.js';
export { DrizzleHistoryManager } from './history-manager.js';
export { entities, history, memories } from './schema.js';
export { StubEmbedder, StubLLM } from './stubs.js';
// v0.7 T2.1 — re-export conflict-resolution policies for convenience
// (integration tests + consumer apps).
export {
  NoopConflictPolicy,
  LastWriteWinsConflictPolicy,
  LlmJudgedMergeConflictPolicy,
} from '../core/index.js';
export * from './eviction/index.js';

/** Extended MemoryConfig with the OTel tracer slot from ADR D1.3. */
export interface LocalMemoryConfig extends MemoryConfig {
  readonly tracer?: Tracer;
  /**
   * v0.4b-fixes T4.1 — opt-in eviction pipeline. Requires `vectorStore` to
   * be a `PgvectorStore` instance (advisory locks + pgvector cosine distance
   * are PG-only). `createLocalMemory` throws `EvictionNotSupported` when this
   * field is set with an `InMemoryVectorStore`.
   *
   * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T4.1 + ADR D6
   */
  readonly eviction?: LocalEvictionConfig;
  /**
   * @internal v0.4b-fixes T4.1 — async hook fired by `LocalScopedMemory.remember()`
   * post-pipeline. Used by the factory to wire `CapacityBasedTrigger.fire()`
   * when `eviction.trigger === 'capacity'`. NOT a public field; consumers
   * configure eviction via the `eviction` option above.
   */
  readonly postRememberHook?: (scope: Scope) => Promise<void>;
  /**
   * adapters-openrouter-local-embedder T0.1 (ADR D2 + EC-1 absorption):
   * declared embedding dimension produced by the embedder. Defaults to
   * `MAX_EMBEDDING_DIM` (1536) to preserve backward compatibility with
   * every existing caller. When set to a smaller value (e.g., 384 for
   * Xenova/all-MiniLM-L6-v2), the probe asserts against this configured
   * dim instead of the constant, and `PgvectorStore` / `runMigrations`
   * accept the matching dim for the `vector(N)` schema column.
   *
   * Pre-flight validation rejects (with `InvalidScope`) any value that is
   * NOT a positive integer ≤ `MAX_EMBEDDING_DIM`. The guard uses
   * `Number.isInteger` to catch NaN / float / Infinity values that bare
   * arithmetic comparisons miss silently. The error message includes the
   * literal received value via `String(received)` for operator
   * diagnosability.
   *
   * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T0.1 + ADR D2
   * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md § EC-1
   */
  readonly embeddingDim?: number;
  /**
   * semantic-recall-cache-v1-5 T2.1 — opt-in semantic recall cache.
   *
   * Dual-shape (Blueprint D5):
   *   - `RecallCacheStoreConfig` (POJO): factory constructs a default
   *     `PgvectorRecallCacheStore` against the same Pool that backs the
   *     vector store. Config is validated at factory time per
   *     `architecture.md § 8` fail-fast; `InvalidCacheConfig` thrown
   *     before any side effect.
   *   - `RecallCacheStore` (DIP instance): used verbatim — caller has
   *     already constructed an impl (e.g., Redis-backed in v1.5.x, or
   *     a test double).
   *
   * Cache opt-in requires the vector store to be a `PgvectorStore`
   * (cache backing table lives in Postgres; in-memory adapter has no
   * matching surface). The factory throws `InvalidCacheConfig` when
   * config shape is provided without a Postgres vector store.
   *
   * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T2.1
   * @see src/core/dip/recall-cache-store.ts (13th DIP)
   */
  readonly recallCache?: RecallCacheStoreConfig | RecallCacheStore;
}

/**
 * Thrown when `createLocalMemory({ eviction: {...} })` is called with a
 * non-PgvectorStore vector store. Advisory locks + pgvector cosine distance
 * are PG-only; eviction is not implemented for `InMemoryVectorStore`.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T4.1 (SEPA iter 5 pre-RED CRITICAL #3)
 */
export class EvictionNotSupported extends Error {
  override readonly name = 'EvictionNotSupported' as const;

  constructor(storeKind: string, options?: ErrorOptions) {
    super(
      `Eviction config requires a PgvectorStore (got ${storeKind}). ` +
        'Advisory locks + pgvector cosine distance are PostgreSQL-only.',
      options,
    );
    Object.setPrototypeOf(this, EvictionNotSupported.prototype);
  }
}

export const PROBE_TEXT = '__themem_probe__';

/**
 * v0.6 (T2.2): translate skill-aware RecallOptions / GetAllOptions flags into
 * `Filters.kind` + `Filters.excludeSuperseded` before the store call.
 *
 * `includeSuperseded` defaults to `false` (recall returns only tip-of-chain),
 * so when the caller omits the option we still emit `excludeSuperseded=true`
 * — BUT only when `onlySkills` is also set, so v0.4a callers see no change.
 */
function applySkillFilters(
  baseFilters: Filters,
  options?: { onlySkills?: boolean; includeSuperseded?: boolean; attributedTo?: string; asOf?: Date },
): Filters {
  if (options === undefined) {
    return baseFilters;
  }
  // v1.1 T2.2: route RecallOptions.attributedTo into Filters.attributed_to so
  // composeFilters in pgvector-store appends the WHERE clause.
  // v1.1 T3.1 + ADR-0011: route RecallOptions.asOf into Filters.asOf so the
  // store composes the null-safe bi-temporal predicate.
  let base: Filters = { ...baseFilters };
  if (options.attributedTo !== undefined) {
    base = { ...base, attributed_to: options.attributedTo };
  }
  if (options.asOf !== undefined) {
    base = { ...base, asOf: options.asOf };
  }
  if (options.onlySkills === true) {
    return {
      ...base,
      kind: 'skill',
      // Default for skill recall: exclude superseded unless the caller explicitly opts in.
      excludeSuperseded: options.includeSuperseded === true ? false : true,
    };
  }
  if (options.includeSuperseded === false) {
    return { ...base, excludeSuperseded: true };
  }
  return base;
}

function filtersFromScope(scope: Scope): Filters {
  switch (scope.kind) {
    case 'user':
      return { user_id: scope.userId };
    case 'session':
      return scope.userId !== undefined
        ? { user_id: scope.userId, session_id: scope.sessionId }
        : { session_id: scope.sessionId };
    case 'agent':
      return scope.userId !== undefined
        ? { user_id: scope.userId, agent_id: scope.agentId }
        : { agent_id: scope.agentId };
    case 'repo':
      // v0.6 (EC-4): RepoScope persists `repoId` in the `agent_id` column. The
      // `kind='skill'` discriminator (added by Skill-specific recall/getAll paths)
      // disambiguates skill rows from regular agent memories under the same id.
      return { agent_id: scope.repoId };
  }
}

function assertScopeIsNonEmpty(scope: Scope): void {
  // Type-safe runtime guard — rejects {} or any malformed input lacking a valid kind.
  const kind = (scope as { kind?: string }).kind;
  if (kind !== 'user' && kind !== 'session' && kind !== 'agent' && kind !== 'repo') {
    throw new InvalidScope('reset requires a Scope with kind user/session/agent/repo (EC-13)');
  }
  if (scope.kind === 'user' && scope.userId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'session' && scope.sessionId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'agent' && scope.agentId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'repo' && scope.repoId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
}

/**
 * semantic-recall-cache-v1-5 T2.1 — discriminator between the dual-shape config.
 * A pre-constructed DIP impl has the 4 method names; a POJO config does not.
 */
function isRecallCacheStoreInstance(value: unknown): value is RecallCacheStore {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecallCacheStore).get === 'function' &&
    typeof (value as RecallCacheStore).set === 'function' &&
    typeof (value as RecallCacheStore).invalidateScope === 'function' &&
    typeof (value as RecallCacheStore).clearExpired === 'function'
  );
}

/**
 * semantic-recall-cache-v1-5 T2.1 — EC-2 absorption.
 *
 * Probe `recall_cache.query_embedding` `atttypmod` to detect embedder/table
 * dim mismatch caused by mid-deployment embedder swap WITHOUT a corresponding
 * `runMigrations({embeddingDim})`. Mirrors v1.4 `adapters-openrouter-local-embedder`
 * T2.1 pattern — pgvector v0.5.1 stores N directly in `atttypmod` (verified
 * empirically by that cycle).
 *
 * Returns `null` when the table does not yet exist (pre-migration state) so
 * the factory can defer the check until the consumer runs `runMigrations()`.
 */
/**
 * semantic-recall-cache-v1-5 T2.2 — EC-10 absorption: derive the scope of a
 * memory row from its persisted payload so `LocalMemory.forget()` can issue
 * a targeted `invalidateScope` instead of an all-scope sweep. The payload
 * carries `user_id` / `session_id` / `agent_id` columns (the same shape
 * `runExtractionPipeline` persisted at write time).
 *
 * Returns `undefined` when payload has no recognizable scope tier;
 * `LocalMemory.forget()` SKIPS cache invalidation in that case (no
 * `invalidateAll()` fallback per ADR D9 of `semantic-recall-cache-v1-5-fixes-cycle-1`).
 * Cache continues serving until TTL — bounded staleness.
 *
 * The `undefined` branch is DEFENSIVE: every v0.1+ row carries a scope column
 * populated by `runExtractionPipeline`. The branch only fires for (a) hypothetical
 * pre-v0.1 rows (none in production) OR (b) consumer-side manual INSERTs bypassing
 * the extraction pipeline.
 *
 * Repo-tier scope is NOT exercised here yet (per ADR D10 of `semantic-recall-cache-v1-5-fixes-cycle-1`):
 * `LocalScopedSkillMemory.recall()` does not consult the cache at v1.5.0, so the
 * derivation function returns the most specific memory-scope tier without checking
 * for a `repo_id` column. Skill-scope cache wiring lands in v1.5.x.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-fixes-cycle-1-plan.md § ADR D9 + § ADR D10
 */
function deriveScopeFromPayload(payload: Readonly<Record<string, unknown>>): Scope | undefined {
  const userId = payload['user_id'];
  const sessionId = payload['session_id'];
  const agentId = payload['agent_id'];
  // session is the most specific tier; prefer it when present.
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return { kind: 'session', sessionId };
  }
  if (typeof agentId === 'string' && agentId.length > 0) {
    return { kind: 'agent', agentId };
  }
  if (typeof userId === 'string' && userId.length > 0) {
    return { kind: 'user', userId };
  }
  return undefined;
}

/**
 * semantic-recall-cache-v1-5 T2.1 — resolve TTL per scope tier from the config.
 * Honors per-tier override → default 4-tier table fallback. Mirrors
 * `RecallCacheStore` default behavior so wraps without an explicit config
 * receive the same values as the impl's internal default.
 */
function resolveCacheTtl(
  scope: Scope,
  cacheConfig: RecallCacheStoreConfig | RecallCacheStore | undefined,
): number {
  // Default fallback table (mirror DEFAULT_TTL_SECONDS_BY_SCOPE_TIER without
  // importing the constant — keeps the wiring module readable).
  const defaults = { user: 86_400, agent: 3_600, session: 600, repo: 3_600 } as const;
  if (cacheConfig !== undefined && !isRecallCacheStoreInstance(cacheConfig)) {
    const override = cacheConfig.ttlSecondsByScopeTier?.[scope.kind];
    if (override !== undefined) return override;
  }
  return defaults[scope.kind];
}

/**
 * semantic-recall-cache-v1-5 T2.3 — constructor.name based stub-embedder
 * detection (avoids `instanceof` coupling to the concrete stub classes — the
 * test stub classes also need to be detected). Names recognized:
 *   - `StubEmbedder` (src/local/stubs.ts — legacy zero-vector stub)
 *   - `DeterministicStubEmbedder` (src/embedders/stub.ts — deterministic
 *     non-semantic vector stub used by run-server.ts default path)
 */
function isStubEmbedder(embedder: Embedder): boolean {
  const name = embedder.constructor.name;
  return name === 'StubEmbedder' || name === 'DeterministicStubEmbedder';
}

const STUB_EMBEDDER_CACHE_WARNING_PREFIX = 'themory cache:';

/**
 * semantic-recall-cache-v1-5 T2.3 — emit the 3-line stderr warning the cycle-1
 * T2.2 pattern locked: line 1 names the detected class; line 2 surfaces the
 * behavior delta (semantic vs coincidental hits); line 3 points to wiring docs.
 */
function emitStubEmbedderCacheWarning(detectedClassName: string): void {
  process.stderr.write(
    `${STUB_EMBEDDER_CACHE_WARNING_PREFIX} WARNING — Cache enabled with stub embedder (${detectedClassName}).\n`,
  );
  process.stderr.write(
    `${STUB_EMBEDDER_CACHE_WARNING_PREFIX} Cache hits will be COINCIDENTAL (deterministic but non-semantic vectors), NOT semantic.\n`,
  );
  process.stderr.write(
    `${STUB_EMBEDDER_CACHE_WARNING_PREFIX} For production semantic caching, wire OpenAIEmbedder or LocalTransformerEmbedder. See README § Wiring real providers.\n`,
  );
}

async function probeCacheTableDim(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ atttypmod: number }>(
    `SELECT a.atttypmod
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'recall_cache'
        AND a.attname = 'query_embedding'
        AND a.attisdropped = false`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return row.atttypmod;
}

/**
 * semantic-recall-cache-v1-5 T2.1 — dual-shape factory resolver.
 *
 * Returns `undefined` when the consumer did not opt in. Otherwise:
 *   - DIP instance shape: used verbatim (escape hatch — caller built impl).
 *   - POJO config shape: validates config → probes the table dim against
 *     `embeddingDim` (EC-2 mismatch detection) → constructs
 *     `PgvectorRecallCacheStore` against the vector store's pool.
 *
 * Cache config provided alongside a non-Postgres vector store is rejected
 * (the default impl lives in Postgres; the in-memory adapter has no
 * matching surface).
 */
async function resolveRecallCacheStore(
  config: LocalMemoryConfig,
  embedderDim: number,
): Promise<RecallCacheStore | undefined> {
  const optIn = config.recallCache;
  if (optIn === undefined) return undefined;
  if (isRecallCacheStoreInstance(optIn)) {
    return optIn;
  }
  // POJO config: validate FIRST so InvalidCacheConfig fires before any DB call.
  validateRecallCacheStoreConfig(optIn);
  if (!(config.vectorStore instanceof PgvectorStoreClass)) {
    throw new InvalidCacheConfig(
      'recallCache config requires a PgvectorStore vector store (got ' +
        `${config.vectorStore.constructor.name}). The default ` +
        'PgvectorRecallCacheStore lives in Postgres; supply a custom ' +
        'RecallCacheStore instance to use a non-Postgres backend.',
    );
  }
  const pool = config.vectorStore.poolForEviction;
  // EC-2 absorption: detect embedder/cache-table dim mismatch caused by
  // mid-deployment embedder swap WITHOUT a corresponding runMigrations
  // ({embeddingDim}). Pre-migration null-table case is honored (returns null);
  // the consumer is expected to call runMigrations BEFORE createLocalMemory.
  const cacheTableDim = await probeCacheTableDim(pool);
  if (cacheTableDim !== null && cacheTableDim !== embedderDim) {
    throw new InvalidCacheConfig(
      `embedder dim ${embedderDim} mismatches recall_cache.query_embedding dim ${cacheTableDim}; ` +
        `run runMigrations(pool, { embeddingDim: ${embedderDim} }) OR DELETE FROM recall_cache before retrying`,
    );
  }
  // Dynamic import — keeps the cache impl OUT of the default barrel's static
  // import graph (T4.1 bundle isolation). The runtime cost (one `await import()`)
  // is paid only when the consumer opts in via `recallCache: { ... }`.
  const { PgvectorRecallCacheStore } = await import('./recall-cache/pgvector-recall-cache-store.js');
  return new PgvectorRecallCacheStore(pool, optIn, {
    embedderKind: config.embedder.constructor.name,
  });
}

interface VectorStoreWithDerivedInsert {
  insertDerivedMemory(args: {
    text: string;
    hash: string;
    embedding: readonly number[];
    derivedFrom: readonly string[];
    scope: { userId?: string | null; sessionId?: string | null; agentId?: string | null };
  }): Promise<string>;
}

interface VectorStoreWithConsolidation {
  recallConsolidationCandidates?: (
    filters: Filters,
  ) => Promise<readonly { memoryId: string; text: string; createdAt: Date }[]>;
  persistConsolidations?: (
    results: readonly ConflictResolutionResult[],
  ) => Promise<void>;
}

function scopeToCounterTuple(scope: Scope): {
  userId: string | null;
  sessionId: string | null;
  agentId: string | null;
} {
  switch (scope.kind) {
    case 'user':
      return { userId: scope.userId, sessionId: null, agentId: null };
    case 'session':
      return { userId: scope.userId ?? null, sessionId: scope.sessionId, agentId: null };
    case 'agent':
      return { userId: scope.userId ?? null, sessionId: null, agentId: scope.agentId };
    case 'repo':
      // v0.6 (EC-4): RepoScope persists `repoId` in the `agent_id` column at the
      // store layer (see filtersFromScope). Counter rows mirror that mapping.
      return { userId: null, sessionId: null, agentId: scope.repoId };
  }
}

class LocalScopedMemory implements ScopedMemory {
  constructor(
    private readonly scope: Scope,
    private readonly filters: Filters,
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
    /** v0.4a EC-7: shared pending-reflections set owned by LocalMemory. */
    private readonly pendingReflections: Set<Promise<unknown>> = new Set(),
    /** semantic-recall-cache-v1-5 T2.1 — opt-in cache wrap; undefined = unchanged behavior. */
    private readonly recallCacheStore: RecallCacheStore | undefined = undefined,
  ) {}

  async remember(text: string, options?: RememberOptions): Promise<readonly MemoryItem[]> {
    const messages: readonly Message[] = [{ role: 'user', content: text }];
    const result = await runExtractionPipeline(messages, this.filters, {
      vectorStore: this.config.vectorStore,
      embedder: this.config.embedder,
      llm: this.config.llm,
      ...(this.config.historyManager !== undefined ? { historyManager: this.config.historyManager } : {}),
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
      ...(this.config.customInstructions !== undefined ? { customInstructions: this.config.customInstructions } : {}),
    }, options);

    // v0.4b-fixes T4.1: post-remember hook for the capacity-trigger pipeline
    // wired by `createLocalMemory({ eviction: { trigger: 'capacity', ... } })`.
    // Awaited inline so consumers' next remember() sees the post-evict state.
    // Errors do NOT block remember() result — surface via OTel span on the
    // PgEvictor counter (T10.1 will lazy-init the meter).
    if (this.config.postRememberHook !== undefined) {
      try {
        await this.config.postRememberHook(this.scope);
      } catch {
        // Eviction failures are observability-only; do not poison remember().
      }
    }

    // semantic-recall-cache-v1-5 T2.2 — Item 19 AC#3: write-trigger cache
    // invalidation post-success. EC-11 absorption: AWAITED sequentially so
    // the consumer's next recall() in the same scope sees the fresh post-write
    // state without races. Failures are logged loudly but do NOT poison
    // remember() — cache failure is a degraded path (callers fall through to
    // the 9-step pipeline on the next recall).
    if (this.recallCacheStore !== undefined) {
      try {
        await this.recallCacheStore.invalidateScope(this.scope);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[themory] recall-cache invalidateScope (remember) failed:', err);
      }
    }

    // v0.4a: after successful write, check ReflectionPolicy. If it says fire,
    // launch reflect() as fire-and-forget tracked via pendingReflections (EC-7).
    if (this.reflectionPolicy !== undefined && this.reflectionPolicy.kind !== 'manual') {
      try {
        const trigger = { kind: this.reflectionPolicy.kind } as const;
        const fire = await this.reflectionPolicy.shouldReflect(this.scope, trigger);
        if (fire) {
          const promise = this.reflect()
            .catch(() => {
              // EC-12: failed reflection does NOT roll back the counter; orchestrator surfaces via onReflectionEnd.
            })
            .finally(() => {
              this.pendingReflections.delete(promise);
            });
          this.pendingReflections.add(promise);
        }
      } catch {
        // Policy decision failures must not block remember(); surface via flushReflections settled-but-rejected.
      }
    }

    return result;
  }

  async recall(query: string, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]> {
    // v1.1 T3.1 + EC-3 + ADR-0011: BiTemporalNotSupportedLocally throw lifted.
    // Boundary validation rejects invalid Date input per architecture.md § 8
    // (validate at boundaries; inside src/core/ trust the contract).
    if (options?.asOf !== undefined && Number.isNaN(options.asOf.getTime())) {
      throw new InvalidScope('asOf must be a valid Date');
    }

    // semantic-recall-cache-v1-5 T2.1 — cache applicability boundary (ADR D8).
    // EC-4 + EC-5 absorption: v1.5.0 cache key is (scope_key, query_embedding)
    // per Blueprint D4 — it does NOT include `asOf` (bi-temporal) OR
    // `attributedTo` (multi-peer). Serving cached current/unfiltered results
    // when the consumer asked for a historical OR peer-filtered slice would be
    // a correctness bug (Inquebrável Rule 3). BYPASS path: when EITHER option
    // is set, skip the cache entirely (no get, no set).
    const cache = this.recallCacheStore;
    const cacheApplicable =
      cache !== undefined && options?.asOf === undefined && options?.attributedTo === undefined;

    if (!cacheApplicable || cache === undefined) {
      return runRetrievalPipeline(query, applySkillFilters(this.filters, options), {
        vectorStore: this.config.vectorStore,
        embedder: this.config.embedder,
        ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
      }, options);
    }

    // Cache-aware path: embed once, consult cache, populate on miss.
    const queryEmbedding = await this.config.embedder.embed(query);
    const cached = await cache.get(queryEmbedding, this.scope);
    if (cached !== undefined) {
      return [...cached.results];
    }
    // T3.1 — wall-clock latency for the MISS path (cache.get returned undefined →
    // full 9-step retrieval + cache populate). Counter is not bumped on miss;
    // hit-rate is `count(hit_counter) / (count(hit_counter) + count(miss_histo))`.
    // Dynamic import keeps the metrics module OUT of the default barrel's
    // static graph (T4.1 bundle isolation) — paid only on cache-wired paths.
    const missStart = performance.now();
    const results = await runRetrievalPipeline(query, applySkillFilters(this.filters, options), {
      vectorStore: this.config.vectorStore,
      embedder: this.config.embedder,
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
    }, options);
    const ttlSeconds = resolveCacheTtl(this.scope, this.config.recallCache);
    await cache.set(queryEmbedding, this.scope, results, ttlSeconds);
    const { getRecallCacheMissDurationHistogram } = await import('./recall-cache/recall-cache-metrics.js');
    getRecallCacheMissDurationHistogram().record(performance.now() - missStart, {
      scope_tier: this.scope.kind,
      embedder_kind: this.config.embedder.constructor.name,
    });
    return results;
  }

  async reflect(options?: ReflectOptions): Promise<ReflectionResult> {
    void options;
    if (this.reflectionPolicy === undefined) {
      throw new ReflectionNotConfigured();
    }

    // Fetch source memories
    const [results] = await this.config.vectorStore.list(this.filters, 100);
    const sourceMemories: MemoryItem[] = results.map((r) => ({
      id: r.id,
      text: String(r.payload['text'] ?? ''),
      hash: String(r.payload['hash'] ?? r.id),
      scope: this.scope,
      metadata: { ...r.payload },
      createdAt: new Date(),
      updatedAt: new Date(),
      tValid: new Date(),
      tInvalid: null,
    }));

    // EC-5: empty-source short-circuit
    if (sourceMemories.length === 0) {
      const result: ReflectionResult = {
        higherOrderMemories: [],
        sourceIds: [],
        derivedMemoriesCreated: 0,
        reason: 'no-source-memories',
      };
      if (this.reflectionPolicy.onReflectionEnd !== undefined) {
        await this.reflectionPolicy.onReflectionEnd(this.scope, result);
      }
      return result;
    }

    // Run policy hook
    if (this.reflectionPolicy.onReflectionStart !== undefined) {
      await this.reflectionPolicy.onReflectionStart(this.scope, options ?? {});
    }

    try {
      // v0.7 T2.1: pre-derivation conflict-resolution phase.
      // EC-7 absorbed: empty scope already short-circuited at line 354
      // ("EC-5: empty-source short-circuit"); here we additionally guard on
      // sourceMemories.length < 2 (nothing to consolidate with a singleton).
      // EC-8 absorbed: persistConsolidations
      // wraps t_invalid UPDATE + insertConsolidationHistory INSERT in a
      // single withTransaction (rollback on any error). Runs BEFORE
      // executeReflection so LLM-extraction failure paths don't mask the
      // consolidation's own failure modes.
      const conflictPolicy = options?.conflictResolution;
      if (conflictPolicy !== undefined && sourceMemories.length >= 2) {
        const storeWithConsolidate = this.config.vectorStore as unknown as VectorStoreWithConsolidation;
        if (
          typeof storeWithConsolidate.recallConsolidationCandidates !== 'function' ||
          typeof storeWithConsolidate.persistConsolidations !== 'function'
        ) {
          throw new Error(
            'reflect: conflictResolution requires a vector store with ' +
              'recallConsolidationCandidates() + persistConsolidations() — ' +
              'use PgvectorStore from @usetheo/memory/local.',
          );
        }
        const candidates = await storeWithConsolidate.recallConsolidationCandidates(
          this.filters,
        );
        const consolidationResults = await conflictPolicy.consolidate(
          candidates,
          { scope: this.scope, observationDate: new Date() },
        );
        if (consolidationResults.length > 0) {
          await storeWithConsolidate.persistConsolidations(consolidationResults);
        }
      }

      // Execute reflection LLM call
      const drafts = await executeReflection({
        llm: this.config.llm,
        sourceMemories,
        scope: this.scope,
      });

      const sourceIds = sourceMemories.map((m) => m.id);

      // EC-13: LLM returned empty array (no consolidation)
      if (drafts.length === 0) {
        const result: ReflectionResult = {
          higherOrderMemories: [],
          sourceIds,
          derivedMemoriesCreated: 0,
          reason: 'no-consolidation',
        };
        if (this.reflectionPolicy.onReflectionEnd !== undefined) {
          await this.reflectionPolicy.onReflectionEnd(this.scope, result);
        }
        return result;
      }

      // Provenance validation (throws ReflectionProvenanceMissingError on fail)
      validateProvenance(drafts, sourceIds);

      // Embed + persist drafts. Store extension provides insertDerivedMemory.
      const storeWithDerived = this.config.vectorStore as unknown as VectorStoreWithDerivedInsert;
      if (typeof storeWithDerived.insertDerivedMemory !== 'function') {
        throw new Error(
          'reflect: configured vector store does not implement insertDerivedMemory; ' +
            'pass a PgvectorStore or InMemoryVectorStore from @usetheo/memory/local.',
        );
      }

      const counterTuple = scopeToCounterTuple(this.scope);
      const persisted: MemoryItem[] = [];
      for (const draft of drafts) {
        const embedding = await this.config.embedder.embed(draft.text);
        const hash = `derived-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
        const id = await storeWithDerived.insertDerivedMemory({
          text: draft.text,
          hash,
          embedding,
          derivedFrom: draft.derivedFrom,
          scope: counterTuple,
        });
        persisted.push({
          id,
          text: draft.text,
          hash,
          scope: this.scope,
          metadata: { kind: 'derived' },
          createdAt: new Date(),
          updatedAt: new Date(),
          tValid: new Date(),
          tInvalid: null,
        });
      }

      const result: ReflectionResult = {
        higherOrderMemories: persisted,
        sourceIds,
        derivedMemoriesCreated: persisted.length,
      };
      if (this.reflectionPolicy.onReflectionEnd !== undefined) {
        await this.reflectionPolicy.onReflectionEnd(this.scope, result);
      }
      // semantic-recall-cache-v1-5 T2.2 — EC-6 absorption: reflect() produces
      // derived memories (v0.4a) + distillation rows (v0.7). Without scope
      // invalidation, the cache serves stale results post-reflect for the
      // same scope. Same correctness gate as remember/forget per Item 19 AC#3.
      // Awaited sequentially (EC-11). Failures logged but do NOT poison reflect().
      if (this.recallCacheStore !== undefined && persisted.length > 0) {
        try {
          await this.recallCacheStore.invalidateScope(this.scope);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[themory] recall-cache invalidateScope (reflect) failed:', err);
        }
      }
      return result;
    } catch (err) {
      if (this.reflectionPolicy.onReflectionEnd !== undefined) {
        await this.reflectionPolicy.onReflectionEnd(
          this.scope,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      throw err;
    }
  }

  async getAll(options?: GetAllOptions): Promise<readonly MemoryItem[]> {
    const limit = options?.topK ?? 100;
    const [results] = await this.config.vectorStore.list(
      applySkillFilters(this.filters, options),
      limit,
    );
    // dashboard-memories-tab-standardization T2.2 + ADR D2 + EC-7:
    // Consume VectorStoreResult.createdAt when projected by the adapter; fall back
    // to new Date() ONLY when undefined. Per EC-7 aggregation, count fallback rows
    // in one pass and emit ONE `getall_temporal_fallback` event AFTER the map with
    // `{ count: N }` metadata — NEVER per-row (a 10k-row legacy scope would
    // explode logs otherwise). NOT emitted when count = 0 (mirrors
    // `recall_threshold_filtered` no-op observability discipline).
    let fallbackCount = 0;
    const items: MemoryItem[] = results.map((r) => {
      let createdAt = r.createdAt;
      if (createdAt === undefined) {
        fallbackCount += 1;
        createdAt = new Date();
      }
      // updatedAt + tValid mirror createdAt: under ADR-0003 ADD-only there is no
      // separate mutation timestamp; under D2 fallback, mirroring avoids a SECOND
      // synthesizer that would bypass the OTel audit.
      return {
        id: r.id,
        text: String(r.payload['text'] ?? ''),
        hash: String(r.payload['hash'] ?? r.id),
        scope: this.scope,
        createdAt,
        updatedAt: createdAt,
        metadata: { ...r.payload },
        tValid: createdAt,
        tInvalid: null,
      };
    });
    if (fallbackCount > 0) {
      emitEvent(this.config.tracer, 'getall_temporal_fallback', { count: fallbackCount });
    }
    return items;
  }
}

class LocalMemory implements Memory {
  /** v0.4a (T4.3 EC-7): in-flight reflection promises tracked for flushReflections(). */
  private readonly pendingReflections = new Set<Promise<unknown>>();

  constructor(
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
    /** semantic-recall-cache-v1-5 T2.1 — undefined when cache disabled. */
    private readonly recallCacheStore: RecallCacheStore | undefined = undefined,
  ) {}

  user(userId: string): ScopedMemory {
    const scope: Scope = { kind: 'user', userId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
      this.recallCacheStore,
    );
  }

  session(sessionId: string): ScopedMemory {
    const scope: Scope = { kind: 'session', sessionId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
      this.recallCacheStore,
    );
  }

  agent(agentId: string): ScopedMemory {
    const scope: Scope = { kind: 'agent', agentId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
      this.recallCacheStore,
    );
  }

  async flushReflections(): Promise<void> {
    // Snapshot the current set; new reflections may be added during iteration.
    const snapshot = [...this.pendingReflections];
    await Promise.allSettled(snapshot);
  }

  /**
   * v0.4b-fixes T7.1 — PUBLIC API BREAKING CHANGE (ADR D7 + EC-3 absorption).
   *
   * Behavior contract delta vs v0.1:
   * - **v0.1 (shipped)**: physical DELETE via `vectorStore.delete()`; raw
   *   `SELECT * FROM memories WHERE id = $1` post-forget returned 0 rows. This
   *   violated the documented `ForgetOptions.hard?: false` default at
   *   `src/core/options.ts:55-62`.
   * - **v0.4b-fixes (this)**: soft-delete via `t_invalid = NOW()` through the
   *   `PgEvictor` path (consistent with auto-eviction). Raw SELECT post-forget
   *   returns 1 row with `t_invalid IS NOT NULL`. Use `{ hard: true }` for
   *   GDPR-style physical delete.
   * - **Migration**: replace `assert count_after_forget == 0` with
   *   `assert count_where_t_invalid_null_after_forget == 0`. Historical rows
   *   recoverable via `WHERE t_invalid IS NOT NULL`.
   * - **Cascade**: v0.6 `ScopedSkillMemory.forget()` routes through this same
   *   path via `LocalScopedSkillMemory.forgetDelegate` — skill consumers also
   *   see the BREAKING change.
   *
   * `InMemoryVectorStore` consumers (dev/test) keep the v0.1 hard-delete
   * behavior — `t_invalid` is a Postgres-only concept; the in-memory adapter
   * does not model it. This preserves unit-test ergonomics while the
   * Postgres production path gains the soft-delete contract.
   *
   * @see CHANGELOG.md [Unreleased] § Changed `**BREAKING**` entry
   * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T7.1 + ADR D7
   * @see .claude/knowledge-base/reviews/v0-4b-fixes-cycle-edge-cases-2026-05-30.md § EC-3
   */
  async forget(memoryId: string, options?: ForgetOptions): Promise<void> {
    const existing = await this.config.vectorStore.get(memoryId);
    if (existing === null) {
      throw new MemoryNotFound(`memoryId ${memoryId} not found (EC-12: strict-mode forget throws on missing id)`);
    }
    // semantic-recall-cache-v1-5 T2.2 — EC-10 absorption: derive the memory's
    // scope BEFORE the delete so we can issue a targeted `invalidateScope`
    // instead of an all-scope sweep. Falls back to undefined when the payload
    // does not carry any scope column (defensive — pre-v0.1 rows in theory).
    const scopeFromMemory = deriveScopeFromPayload(existing.payload);
    const hardDelete = options?.hard === true;
    const isPgStore = this.config.vectorStore instanceof PgvectorStoreClass;
    if (hardDelete || !isPgStore) {
      // GDPR-style physical delete (ForgetOptions.hard=true) OR non-Pg adapter
      // fallback (InMemoryVectorStore has no t_invalid concept).
      await this.config.vectorStore.delete(memoryId);
    } else {
      // Default soft-delete via PgEvictor — consistent with the v0.4b
      // auto-eviction path. Idempotent: a row already carrying t_invalid is
      // returned in `alreadyInvalid` without an exception.
      const evictor = new PgEvictor(this.config.vectorStore.poolForEviction);
      await evictor.evict([memoryId]);
    }
    if (this.config.historyManager !== undefined) {
      try {
        await this.config.historyManager.addHistory(
          memoryId,
          String(existing.payload['text'] ?? ''),
          null,
          'forget',
          new Date(),
        );
      } catch {
        // Silent swallow — history persistence failure must not block forget
      }
    }
    // semantic-recall-cache-v1-5 T2.2 — Item 19 AC#3 cache invalidation
    // post-success. EC-11: sequentially awaited. EC-10: targeted to the
    // memory's resolved scope when discoverable; otherwise no-op (the cache
    // simply continues serving — slightly stale but bounded by TTL).
    if (this.recallCacheStore !== undefined && scopeFromMemory !== undefined) {
      try {
        await this.recallCacheStore.invalidateScope(scopeFromMemory);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[themory] recall-cache invalidateScope (forget) failed:', err);
      }
    }
  }

  async get(memoryId: string): Promise<MemoryItem | null> {
    const result = await this.config.vectorStore.get(memoryId);
    if (result === null) {
      return null;
    }
    return {
      id: result.id,
      text: String(result.payload['text'] ?? ''),
      hash: String(result.payload['hash'] ?? result.id),
      scope: { kind: 'user', userId: String(result.payload['user_id'] ?? '') },
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { ...result.payload },
      tValid: new Date(),
      tInvalid: null,
    };
  }

  async history(memoryId: string): Promise<readonly HistoryEntry[]> {
    if (this.config.historyManager === undefined) {
      return [];
    }
    return this.config.historyManager.getHistory(memoryId);
  }

  async reset(scope: Scope): Promise<void> {
    assertScopeIsNonEmpty(scope);
    const filters = filtersFromScope(scope);
    const [results] = await this.config.vectorStore.list(filters, 10_000);
    for (const r of results) {
      await this.config.vectorStore.delete(r.id);
    }
  }

  /**
   * v0.6: code-as-skill memory entry-point.
   *
   * Returns a `LocalScopedSkillMemory` bound to `repoId`. Internally maps to
   * the existing `agent_id` column at the store layer per the EC-4 absorption
   * in `filtersFromScope`; the `kind='skill'` discriminator disambiguates skill
   * rows from regular agent memories sharing the same id.
   *
   * @throws InvalidScope on empty `repoId`.
   * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T4.1
   */
  skills(repoId: string): ScopedSkillMemory {
    // The local stores (PgvectorStore + InMemoryVectorStore) implement the
    // VectorStoreWithSkillInsert extension as duck-typed methods (off-DIP per
    // T2.1 design note); narrow at the boundary so the orchestrator sees the
    // augmented surface.
    const skillStore = this.config.vectorStore as VectorStore & VectorStoreWithSkillInsert;
    return new LocalScopedSkillMemory(repoId, {
      vectorStore: skillStore,
      embedder: this.config.embedder,
      llm: this.config.llm,
      // T4.1 / F10 + EC-2: forget delegates to LocalMemory.forget (canonical
      // path: writes the 'forget' history event); get delegates to LocalMemory.get
      // for the pre-delegate scope-isolation guard.
      forgetDelegate: (id: string) => this.forget(id),
      getDelegate: (id: string) => this.get(id),
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
    });
  }
}

async function probeEmbedder(embedder: Embedder, expectedDim: number): Promise<void> {
  const vector = await embedder.embed(PROBE_TEXT);
  if (vector.length !== expectedDim) {
    throw new EmbeddingMismatch(expectedDim, vector.length);
  }
}

/**
 * adapters-openrouter-local-embedder T0.1 (EC-1 absorption): pre-flight
 * guard for `LocalMemoryConfig.embeddingDim`. Uses `Number.isInteger` to
 * catch NaN / float / Infinity values that bare arithmetic comparisons
 * miss silently (`NaN <= 0` is `false`, `NaN > MAX` is `false`, so an
 * unguarded check lets them through). The error message includes the
 * literal received value via `String(received)` so the operator can
 * diagnose typos / wrong .env entries.
 *
 * Runs BEFORE `probeEmbedder` and BEFORE `vectorStore.initialize()` so
 * config-level rejection happens at startup with zero side effects.
 *
 * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md § EC-1
 * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-1-pre-red.md (CRITICAL #1 — uniform InvalidScope for all pre-flight failures)
 */
function validateEmbeddingDim(received: number | undefined): number {
  if (received === undefined) {
    return MAX_EMBEDDING_DIM;
  }
  if (!Number.isInteger(received) || received <= 0 || received > MAX_EMBEDDING_DIM) {
    // /review F-Mi4: typed `InvalidEmbeddingDim` (not generic `InvalidScope`).
    // The plan deferred the naming choice during /implement; the consolidated
    // /review caught the conflation between Scope-level errors and dim
    // config-shape errors and recommended a dedicated error class.
    throw new InvalidEmbeddingDim(received, MAX_EMBEDDING_DIM);
  }
  return received;
}

/**
 * v0.4b-fixes T4.1 extension: returned Memory carries a `dispose()` method
 * that stops the cron job + releases trigger resources. Non-eviction memories
 * still expose `dispose()` as a no-op so consumers can `await memory.dispose()`
 * unconditionally without runtime branching.
 *
 * Decision per SEPA iter 5 pre-RED CRITICAL #1 option (C): widen ONLY the
 * local factory return type — `Memory` interface stays unchanged so the cloud
 * runtime is not affected.
 */
export type DisposableMemory = Memory & { dispose(): Promise<void> };

/**
 * Public factory. Probes embedder dimension first; throws EmbeddingMismatch
 * before the first user call if mismatched.
 *
 * v0.4b-fixes T4.1: when `config.eviction` is set, wires the capacity-trigger
 * post-remember hook OR the time-trigger cron lifecycle. Throws
 * `EvictionNotSupported` if `vectorStore` is not a `PgvectorStore` (per
 * SEPA iter 5 pre-RED CRITICAL #3 — eviction is PG-only).
 */
export async function createLocalMemory(config: LocalMemoryConfig): Promise<DisposableMemory> {
  // verbs-as-cli-fixes-cycle-1 T1.1 / ADR D1: default reflectionPolicy when
  // the consumer OMITS the key entirely. `'reflectionPolicy' in config`
  // distinguishes omission (→ default to `kind: 'manual'`) from explicit
  // `reflectionPolicy: undefined` (→ preserve ADR-0005's
  // `ReflectionNotConfigured` throw for consumers that want strict no-default
  // behavior). EC-2 absorbed via 3 explicit factory contract tests covering
  // the 3 distinguishing paths.
  //
  // @see ADR-0005 supplementary amendment authorized via project-owner
  //      Option A response to `/review verbs-as-cli` NEEDS_FIXES verdict
  //      (2026-06-04 same session); the v0.4a ReflectionPolicy DIP + 3 impls
  //      make ManualReflectionPolicy the least-surprising default.
  const resolvedReflectionPolicy: ReflectionPolicy | undefined =
    'reflectionPolicy' in config
      ? config.reflectionPolicy
      : { kind: 'manual', shouldReflect: () => Promise.resolve(true) };

  // adapters-openrouter-local-embedder T0.1 (EC-1 absorption): pre-flight
  // FIRST — config-level rejection before any side effect (probe / store init).
  const effectiveDim = validateEmbeddingDim(config.embeddingDim);
  await probeEmbedder(config.embedder, effectiveDim);
  await config.vectorStore.initialize();

  // semantic-recall-cache-v1-5 T2.1 — opt-in cache wiring.
  // Resolved BEFORE the eviction branch so both eviction-on and eviction-off
  // paths get the cache (the two features are orthogonal — eviction touches
  // memories; cache touches recall_cache).
  const recallCacheStore = await resolveRecallCacheStore(config, effectiveDim);

  // semantic-recall-cache-v1-5 T2.3 / F-rev-9 absorption (cycle-1 T2.2 precedent
  // at src/agent-tools/run-server.ts:110-118): when cache is enabled AND the
  // embedder is a stub (StubEmbedder / DeterministicStubEmbedder), warn the
  // consumer LOUDLY at startup. Stub vectors are deterministic but NOT
  // semantic — cache hits will be COINCIDENTAL (exact-text round-trips) rather
  // than the near-duplicate semantic matching the cache is designed for.
  // Inquebrável Rule 3 (honesty) at the consumer-facing boundary.
  if (recallCacheStore !== undefined && isStubEmbedder(config.embedder)) {
    emitStubEmbedderCacheWarning(config.embedder.constructor.name);
  }

  if (config.eviction === undefined) {
    const memory = new LocalMemory(config, resolvedReflectionPolicy, recallCacheStore);
    return Object.assign(memory, { dispose: (): Promise<void> => Promise.resolve() });
  }

  if (!(config.vectorStore instanceof PgvectorStoreClass)) {
    throw new EvictionNotSupported(config.vectorStore.constructor.name);
  }
  const pool = config.vectorStore.poolForEviction;

  const evictor = new PgEvictor(pool);
  const halfLifePersister = new PgHalfLifePersister(pool);
  const neighborProvider = new PgNearestNeighborProvider(pool);
  const policy = new TriadicScoringPolicy({
    evictor,
    halfLifePersister,
    neighborProvider,
  });

  let postRememberHook: ((scope: Scope) => Promise<void>) | undefined;
  let stopCron: (() => void) | undefined;

  if (config.eviction.trigger === 'capacity') {
    const capacityTrigger = new CapacityBasedTrigger(
      pool,
      policy,
      config.eviction.maxMemoriesPerScope,
    );
    postRememberHook = async (scope: Scope): Promise<void> => {
      await capacityTrigger.fire(scope, new Date());
    };
  } else {
    const timeTrigger = new TimeBasedTrigger(pool, policy, {
      cronExpression: config.eviction.cronExpression,
      evictionFraction: config.eviction.evictionFraction,
      scope: config.eviction.scope,
    });
    timeTrigger.start();
    stopCron = (): void => {
      timeTrigger.stop();
    };
  }

  const augmentedConfig: LocalMemoryConfig =
    postRememberHook !== undefined
      ? { ...config, postRememberHook }
      : config;

  const memory = new LocalMemory(augmentedConfig, resolvedReflectionPolicy, recallCacheStore);
  const dispose = (): Promise<void> => {
    if (stopCron !== undefined) {
      stopCron();
    }
    return Promise.resolve();
  };
  return Object.assign(memory, { dispose });
}

/** Alias matching the public surface name (T7.2 re-exports). */
export { createLocalMemory as createMemory };

/**
 * Apply pgvector + Drizzle migrations to a Postgres database.
 *
 * For production use: run once at app boot before constructing `createMemory`.
 * Idempotent across BOTH provisioning paths (F-T7.1-2):
 *   1. fresh DB                              → `CREATE EXTENSION` + run migrations
 *   2. already migrated (journal present)    → `migrate()` is a journal-aware no-op
 *   3. schema pushed via `drizzle-kit push`  → detects orphan schema (tables present
 *      but no `__drizzle_migrations` journal), logs a warning, and skips `migrate()`
 *      to avoid "relation already exists" crashes. The push-flow is dev-only;
 *      mixing it with `runMigrations()` in prod is a config smell the warning surfaces.
 *
 * Resolves the migrations folder shipped inside the npm package (`src/local/migrations/`).
 * Consumers do NOT need to know the path — they just provide the pool.
 *
 * Per F-dom-2 + db-migrations CRITICAL #2: addresses the production gap where
 * createLocalMemory previously assumed the schema already existed. Now consumers
 * can either:
 *   - dev:  `npm run db:push` (introspection-based, runs CREATE EXTENSION first via npm script)
 *   - prod: `await runMigrations(pool)` at app boot, then `createMemory({...})`.
 */
/**
 * adapters-openrouter-local-embedder T0.3: post-migration ALTER COLUMN sequence
 * with EC-3 (atomic transaction) + EC-4 (HNSW DROP+RECREATE) absorption.
 *
 * pgvector REJECTS `ALTER COLUMN TYPE` against a column with any index, so
 * both HNSW indexes (`memories_embedding_hnsw_idx` + `entities_embedding_hnsw_idx`
 * at `src/local/migrations/0000_crazy_mimic.sql:44,51`) must be dropped before
 * the ALTER and recreated after. The full DROP → DELETE → ALTER → CREATE
 * sequence runs inside a single BEGIN/COMMIT acquired from a dedicated
 * `pool.connect()` client (SEPA iter-3 pre-RED CRITICAL #1: NEVER nest inside
 * Drizzle's tx; NEVER reuse `pool.query` which autocommits per statement).
 *
 * **DESTRUCTIVE — full cascade collateral disclosure** (plan v1.2 ADR D3 + EC-B
 * amendment, /review F-C1):
 *
 *   The `DELETE FROM memories; DELETE FROM entities;` statements trigger the
 *   following FK cascades from `0000_crazy_mimic.sql` + later migrations:
 *
 *   1. `history.memory_id ON DELETE CASCADE` → entire history audit trail wiped.
 *   2. `consolidation_history.kept_memory_id ON DELETE SET NULL` → v0.7
 *      distillation provenance pointers nullified (audit rows survive but
 *      lose the FK back to the kept memory).
 *   3. `memories.superseded_by` self-FK ON DELETE SET NULL → v0.6 procedural
 *      skill supersession chains broken.
 *
 *   The original plan v1.0 ADR D3 specified `ALTER ... USING NULL` (only the
 *   embedding column data lost). That recipe was empirically rejected by the
 *   existing `vector(1536) NOT NULL` constraint (PG error 23502: "column ...
 *   contains null values" because USING NULL coerces every row's embedding
 *   to NULL then the NOT NULL check fires). The DELETE-before-ALTER pattern
 *   is the explicit form of the destructive-dim-change contract and avoids
 *   the constraint violation, but it widens the data-loss envelope. README
 *   "Destructive dim change caveat" enumerates the full cascade graph.
 *
 * Idempotency short-circuit: probe `pg_attribute.atttypmod` for memories.embedding;
 * if it already matches the requested dim, skip the entire sequence.
 * pgvector v0.5.1 stores `vector(N)` dimension in `atttypmod` directly (NO +4
 * varlena offset — empirically verified against the ankane/pgvector:v0.5.1
 * container in RED test phase; SEPA's training-data claim of `N + 4` was wrong
 * for this version).
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T0.3 + v1.2 ADR D3 amendment
 * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md § EC-3 + EC-4
 * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-review-2026-06-02.md § F-C1
 * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-3-pre-red.md (C1 atomic tx + C2 atttypmod empirical correction)
 */
async function applyDimChange(pool: Pool, targetDim: number): Promise<void> {
  // /review F-Mi8 — defensive extversion probe. The identity decoder
  // (atttypmod stores N directly) was verified empirically against
  // pgvector v0.5.1. If a future pgvector release changes the encoding
  // (e.g., adopts the +4 varlena header SEPA originally claimed), the
  // identity decoder would silently produce a wrong dim → silently
  // mismatched ALTER. Probe the installed pgvector version and warn
  // (not throw — we keep moving so the demo still boots, but the
  // operator sees the canary so they know to re-verify).
  //
  // /review re-run F-dom-db-rerun-residual-M1: `startsWith('0.5.')` is
  // intentional and exhaustive — the trailing dot in the prefix forbids
  // a hypothetical pgvector `0.50.x` from matching (`'0.50.0'.startsWith('0.5.')`
  // is FALSE because the 4th char `'0'` !== `'.'`). So the canary correctly
  // fires on `0.5.x`-NOT-true versions including `0.50.x`, `0.6.x`, `1.x`.
  const ext = await pool.query<{ extversion: string | null }>(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  const installedVersion = ext.rows[0]?.extversion ?? null;
  if (installedVersion !== null && !installedVersion.startsWith('0.5.')) {
    // eslint-disable-next-line no-console
    console.warn(
      `[themory] runMigrations: pgvector extversion=${installedVersion} ` +
        '(adapters-openrouter-local-embedder T0.3 verified the atttypmod identity ' +
        'decoder against v0.5.x). If a future release changes the encoding, ' +
        're-verify dim-change idempotency.',
    );
  }

  // Probe current dim. atttypmod stores N directly for pgvector v0.5.1.
  //
  // /review re-run F-dom-db-rerun-residual-M2: probing ONLY memories.embedding
  // is sufficient because both ALTERs run inside the same BEGIN/COMMIT
  // transaction (see client.query('BEGIN') below). PG guarantees both
  // ALTER COLUMN statements succeed-or-fail atomically — so memories.atttypmod
  // is a faithful proxy for entities.atttypmod. The post-ALTER assertion below
  // verifies both columns explicitly anyway, closing the residual.
  const probe = await pool.query<{ atttypmod: number }>(
    `SELECT a.atttypmod
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'memories'
        AND a.attname = 'embedding'
        AND a.attisdropped = false`,
  );
  const currentDim = probe.rows[0]?.atttypmod ?? -1;
  if (currentDim === targetDim) {
    // Idempotency: schema already at requested dim, skip DROP+ALTER+RECREATE.
    // eslint-disable-next-line no-console
    console.error(
      `[themory] runMigrations: embeddingDim=${String(targetDim)} matches existing schema; no-op.`,
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    `[themory] runMigrations: dim change ${String(currentDim)} → ${String(targetDim)} — DESTRUCTIVE cascade: ` +
      'DELETE FROM memories (FK→history.memory_id ON DELETE CASCADE wipes audit trail; ' +
      'consolidation_history.kept_memory_id ON DELETE SET NULL nullifies v0.7 distillation provenance; ' +
      'memories.superseded_by ON DELETE SET NULL breaks v0.6 supersession chains) + ' +
      'DELETE FROM entities + DROP/RECREATE HNSW indexes (T0.3 / EC-3 + EC-4; plan v1.2 ADR D3; /review F-C1). ' +
      '/review F-M3: src/local/schema.ts still declares vector(1536) literally — ' +
      `DO NOT run \`drizzle-kit push\` against this DB while embeddingDim=${String(targetDim)} ` +
      'is active (push would silently revert the ALTER and drop all rows).',
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP INDEX IF EXISTS memories_embedding_hnsw_idx');
    await client.query('DROP INDEX IF EXISTS entities_embedding_hnsw_idx');
    // semantic-recall-cache-v1-5 T5.1 — cascade dim change to recall_cache so
    // an embedder swap that flows via runMigrations({ embeddingDim }) keeps
    // the cache table aligned with the embedder. EC-2 mismatch detection
    // (probeCacheTableDim) is the LOAD-bearing guard for the orthogonal case
    // (table dim ≠ embedder dim WITHOUT runMigrations). The cache table is
    // optional — `IF EXISTS` guards rule out failure on pre-v1.5 databases.
    await client.query('DROP INDEX IF EXISTS recall_cache_scope_hnsw_idx');
    // T4.1 follow-up to T0.3: `ALTER COLUMN TYPE vector(N) USING NULL`
    // collides with the existing `NOT NULL` constraint (PG error 23502:
    // "column ... contains null values" because every row's existing
    // embedding gets coerced to NULL during the ALTER and then violates
    // the constraint). The destructive-dim-change contract documents
    // that existing embedding data is lost on dim switch — DELETEing
    // the rows first is the explicit form of that contract and avoids
    // the constraint violation. DELETE preserves entity FK rows; the
    // empty `embedding` columns are then ALTERable cleanly.
    await client.query('DELETE FROM memories');
    await client.query('DELETE FROM entities');
    // Cache rows are stale once the embedder dim shifts (cosine across
    // dimensions has no meaning). Safe to DELETE — cache is read-side
    // memoization, not authoritative state.
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'recall_cache') THEN
        DELETE FROM recall_cache;
      END IF;
    END $$`);
    await client.query(`ALTER TABLE "memories" ALTER COLUMN "embedding" TYPE vector(${String(targetDim)})`);
    await client.query(`ALTER TABLE "entities" ALTER COLUMN "embedding" TYPE vector(${String(targetDim)})`);
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'recall_cache') THEN
        EXECUTE 'ALTER TABLE "recall_cache" ALTER COLUMN "query_embedding" TYPE vector(${String(targetDim)})';
      END IF;
    END $$`);
    // /review F-Mi9: match the migration's quoted-identifier style at
    // src/local/migrations/0000_crazy_mimic.sql:44,51 so a future PG
    // case-sensitivity change does not cause a runtime/migration drift.
    await client.query('CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops)');
    await client.query('CREATE INDEX "entities_embedding_hnsw_idx" ON "entities" USING hnsw ("embedding" vector_cosine_ops)');
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'recall_cache') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS "recall_cache_scope_hnsw_idx" ON "recall_cache" USING hnsw ("query_embedding" vector_cosine_ops)';
      END IF;
    END $$`);

    // /review re-run F-dom-pgvector-rerun-2: belt-and-suspenders value-based
    // canary INSIDE the transaction (so an unexpected outcome rolls back
    // cleanly rather than leaking a broken schema). Re-probes atttypmod
    // for memories, entities, AND recall_cache post-ALTER and asserts the
    // actual dim matches targetDim. Protects against:
    //  - hypothetical future pgvector release that changes atttypmod encoding
    //    (F-Mi8 extversion canary warns; this assertion fail-closes)
    //  - PG side-effects we did not anticipate (e.g., DEFAULT clause that
    //    overrides the ALTER, trigger that rewrites the type)
    //  - the entities ALTER silently no-op'ing while memories ALTER succeeds
    //
    // fixes-cycle-1 T1.1 / F-merge-10 absorption: extended to probe
    // `recall_cache.query_embedding` as well (v1.5.0 T5.1 cascade ALTERed
    // that column inside the same BEGIN/COMMIT but the canary only checked
    // memories + entities). The `recall_cache` row is absent on pre-v1.5
    // databases — the `WHERE` clause uses LEFT JOIN-style absence-tolerance:
    // the query simply returns 0-2 rows depending on which tables exist,
    // and the loop verifies each present row. Symmetric with the `DO $$ IF EXISTS`
    // guards on the recall_cache cascade ALTER block above.
    const verify = await client.query<{ rel: string; col: string; dim: number }>(
      `SELECT c.relname AS rel, a.attname AS col, a.atttypmod AS dim
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
        WHERE (
                (c.relname IN ('memories', 'entities') AND a.attname = 'embedding')
             OR (c.relname = 'recall_cache' AND a.attname = 'query_embedding')
              )
          AND a.attisdropped = false
        ORDER BY c.relname`,
    );
    for (const row of verify.rows) {
      if (row.dim !== targetDim) {
        throw new Error(
          `[themory] dim-change post-ALTER canary FAILED: ${row.rel}.${row.col} atttypmod=${String(row.dim)} ≠ targetDim=${String(targetDim)}`,
        );
      }
    }
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.error(
      `[themory] runMigrations: dim change complete; column types vector(${String(targetDim)}); HNSW indexes recreated.`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error(
      `[themory] runMigrations: dim change rolled back; schema preserved at vector(${String(currentDim)})`,
    );
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(
  pool: Pool,
  options?: { readonly embeddingDim?: number },
): Promise<void> {
  // pgvector extension MUST exist before tables with vector columns can be created.
  // Idempotent; safe to re-run.
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

  // Detect the "drizzle-kit push" footgun: schema present but not journal-tracked.
  // Without this guard, `migrate()` would throw "relation already exists" on re-run.
  const journalCheck = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
     ) AS exists`,
  );
  const journalExists = journalCheck.rows[0]?.exists === true;

  if (!journalExists) {
    const memoriesCheck = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'memories'
       ) AS exists`,
    );
    const memoriesExists = memoriesCheck.rows[0]?.exists === true;
    if (memoriesExists) {
      // Schema present but not journal-tracked → push-flow was used. Skip migrate()
      // gracefully; this is a deployment-config smell, not a runtime error.
      // /review F-M13: warning text must honestly state that we still apply the
      // explicit dim change when caller passed options.embeddingDim — only the
      // migrate() call is skipped, not the entire runMigrations() invocation.
      // eslint-disable-next-line no-console
      console.warn(
        '[themory] schema present but `drizzle.__drizzle_migrations` journal missing. ' +
          'Likely `drizzle-kit push` was used — skipping migrate(); ' +
          'applying explicit dim change only when options.embeddingDim is set. ' +
          'For production reproducibility, prefer `runMigrations()` on a fresh DB (F-T7.1-2).',
      );
      // T4.1 follow-up to T0.3: dim change must STILL apply on push-flow DBs.
      // SEPA pre-RED iter-3 M3 was wrong to say "place AFTER orphan-schema
      // short-circuit" — surfaced empirically by T4.1 live integration test
      // (the demo's existing dev DB was push-flow + dim change silently
      // skipped). When the operator explicitly passes embeddingDim, intent
      // is clear: apply the dim change regardless of journal state.
      // /review F-M4: do NOT short-circuit on `embeddingDim === MAX_EMBEDDING_DIM`.
      // The asymmetric guard blocked the legitimate 384 → 1536 revert (operator
      // switches local-openrouter → openai). The inner atttypmod probe in
      // applyDimChange already handles idempotency cleanly when the schema
      // already matches the requested dim.
      if (options?.embeddingDim !== undefined) {
        await applyDimChange(pool, options.embeddingDim);
      }
      return;
    }
  }

  // Resolve migrations folder shipped inside this package.
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolvePath(here, 'migrations');

  const db = drizzleNodePostgres(pool);
  await migrate(db, { migrationsFolder });

  // T0.3: post-migration parametric dim change for journal-tracked DBs.
  // Idempotency short-circuit in applyDimChange covers re-runs.
  // /review F-M4: same symmetry — always invoke when caller passes embeddingDim;
  // the inner atttypmod probe is the single source of truth for no-op detection.
  if (options?.embeddingDim !== undefined) {
    await applyDimChange(pool, options.embeddingDim);
  }
}
