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

import type { EntityExtractor } from '../../domain/dip/entity-extractor.js';
import type { MemoryEntityStore } from '../../domain/dip/memory-entity-store.js';
import type { MemoryGraphStore } from '../../domain/dip/memory-graph-store.js';
import type {
  RecallCacheStore,
  RecallCacheStoreConfig,
} from '../../domain/dip/recall-cache-store.js';
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
   * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T4.1 + ADR D6
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
