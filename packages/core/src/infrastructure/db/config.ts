/**
 * LocalMemoryConfig + EvictionNotSupported + PROBE_TEXT — shared configuration
 * types used across the db module.
 *
 * Extracted to break a circular dependency: scoped-memory.ts and factory.ts
 * both need LocalMemoryConfig; factory.ts instantiates LocalScopedMemory
 * (via LocalMemory). Placing the config in its own leaf module avoids
 * factory ↔ scoped-memory cycles.
 *
 * Part of T1.1 of the architecture-review-fixes plan.
 */
import type { Tracer } from '@opentelemetry/api';

import type { AdaptiveRetrievalPolicy } from '../../domain/dip/adaptive-retrieval-policy.js';
import type { EntityExtractor } from '../../domain/dip/entity-extractor.js';
import type { GraphExpansionStore } from '../../domain/dip/graph-expansion-store.js';
import type { MemoryEntityStore } from '../../domain/dip/memory-entity-store.js';
import type { MemoryGraphStore } from '../../domain/dip/memory-graph-store.js';
import type { MessageLog } from '../../domain/dip/message-log.js';
import type {
  RecallCacheStore,
  RecallCacheStoreConfig,
} from '../../domain/dip/recall-cache-store.js';
import type {
  RecallTraceStore,
  RecallTraceStoreConfig,
} from '../../domain/dip/recall-trace-store.js';
import type { Reranker } from '../../domain/dip/reranker.js';
import type { RoutingAuditStore } from '../../domain/dip/routing-audit-store.js';
import type { SkillExecutor } from '../../domain/dip/skill-executor.js';
import type { UsageCounterStore } from '../../domain/dip/usage-counter-store.js';
import type { AutoCategorizeConfig } from '../../domain/extraction/taxonomy.js';
import type { MemoryConfig } from '../../domain/memory-store.js';
import type { Scope } from '../../domain/scope.js';

import type { LocalEvictionConfig } from './eviction/index.js';

/** Extended MemoryConfig with the OTel tracer slot from ADR D1.3. */
export interface LocalMemoryConfig extends MemoryConfig {
  readonly tracer?: Tracer;
  /**
   * v0.4b-fixes T4.1 — opt-in eviction pipeline. Requires `vectorStore` to
   * be a `PgvectorStore` instance (advisory locks + pgvector cosine distance
   * are PG-only). `createLocalMemory` throws `EvictionNotSupported` when this
   * field is set with an `InMemoryVectorStore`.
   *
   */
  readonly eviction?: LocalEvictionConfig;
  /**
   * @internal v0.4b-fixes T4.1 — async hook fired by `LocalScopedMemory.remember()`
   * post-pipeline. Used by the factory to wire `CapacityBasedTrigger.fire()`
   * when `eviction.trigger === 'capacity'`. NOT a public field; consumers
   * configure eviction via the `eviction` option above.
   */
  readonly postRememberHook?: (scope: Scope, workspaceId?: string) => Promise<void>;
  /**
   * entity-extraction-nodes-slice1 T3.1 — Phase 7 entity-linking ports. Built by
   * `createLocalMemory` (CompromiseEntityExtractor + PgMemoryEntityStore) when
   * `entityBoost !== false` AND the vector store is a PgvectorStore. A consumer
   * MAY inject their own; both must be present for Phase 7 to run.
   */
  readonly entityExtractor?: EntityExtractor;
  readonly memoryEntityStore?: MemoryEntityStore;
  /**
   * entity-relation-extraction-slice2 T3.2 — Phase 7 edge port. Built by
   * `createLocalMemory` (PgMemoryGraphStore) under the same gate as the node
   * ports. A consumer MAY inject their own.
   */
  readonly memoryGraphStore?: MemoryGraphStore;
  /**
   * ADR-0029 — supersession on write. On by default: when a new fact makes an existing memory
   * of the scope no longer true, the extractor names it and the store sets its `t_invalid` to
   * the new fact's valid time. The old memory leaves current recall, stays readable through
   * `asOf`, and the change is recorded in `history` as `supersede`. `false` keeps every memory
   * current until a forget or a reflect.
   */
  readonly supersedeOnWrite?: boolean;
  /**
   * ADR-0027 — raw message log. On by default: `createLocalMemory` builds a PgMessageLog over a
   * PgvectorStore's pool, or an InMemoryMessageLog otherwise. Every write is logged and linked to
   * the memories it produced, and the extractor sees the scope's preceding turns as context. A hard
   * forget erases a memory's source messages. `false` disables the log.
   */
  readonly messageLog?: MessageLog | false;
  /** How many preceding turns the extractor sees (default 10, DEFAULT_CONTEXT_MESSAGE_COUNT). */
  readonly contextMessageCount?: number;
  /**
   * themory-scoped-forget-and-retrieval-counter T2.2 — per-scope recall counter
   * port (`retrieval_api_usage`). Built by `createLocalMemory` (PgUsageCounterStore)
   * under the same gate as the entity/graph ports. The recall path increments it
   * fail-soft (T2.3); the metrics handler reads it (T2.4). A consumer MAY inject
   * their own; when absent, recall does not count (and metrics falls back to 0).
   */
  readonly usageCounterStore?: UsageCounterStore;
  /**
   * M11 — optional routing-audit port. When wired, a session→global PROMOTION (M9 reflect) emits a
   * fail-soft placement-decision audit row, so `every promotion decision is a queryable audit record`
   * (ROADMAP M11 DoD). Omitted → promotions are not audited (opt-in, no regression).
   */
  readonly routingAuditStore?: RoutingAuditStore;
  /**
   * agentic-skill-execution-sandbox T2.2 — opt-in `SkillExecutor` enabling
   * `Memory.skills(repoId).execute(skillId, args)`. When absent, `execute()`
   * throws `SkillExecutionNotConfiguredError` (ADR D3 — execution is opt-in/gated;
   * STORE-only is the default). Threaded into `LocalScopedSkillMemory` by the
   * `skills()` factory. The default impl is `SandboxedSkillExecutor` (isolated-vm,
   * optional addon); a consumer enables execution by passing one explicitly.
   *
   */
  readonly skillExecutor?: SkillExecutor;
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
   * @see src/core/dip/recall-cache-store.ts (13th DIP)
   */
  readonly recallCache?: RecallCacheStoreConfig | RecallCacheStore;
  /**
   * explainable-recall (S1) — opt-in "accountable forgetting" recall trace.
   * A POJO `RecallTraceStoreConfig` uses the default `PgRecallTraceStore`
   * (requires a `PgvectorStore` vector store + the `recall_traces` table); a
   * `RecallTraceStore` instance is used as-is. Absent ⇒ no tracing (default
   * OFF, byte-unchanged recall). Deployment-level: when set, EVERY recall in
   * this deployment is traced.
   *
   * @see packages/core/src/domain/dip/recall-trace-store.ts (14th DIP)
   */
  readonly recallTrace?: RecallTraceStoreConfig | RecallTraceStore;
  /**
   * cross-encoder-reranker T4.1 — opt-in `Reranker` enabling a post-threshold
   * cross-encoder rerank stage. When present AND a recall sets `options.rerank`,
   * the threshold-passing pool is reranked before topK truncation (ADR D3).
   * Absent ⇒ `options.rerank` is a no-op (results pass through cosine-sorted).
   * The default impl is `CrossEncoderReranker` (`@usetheo/memory/reranker-local`,
   * @xenova — optional addon); a consumer enables reranking by passing one.
   *
   * Setting `options.rerank` BYPASSES the recall cache (ADR D6) — the v1.5
   * cache key does not include rerank, so a reranked request runs the full
   * pipeline (no get, no set).
   *
   * @see src/domain/dip/reranker.ts
   */
  readonly reranker?: Reranker;

