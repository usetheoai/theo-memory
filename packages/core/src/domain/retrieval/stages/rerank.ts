/**
 * Step 8.5a — cross-encoder rerank stage (M19 / #124; extracted from pipeline.ts for cohesion).
 *
 * Reranks the cosine-sorted top `pool` (default topK*4, bounded), truncates to topK. Fail-soft
 * (ADR D4): on inference failure, emit `recall_rerank_failed` and degrade to the original cosine
 * order — a reranker outage MUST NEVER take down recall.
 */
import type { Tracer } from '@opentelemetry/api';

import type { Reranker } from '../../dip/reranker.js';
import { emitEvent } from '../../memory-event.js';
import type { MemoryItemWithScore } from '../../memory-item.js';

import type { Payload } from './threshold-filter.js';

export async function applyRerankStage(
  query: string,
  scored: readonly { id: string; payload: Payload; score: number }[],
  reranker: Reranker,
  rerankOpts: { readonly topK?: number; readonly pool?: number },
  topK: number,
  rowToItem: (row: { id: string; payload: Payload; score: number }) => MemoryItemWithScore,
  tracer: Tracer | undefined,
): Promise<readonly MemoryItemWithScore[]> {
  const rerankTopK = rerankOpts.topK ?? topK;
  const pool = rerankOpts.pool ?? topK * 4;
  const poolItems = scored.slice(0, pool).map(rowToItem);
  try {
    const reranked = await reranker.rerank(query, poolItems, rerankTopK);
    emitEvent(tracer, 'extraction_completed', { results: reranked.length });
    return reranked;
  } catch (err) {
    // ADR D4 fail-soft — observable degradation, then cosine fallback.
    emitEvent(tracer, 'recall_rerank_failed', {
      error: err instanceof Error ? err.name : 'unknown',
    });
    const fallback = scored.slice(0, rerankTopK).map(rowToItem);
    emitEvent(tracer, 'extraction_completed', { results: fallback.length });
    return fallback;
  }
}
