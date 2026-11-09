/**
 * createLocalMemory factory + cache/embedding helpers.
 *
 * Extracted from index.ts (T1.3 of architecture-review-fixes plan).
 */
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import {
  type RecallCacheStore,
  validateRecallCacheStoreConfig,
} from '../../domain/dip/recall-cache-store.js';
import {
  type RecallTraceStore,
  type RecallTraceStoreConfig,
  validateRecallTraceStoreConfig,
} from '../../domain/dip/recall-trace-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import {
  EmbeddingMismatch,
  InvalidCacheConfig,
  InvalidEmbeddingDim,
  InvalidRecallTraceConfig,
} from '../../domain/errors.js';
import { resolveOntology } from '../../domain/ontology.js';
import type { Scope } from '../../domain/scope.js';
import { CompromiseEntityExtractor } from '../extraction/compromise-entity-extractor.js';

import {
  emitStubEmbedderCacheWarning,
  isRecallCacheStoreInstance,
  isStubEmbedder,
  probeCacheTableDim,
} from './cache-helpers.js';
import type { LocalMemoryConfig } from './config.js';
import { EvictionNotSupported, PROBE_TEXT } from './config.js';
import {
  CapacityBasedTrigger,
  PgEvictor,
  PgHalfLifePersister,
  PgNearestNeighborProvider,
  TimeBasedTrigger,
  TriadicScoringPolicy,
} from './eviction/index.js';
import { DrizzleHistoryManager } from './history-manager.js';
import { InMemoryMessageLog } from './in-memory-message-log.js';
import { type DisposableMemory, LocalMemory } from './local-memory.js';
import { PgGraphExpansionStore } from './pg-graph-expansion-store.js';
import { PgMemoryEntityStore } from './pg-memory-entity-store.js';
import { PgMemoryGraphStore } from './pg-memory-graph-store.js';
import { PgMessageLog } from './pg-message-log.js';
import { PgUsageCounterStore } from './pg-usage-counter-store.js';
import { PgvectorStore as PgvectorStoreClass } from './pgvector-store.js';
import { type CreateMemoryPresetConfig, isPresetConfig, resolvePreset } from './preset.js';
import { configureWorkspaceWritesFromPool, isTenantScopedPool } from './workspace-write-scope.js';

