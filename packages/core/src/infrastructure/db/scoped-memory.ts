/**
 * LocalScopedMemory — the scoped memory implementation for the local runtime.
 *
 * Extracted from index.ts (T1.1 of architecture-review-fixes plan).
 * Contains the LocalScopedMemory class and helper functions it depends on.
 */
import type { RecallCacheStore, RecallCacheStoreConfig } from '../../domain/dip/recall-cache-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import type { ConflictResolutionResult } from '../../domain/dip/conflict-resolution-policy.js';
import {
  InvalidScope,
  ReflectionNotConfigured,
} from '../../domain/errors.js';
import { runExtractionPipeline } from '../../domain/extraction/pipeline.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { MemoryItem, MemoryItemWithScore } from '../../domain/memory-item.js';
import type { ScopedMemory } from '../../domain/memory-store.js';
import type { Message } from '../../domain/message.js';
import type {
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from '../../domain/options.js';
import { executeReflection } from '../../domain/reflection/execute.js';
import { validateProvenance } from '../../domain/reflection/provenance.js';
import type { ReflectionResult } from '../../domain/reflection-result.js';
import { runRetrievalPipeline } from '../../domain/retrieval/pipeline.js';
import type { Filters, Scope } from '../../domain/scope.js';

import type { LocalMemoryConfig } from './config.js';

/**
 * v0.6 (T2.2): translate skill-aware RecallOptions / GetAllOptions flags into
 * `Filters.kind` + `Filters.excludeSuperseded` before the store call.
 *
 * `includeSuperseded` defaults to `false` (recall returns only tip-of-chain),
 * so when the caller omits the option we still emit `excludeSuperseded=true`
 * — BUT only when `onlySkills` is also set, so v0.4a callers see no change.
 */
export function applySkillFilters(
  baseFilters: Filters,
  options?: {
    onlySkills?: boolean;
    includeSuperseded?: boolean;
    attributedTo?: string;
    asOf?: Date;
    category?: string;
  },
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
  // themory-category-filter-server-side T4.1 / EC-3 — route GetAllOptions.category
  // into Filters.category for server-side filter at the pgvector + in-memory
  // adapters. Empty string normalizes to no-filter at this boundary (defense-
  // in-depth alongside REST zod min(1) validation); direct SDK callers passing
  // {category: ''} get the same result as omitting the option entirely.
  if (options.category !== undefined && options.category !== '') {
    base = { ...base, category: options.category };
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

export function filtersFromScope(scope: Scope): Filters {
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

export function assertScopeIsNonEmpty(scope: Scope): void {
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
export function deriveScopeFromPayload(payload: Readonly<Record<string, unknown>>): Scope | undefined {
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

export function scopeToCounterTuple(scope: Scope): {
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

export class LocalScopedMemory implements ScopedMemory {
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