  /**
   * auto-categorization-write-pipeline (F-H1) — default-on model-derived category.
   * Absent ⇒ default-on with {@link DEFAULT_CATEGORY_TAXONOMY}. Set
   * `{ enabled: false }` to restore operator-only category behavior, or supply a
   * `taxonomy` to override the fixed list. Threaded into `ExtractionDeps` by
   * `scoped-memory.ts` (like `ontology`). An operator `RememberOptions.category`
   * always overrides the auto-derived value.
   *
   */
  readonly autoCategorize?: AutoCategorizeConfig;

  /**
   * adaptive-retrieval (Roadmap Item 13) — optional adaptive policy. When
   * present, recall runs the `shouldRetrieve` pre-embed gate (in
   * `scoped-memory.ts`, may skip retrieval) + the `assess` grade-and-correct
   * (pipeline Step 8.6, may relax the threshold). Absent ⇒ default OFF, the
   * pipeline is byte-identical to v0.17 (opt-in per ADR D4). `RecallOptions.adaptive`
   * forwards per-call tuning. The default impl is `HeuristicAdaptiveRetrievalPolicy`
   * (`@usetheo/memory/adaptive-local`, key-free, no new dependency).
   *
   * @see src/domain/dip/adaptive-retrieval-policy.ts
   */
  readonly retrievalPolicy?: AdaptiveRetrievalPolicy;

  /**
   * graph-aware-recall — optional entity-graph traversal store. When present AND
   * a recall sets `options.graphExpand`, the pipeline (Step 8.7) pool-expands the
   * results with memories connected by a shared entity / relation edge over the
   * EXISTING `entities`/`memory_entities`/`entity_edges` tables. Absent ⇒ default
   * OFF (byte-unchanged). The default impl is `PgGraphExpansionStore` (the JOIN),
   * auto-instantiated by the factory from the pool when the vector store exposes
   * one (mirrors `memoryGraphStore`). NO new dependency, NO migration.
   *
   * @see src/domain/dip/graph-expansion-store.ts
   */
  readonly graphExpansionStore?: GraphExpansionStore;
}

/**
 * Thrown when `createLocalMemory({ eviction: {...} })` is called with a
 * non-PgvectorStore vector store. Advisory locks + pgvector cosine distance
 * are PG-only; eviction is not implemented for `InMemoryVectorStore`.
 *
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