// Re-export cache helpers so existing importers from factory.ts still work
export {
  isRecallCacheStoreInstance,
  probeCacheTableDim,
  isStubEmbedder,
  emitStubEmbedderCacheWarning,
} from './cache-helpers.js';

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
export async function resolveRecallCacheStore(
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

/** Duck-type guard: is `v` an already-constructed RecallTraceStore (vs a POJO config)? */
function isRecallTraceStoreInstance(
  v: RecallTraceStoreConfig | RecallTraceStore,
): v is RecallTraceStore {
  return (
    typeof (v as RecallTraceStore).record === 'function' &&
    typeof (v as RecallTraceStore).getByRecallId === 'function'
  );
}

/**
 * explainable-recall (S1) — opt-in resolver for the recall-trace store.
 * Mirrors {@link resolveRecallCacheStore}: returns `undefined` when not opted in
 * (default OFF); a `RecallTraceStore` instance is used as-is; a POJO config is
 * validated FIRST (SEPA T2.1 — the constructor does not self-validate, so a bad
 * `maxRowsPerRecall` must fail HERE, not silently at first recall), then backed
 * by the default `PgRecallTraceStore`.
 *
 * EC-3: probes that the `recall_traces` table EXISTS and fails-fast with a clear
 * error — enabling tracing without the migration would (fail-soft, D3) silently
 * write nothing forever.
 */
export async function resolveRecallTraceStore(
  config: LocalMemoryConfig,
): Promise<RecallTraceStore | undefined> {
  const optIn = config.recallTrace;
  if (optIn === undefined) return undefined;
  if (isRecallTraceStoreInstance(optIn)) {
    return optIn;
  }
  validateRecallTraceStoreConfig(optIn); // EC-1 — fail-fast before any DB call.
  if (!(config.vectorStore instanceof PgvectorStoreClass)) {
    throw new InvalidRecallTraceConfig(
      `recallTrace config requires a PgvectorStore vector store (got ` +
        `${config.vectorStore.constructor.name}); supply a custom RecallTraceStore ` +
        `instance for a non-Postgres backend.`,
    );
  }
  const pool = config.vectorStore.poolForEviction;
  const { PgRecallTraceStore } = await import('./recall-trace/pg-recall-trace-store.js');
  // A tenant-scoped pool has no workspace at construction time and refuses the
  // catalog probe below outright (#225). Its composition root — the server —
  // runs migrations on the raw pool before building the Memory, which is what
  // puts the table there.
  if (isTenantScopedPool(pool)) return new PgRecallTraceStore(pool, optIn);
  // EC-3 — the recall_traces table MUST exist (migration 0023) or tracing would
  // fail-soft-silently forever. Fail-fast at construction instead.
  const probe = await pool.query<{ reg: string | null }>(
    `SELECT to_regclass('recall_traces') AS reg`,
  );
  if (probe.rows[0]?.reg == null) {
    throw new InvalidRecallTraceConfig(
      'recall_traces table not found — run runMigrations(pool) (migration 0023) ' +
        'BEFORE createLocalMemory({ recallTrace }). Enabling tracing without the ' +
        'table would silently write nothing.',
    );
  }
  return new PgRecallTraceStore(pool, optIn);
}

// ── Embedding helpers ───────────────────────────────────────────────────

export async function probeEmbedder(embedder: Embedder, expectedDim: number): Promise<void> {
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
 */
export function validateEmbeddingDim(received: number | undefined): number {
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

// ── Factory ─────────────────────────────────────────────────────────────

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
  // domain-ontologies T3.1 (ADR D4) — fail-fast on an invalid ontology config
  // (unknown registry key / malformed custom Ontology) BEFORE any side effect.
  if (config.ontology !== undefined) {
    resolveOntology(config.ontology);
  }
  await probeEmbedder(config.embedder, effectiveDim);

  // De onde virá o `workspace_id` de toda linha nova, decidido AQUI — o único
  // construtor, compartilhado pelo servidor multi-inquilino e pelo SDK local.
  // O critério é o POOL, não uma variável de ambiente: um pool marcado por
  // `tenantScopedPool` garante contexto em cada conexão e mantém o modo
  // estrito; um pool cru é o modo single-tenant, declarado e anunciado.
  // O boot do servidor confirma o resultado com `requireStrictWorkspaceWrites`.
  const poolForWriteMode = (config.vectorStore as { poolForEviction?: Pool }).poolForEviction;
  if (poolForWriteMode !== undefined) {
    configureWorkspaceWritesFromPool(poolForWriteMode);
  }

  await config.vectorStore.initialize();

  // entity-extraction-nodes-slice1 T3.1 — wire Phase 7 ports when entityBoost is
  // not disabled AND the store is a PgvectorStore (we need its pool). Default ON
  // per ADR-0007 (entityBoost !== false). A consumer MAY inject their own ports.
  // Both downstream LocalMemory paths (eviction-on/off) read `baseConfig`.
  const baseConfig: LocalMemoryConfig =
    config.entityBoost !== false && config.vectorStore instanceof PgvectorStoreClass
      ? {
          ...config,
          entityExtractor: config.entityExtractor ?? new CompromiseEntityExtractor(),
          memoryEntityStore:
            config.memoryEntityStore ?? new PgMemoryEntityStore(config.vectorStore.poolForEviction),
          // slice2 T3.2 — edge port, same gate + same pool as the node port.
          memoryGraphStore:
            config.memoryGraphStore ?? new PgMemoryGraphStore(config.vectorStore.poolForEviction),
          // graph-aware-recall T4.3 — recall-time traversal port, same gate + pool.
          // Auto-defaulted so `recall({ graphExpand })` works without explicit wiring.
          graphExpansionStore:
            config.graphExpansionStore ?? new PgGraphExpansionStore(config.vectorStore.poolForEviction),
          // T2.2 — recall usage counter, same gate + same pool (one pool so the
          // recall-path write and the metrics-path read hit the same DB).
          usageCounterStore:
            config.usageCounterStore ?? new PgUsageCounterStore(config.vectorStore.poolForEviction),
        }
      : config;
  // #236 — the audit trail is on by default over Postgres; an explicit key, even `undefined`, wins.
  const withHistory: LocalMemoryConfig =
    !('historyManager' in config) && config.vectorStore instanceof PgvectorStoreClass
      ? { ...baseConfig, historyManager: new DrizzleHistoryManager(drizzleNodePostgres(config.vectorStore.poolForEviction)) }
      : baseConfig;
  // ADR-0027 — raw message log, on by default; an explicit port or `false` wins.
  const withMessageLog: LocalMemoryConfig = config.messageLog !== undefined
    ? withHistory
    : {
        ...withHistory,
        messageLog: config.vectorStore instanceof PgvectorStoreClass
          ? new PgMessageLog(config.vectorStore.poolForEviction)
          : new InMemoryMessageLog(),
      };

  // semantic-recall-cache-v1-5 T2.1 — opt-in cache wiring.
  // Resolved BEFORE the eviction branch so both eviction-on and eviction-off
  // paths get the cache (the two features are orthogonal — eviction touches
  // memories; cache touches recall_cache).
  const recallCacheStore = await resolveRecallCacheStore(config, effectiveDim);
  // explainable-recall (S1) — opt-in recall-trace store (orthogonal to cache +
  // eviction; validates config + probes the recall_traces table fail-fast).
  const recallTraceStore = await resolveRecallTraceStore(config);

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
    const memory = new LocalMemory(
      withMessageLog,
      resolvedReflectionPolicy,
      recallCacheStore,
      undefined,
      recallTraceStore,
    );
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

  let postRememberHook: ((scope: Scope, workspaceId?: string) => Promise<void>) | undefined;
  let stopCron: (() => void) | undefined;

  if (config.eviction.trigger === 'capacity') {
    const capacityTrigger = new CapacityBasedTrigger(
      pool,
      policy,
      config.eviction.maxMemoriesPerScope,
    );
    // multi-tenant-rbac-and-slice1-completion T3.1: forward the binding's
    // workspace so the capacity pass evicts only within the writing tenant.
    postRememberHook = async (scope: Scope, workspaceId?: string): Promise<void> => {
      await capacityTrigger.fire(scope, new Date(), workspaceId);
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
      ? { ...withMessageLog, postRememberHook }
      : withMessageLog;

  const memory = new LocalMemory(
    augmentedConfig,
    resolvedReflectionPolicy,
    recallCacheStore,
    undefined,
    recallTraceStore,
  );
  const dispose = (): Promise<void> => {
    if (stopCron !== undefined) {
      stopCron();
    }
    return Promise.resolve();
  };
  return Object.assign(memory, { dispose });
}

/**
 * Public entry point. Accepts EITHER the zero-config preset shape
 * `{ postgres, openai?, migrate? }` OR the full {@link LocalMemoryConfig}
 * (discriminated by the `postgres` field). Preset input is routed to
 * {@link resolvePreset} (wires OpenAI adapters + PgvectorStore + pool +
 * migrations); full config delegates VERBATIM to {@link createLocalMemory}.
 *
 * Non-breaking: existing full-config callers and `createLocalMemory` are
 * untouched; the preset shape is a new accepted input (create-memory-preset
 * plan D1).
 */
export function createMemory(
  config: CreateMemoryPresetConfig | LocalMemoryConfig,
): Promise<DisposableMemory> {
  return isPresetConfig(config) ? resolvePreset(config) : createLocalMemory(config);
}
