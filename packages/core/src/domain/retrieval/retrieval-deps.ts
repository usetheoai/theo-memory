/**
 * Dependency bag for `runRetrievalPipeline` (M19 / #124; extracted from pipeline.ts). The public
 * contract of the recall pipeline — re-exported from pipeline.ts for barrel stability.
 */
import type { Tracer } from '@opentelemetry/api';

import type { AdaptiveRetrievalPolicy } from '../dip/adaptive-retrieval-policy.js';
import type { Embedder } from '../dip/embedder.js';
import type { GraphExpansionStore } from '../dip/graph-expansion-store.js';
import type { MemoryEntityStore } from '../dip/memory-entity-store.js';
import type { RecallTraceStore } from '../dip/recall-trace-store.js';
import type { Reranker } from '../dip/reranker.js';
import type { VectorStore } from '../dip/vector-store.js';

export interface RetrievalDeps {
  readonly vectorStore: VectorStore;
  readonly embedder: Embedder;
  /**
   * cross-encoder-reranker (Item 23) — optional post-threshold reranker.
   * When present AND `options.rerank` is set, the threshold-passing pool is
   * reranked before topK truncation (ADR D3). Absent ⇒ rerank is a no-op.
   */
  readonly reranker?: Reranker;
  /**
   * adaptive-retrieval (Item 13) — optional adaptive policy. When present, the
   * pipeline runs the `assess` grade-and-correct stage (Step 8.6) after the
   * threshold filter. Absent ⇒ no adaptive stage (default OFF, byte-unchanged).
   * The `shouldRetrieve` pre-embed gate runs in `scoped-memory.ts`
   * (before this pipeline), not here.
   */
  readonly retrievalPolicy?: AdaptiveRetrievalPolicy;
  /**
   * graph-aware-recall — optional entity-graph traversal store. When present AND
   * `options.graphExpand` is set, Step 8.7 pool-expands the results with memories
   * connected by shared entities/relations. Absent ⇒ no graph stage (default OFF).
   */
  readonly graphExpansionStore?: GraphExpansionStore;
  /**
   * explainable-recall (S1) — optional recall-trace store. When present AND
   * `recallTraceContext` is also set (both required, EC-5), the pipeline writes
   * one row per DROPPED candidate (accountable forgetting). The write is a
   * fail-soft side-effect (D3) that NEVER alters the returned set. Absent ⇒ no
   * trace (default OFF, byte-unchanged return).
   */
  readonly recallTrace?: RecallTraceStore;
  /**
   * explainable-recall (S1) — per-recall trace context: the server-minted
   * `recallId`, the tenant `workspaceId`/`scopeKey` (resolved in
   * `scoped-memory.ts`, EC-2), and `maxRows` (the resolved `maxRowsPerRecall`,
   * threaded so the pipeline truncates without reading the 2-method DIP —
   * Finding A). Required alongside `recallTrace` for the write to fire (EC-5).
   */
  readonly recallTraceContext?: {
    readonly recallId: string;
    readonly workspaceId: string;
    readonly scopeKey: string;
    readonly maxRows: number;
  };
  /**
   * M15 T3.1 (#122) — read side of the entity graph, used to populate the entity boost in
   * Step 6. Optional: an installation without a populated graph (everything before M13)
   * behaves exactly as it does today, with the boost simply absent.
   *
   * Narrowed to the single method the pipeline needs rather than the whole
   * `MemoryEntityStore` — the recall path has no business seeing `upsertAndLink` or
   * `forgetEntity` (ISP).
   */
  readonly entityBoostStore?: Pick<MemoryEntityStore, 'linkedKeysForMemories'> | undefined;

  /** Ceiling for the entity lookup; the boost degrades rather than blocking recall. */
  readonly timeoutMs?: number | undefined;

  readonly tracer?: Tracer;
}

