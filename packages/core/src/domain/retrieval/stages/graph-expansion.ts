/**
 * Step 8.7 — graph-aware recall pool-expansion (graph-aware-recall; M19 / #124, extracted from
 * pipeline.ts).
 *
 * Traverses the entity graph from the top `scored` seeds and APPENDS connected memories (not
 * already in `scored`) with a graph-derived score BANDED strictly below the lowest genuine
 * threshold-passing score (so a graph hit NEVER outranks a real semantic hit). Dedups against the
 * pool (EC-1). Fail-soft (ADR D4): a traversal error emits `recall_graph_failed` and returns the
 * original pool.
 */
import type { Tracer } from '@opentelemetry/api';

import type { GraphExpansionStore } from '../../dip/graph-expansion-store.js';
import { emitEvent } from '../../memory-event.js';
import type { Filters } from '../../scope.js';

import type { ScoredRow } from './threshold-filter.js';

/**
 * Band factor (< 1) applied to a graph-expanded row's score so it sorts strictly BELOW the lowest
 * genuine threshold-passing score — a graph hit never outranks a real semantic match (ADR D3).
 */
const GRAPH_SCORE_BAND_FACTOR = 0.999;

export async function applyGraphExpansionStage(
  scoredSorted: readonly ScoredRow[],
  store: GraphExpansionStore,
  filters: Filters,
  opts: { readonly hops?: 1 | 2; readonly limit?: number },
  topK: number,
  scopeTier: string,
  tracer: Tracer | undefined,
): Promise<readonly ScoredRow[]> {
  if (scoredSorted.length === 0) {
    return scoredSorted; // no seeds → nothing to expand from
  }
  try {
    const hops = opts.hops ?? 1;
    const limit = opts.limit ?? topK;
    const seedIds = scoredSorted.slice(0, topK).map((r) => r.id);
    const seedSet = new Set(scoredSorted.map((r) => r.id));
    const expanded = await store.expandByEntities({ seedMemoryIds: seedIds, filters, hops, limit });
    // EC-1: dedup against the existing pool (a connected row may already be in `scored`).
    const fresh = expanded.filter((e) => !seedSet.has(e.result.id));
    if (fresh.length === 0) {
      return scoredSorted; // no-op (no event — no-op observability discipline)
    }
    // ADR D3 banded score: strictly below the lowest genuine threshold-passing score so a graph
    // hit NEVER outranks a real semantic match (Princípio 2). `floor` is the MIN over the WHOLE
    // threshold-passing pool (not just topK) so even if topK truncates later, every graph hit
    // stays below every genuine hit present in the pool.
    const lowestSeedScore = Math.min(...scoredSorted.map((r) => r.score));
    const floor = lowestSeedScore > 0 ? lowestSeedScore : 0.000_001;
    const graphRows: ScoredRow[] = fresh.map((e) => ({
      id: e.result.id,
      payload: { ...e.result.payload },
      // GRAPH_SCORE_BAND_FACTOR (< 1) pushes graph hits strictly below `floor`; the sharedEntities
      // ratio ∈ (0,1) orders them among themselves by how many entities they share with the seeds.
      score: floor * GRAPH_SCORE_BAND_FACTOR * (e.sharedEntities / (e.sharedEntities + 1)),
    }));
    const merged = [...scoredSorted, ...graphRows].sort((a, b) => b.score - a.score);
    emitEvent(tracer, 'recall_graph_expanded', {
      scope_tier: scopeTier,
      seeds: seedIds.length,
      expanded: graphRows.length,
      hops,
    });
    return merged;
  } catch (err) {
    // ADR D4 fail-soft — a graph-store outage NEVER takes down recall.
    emitEvent(tracer, 'recall_graph_failed', {
      scope_tier: scopeTier,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return scoredSorted;
  }
}
