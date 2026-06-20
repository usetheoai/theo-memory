/**
 * createLocalMemory factory + cache/embedding helpers.
 *
 * Extracted from index.ts (T1.3 of architecture-review-fixes plan).
 */
import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import {
  type RecallCacheStore,
  validateRecallCacheStoreConfig,
} from '../../domain/dip/recall-cache-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import {
  EmbeddingMismatch,
  InvalidCacheConfig,
  InvalidEmbeddingDim,
} from '../../domain/errors.js';
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
import { type DisposableMemory, LocalMemory } from './local-memory.js';
import { PgMemoryEntityStore } from './pg-memory-entity-store.js';
import { PgvectorStore as PgvectorStoreClass } from './pgvector-store.js';

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
 * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md § EC-1
 * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-1-pre-red.md (CRITICAL #1 — uniform InvalidScope for all pre-flight failures)
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
  await probeEmbedder(config.embedder, effectiveDim);
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
        }
      : config;

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
    const memory = new LocalMemory(baseConfig, resolvedReflectionPolicy, recallCacheStore);
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
      ? { ...baseConfig, postRememberHook }
      : baseConfig;

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
