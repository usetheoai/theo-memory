/**
 * 9-step search pipeline — T5.1 of v0-1-local-runtime plan v1.3.
 *
 * index.ts:1037-1269) per blueprint ADR D2. Steps named after the upstream code comments:
 *
 * Step 1: preprocess query (lemmatize for BM25)
 * Step 2: embed query
 * Step 3: semantic over-fetch (internalLimit = max(topK*4, 60))
 * Step 4: BM25 keyword search (vectorStore.keywordSearch — handles null opt-out)
 * Step 5: sigmoid normalization of BM25 raw scores
 * Step 6: entity boost (v0.1 ships without entity store integration; flag-gated
 *         at factory; this pipeline accepts an optional entityResults param for
 *         v0.2 backward compat without re-shape)
 * Step 7: combined score (additive per scoring.ts; threshold gate BEFORE combining)
 * Step 8: threshold filter (drop combined < threshold)
 * Step 9: format as MemoryItemWithScore[], top-K sorted descending
 *
 * EC-11 absorbed: empty query embeds + returns semantic-only (BM25 lemmatizes to []).
 * EC-8 absorbed: NaN-scored candidates dropped at step 8 (NaN < threshold is false).
 *
 */

import type { VectorStoreResult } from '../dip/vector-store.js';
import { InvalidScope, RerankerConflict } from '../errors.js';
import { lemmatizeForBm25 } from '../lemmatization.js';
import { emitEvent } from '../memory-event.js';
import type { MemoryItemWithScore } from '../memory-item.js';
import type { RecallOptions } from '../options.js';
import type { Filters } from '../scope.js';
import { sigmoidBm25 } from '../scoring.js';

import { computeEntityBoost } from './entity-boost-step.js';
import { mmrRerank } from './mmr.js';
import { applyRecencyCollapseStage } from './recency-collapse.js';
import type { RetrievalDeps } from './retrieval-deps.js';
import { scopeAwareReweight } from './scope-reweight.js';
import { withSpeakerAlias } from './speaker-alias.js';
import { applyAdaptiveAssessStage } from './stages/adaptive-relax.js';
import { assembleCandidates } from './stages/candidate-assembly.js';
import { applyGraphExpansionStage } from './stages/graph-expansion.js';
import { writeRecallTrace } from './stages/recall-trace.js';
import { applyRerankStage } from './stages/rerank.js';
import { makeRowToItem, scopeFromFilters } from './stages/row-mapping.js';
import {
  filterAtThreshold,
  type DroppedCandidate,
  type Payload,
  type ScoredRow,
} from './stages/threshold-filter.js';

export type { RetrievalDeps } from './retrieval-deps.js';
/**
 * 9-step search. Returns the top-K MemoryItemWithScore array sorted by combined score desc.
 */
export async function runRetrievalPipeline(
  query: string,
  filters: Filters,
  deps: RetrievalDeps,
  options?: RecallOptions,
): Promise<readonly MemoryItemWithScore[]> {
  const tracer = deps.tracer;
  const topK = options?.topK ?? 20;
  const threshold = options?.threshold ?? 0.1;

  emitEvent(tracer, 'extraction_started'); // reuse this event for "search started"; v0.2 may add dedicated names
  const queryTokens = lemmatizeForBm25(query);
  const hasBm25Query = queryTokens.length > 0;

  // Step 2: embed
  const queryVector = await deps.embedder.embed(query);

  // Step 3: semantic over-fetch
  const internalLimit = Math.max(topK * 4, 60);
  const semanticResults = await deps.vectorStore.search(queryVector, internalLimit, filters);

  // Step 4 + 5: BM25 keyword search + sigmoid normalization
  let bm25Results: readonly VectorStoreResult[] | null = null;
  if (hasBm25Query) {
    bm25Results = await deps.vectorStore.keywordSearch(withSpeakerAlias(query), internalLimit, filters, queryVector);
  }
  const queryLength = queryTokens.length;
  const bm25NormalizedById = new Map<string, number>();
  if (bm25Results !== null) {
    for (const r of bm25Results) {
      const raw = r.score ?? 0;
      bm25NormalizedById.set(r.id, sigmoidBm25(raw, queryLength));
    }
  }

  // Step 6: entity boost (M15 / #122 — populated from the persisted entity graph).
  const candidateIds = new Set<string>();
  for (const r of semanticResults) candidateIds.add(r.id);
  if (bm25Results !== null) for (const r of bm25Results) candidateIds.add(r.id);
  const entityBoostById = await computeEntityBoost(withSpeakerAlias(query), [...candidateIds], filters, deps);

  // Step 7: combined score per candidate + normalization denominator (union of semantic + BM25).
  const { candidates, maxScore } = assembleCandidates(
    semanticResults,
    bm25Results,
    bm25NormalizedById,
    entityBoostById,
  );

  // Step 8: threshold filter (semantic gate BEFORE combining + final threshold AFTER)
  // EC-8: NaN-scored candidates dropped here because `NaN > threshold` is false.
  // principles-alignment-hardening T4.1: capture pre-threshold count for the
  // recall_threshold_filtered event (Princípio 3 IGNORE auditability per ADR D2).
  const preThresholdCount = candidates.size;
  // explainable-recall (S1) — collect dropped candidates from the PRIMARY
  // threshold pass (the adaptive relax re-filter below passes no collector).
  const recallDrops: DroppedCandidate[] = [];
  let scored: ScoredRow[] = filterAtThreshold(candidates, maxScore, threshold, recallDrops);
  // principles-alignment-hardening T4.1 — emit recall_threshold_filtered ONLY
  // when filtered_count > 0 (no-op observability discipline; do not flood
  // dashboards with zero-filter events). EC-5 absorption: emitEvent is no-op
  // when tracer === undefined.
  const filteredCount = preThresholdCount - scored.length;
  if (filteredCount > 0) {
    emitEvent(tracer, 'recall_threshold_filtered', {
      filtered_count: filteredCount,
      pre_threshold_count: preThresholdCount,
      post_threshold_count: scored.length,
    });
  }

  // Step 8.5: MMR diversify rerank (principles-alignment-hardening T4.2 / ADR D3).
  // Opt-in via options.diversify; default (undefined) = byte-identical to v1.5.
  scored.sort((a, b) => b.score - a.score);
  const scope = scopeFromFilters(filters);
  const now = new Date();

  // Map an internal scored row → the public MemoryItemWithScore DTO. Extracted
  // (cross-encoder-reranker T2.2) so the rerank pool + the final top-K path
  // share ONE conversion (DRY) — the reranker DIP operates on MemoryItemWithScore.
  const rowToItem = makeRowToItem(scope, now);

  // Step 8.6 — adaptive-retrieval grade-and-correct (Item 13, ADR D2).
  // Opt-in: runs ONLY when a retrievalPolicy is wired (default OFF ⇒ byte-
  // unchanged). The corrective may relax the threshold over the pre-threshold
  // `candidates` pool, rebinding `scored`; the rerank/diversify/topK stages
  // below then operate on the corrected pool. Fail-soft inside the helper.
  if (deps.retrievalPolicy !== undefined) {
    scored = [
      ...(await applyAdaptiveAssessStage(
        query,
        scored,
        candidates,
        maxScore,
        threshold,
        deps.retrievalPolicy,
        options?.adaptive,
        rowToItem,
        scope.kind,
        tracer,
      )),
    ];
  }

  // Step 8.7 — graph-aware recall pool-expansion (graph-aware-recall, ADR D3).
  // Opt-in: runs ONLY when a graphExpansionStore is wired AND options.graphExpand
  // is set (default OFF ⇒ byte-unchanged). Appends entity-connected memories
  // (scored below genuine hits) so the rerank/diversify/topK stages below operate
  // on the expanded pool. Fail-soft inside the helper.
  if (deps.graphExpansionStore !== undefined && options?.graphExpand !== undefined) {
    // spread copies the helper's `readonly ScoredRow[]` return into the mutable
    // `let scored` (which downstream stages sort in place) — F-arch-4.
    scored = [
      ...(await applyGraphExpansionStage(
        scored,
        deps.graphExpansionStore,
        filters,
        options.graphExpand,
        topK,
        scope.kind, tracer,
      )),
    ];
  }

  // cross-encoder-reranker T2.2 / ADR D3 + M10 T3.1 — diversify, rerank, and the M10
  // scope-aware reweight are mutually exclusive post-threshold reranks of the same pool.
  // Fail-loud BEFORE any inference (Princípio 3 + Inquebrável Rule 8).
  const postThresholdStages = [options?.rerank, options?.diversify, options?.scopes, options?.recencyCollapse].filter(
    (s) => s !== undefined,
  ).length;
  if (postThresholdStages > 1) {
    throw new RerankerConflict();
  }

  // Step 8.5b — M22 recency-collapse (#141): opt-in most-recent-wins collapse of
  // near-duplicates (older → `superseded_recency` drop); mutually exclusive w/ reranks.
  if (options?.recencyCollapse !== undefined) {
    scored = await applyRecencyCollapseStage(
      scored, candidates, deps.embedder, options.recencyCollapse, topK, threshold, recallDrops, tracer,
    );
  }

  // Step 8.5c — M10 scope-aware reweight (opt-in via options.scopes). Maps the threshold-
  // survivors to items (carrying the real created_at / confirmation_count), applies the
  // deterministic bounded reweight (session recency-boost, global stability-boost), then
  // takes topK. Isolation is upstream (composeFilters); this only re-orders a safe pool.
  if (options?.scopes !== undefined) {
    const sessionRecencyWeight = options.scopes.sessionRecencyWeight ?? 0.3;
    const globalStabilityWeight = options.scopes.globalStabilityWeight ?? 0.3;
    for (const [name, w] of [
      ['sessionRecencyWeight', sessionRecencyWeight],
      ['globalStabilityWeight', globalStabilityWeight],
    ] as const) {
      if (w < 0 || w > 1 || Number.isNaN(w)) {
        throw new InvalidScope(`RecallOptions.scopes.${name} must be in [0, 1]`);
      }
    }
    // Fail-soft note (plan T3.1 failure scenario): `scopeAwareReweight` is a TOTAL pure function —
    // arithmetic + a comparator sort, with Date.parse (NaN-guarded → neutral) and a K-offset division
    // that never divides by zero. It has no throw path over well-formed rows, so a `scope_reweight_failed`
    // event/try-catch would be unreachable dead code (parsimony-ladder rung 1). Fail-soft is satisfied by
    // construction; the reweight can never crash recall. Weight validation above is fail-FAST (caller error).
    const reweighted = scopeAwareReweight(
      scored.map(rowToItem),
      { sessionRecencyWeight, globalStabilityWeight },
      now,
    );
    emitEvent(tracer, 'scope_reweight_applied', {
      scope_tier: scope.kind,
      reweighted_count: reweighted.length,
    });
    const selected = reweighted.slice(0, topK);
    await writeRecallTrace(deps, recallDrops, new Set(selected.map((r) => r.id)));
    return selected;
  }

  // Step 8.5a — cross-encoder rerank (ADR D3). Opt-in via options.rerank AND a
  // wired deps.reranker. When options.rerank is set but no reranker is wired,
  // the rerank is a no-op (results fall through cosine-sorted). Logic extracted
  // to applyRerankStage for cohesion (review F-arch-2 / plan T2.2 REFACTOR).
  if (options?.rerank !== undefined && deps.reranker !== undefined) {
    // Compute the reranked result FIRST, then trace the threshold drops pruned
    // against what was actually returned (rerank has no MMR-redundant drops of
    // its own; adaptive relax may have resurfaced a primary drop into `scored`).
    const reranked = await applyRerankStage(
      query,
      scored,
      deps.reranker,
      options.rerank,
      topK,
      rowToItem,
      tracer,
    );
    await writeRecallTrace(deps, recallDrops, new Set(reranked.map((r) => r.id)));
    return reranked;
  }

  let top: readonly { id: string; payload: Payload; score: number }[];
  if (options?.diversify !== undefined) {
    const { lambda, topPool } = options.diversify;
    const effectiveTopPool = topPool ?? topK * 3;
    // Embed candidate texts in ONE batch for diversity computation. Cost is
    // bounded by topPool (default topK*3 ≤ 60) — one extra embedder call.
    // The mmrRerank function throws InvalidScope when lambda ∉ [0, 1] (EC-3).
    const candidatesForMmr = scored.slice(0, effectiveTopPool);
    const texts = candidatesForMmr.map((c) => String(c.payload['text'] ?? ''));
    const embeddings = await deps.embedder.embedBatch(texts);
    const mmrCandidates = candidatesForMmr.map((c, i) => ({
      id: c.id,
      score: c.score,
      embedding: embeddings[i] ?? [],
      payload: c.payload,
    }));
    const selected = mmrRerank(mmrCandidates, lambda, effectiveTopPool, topK);
    // explainable-recall (S1) — pool candidates NOT selected by MMR are
    // mmr_redundant drops; breakdown recovered from the candidates Map by id.
    const selectedIds = new Set(selected.map((s) => s.id));
    for (const c of candidatesForMmr) {
      if (!selectedIds.has(c.id)) {
        const cand = candidates.get(c.id);
        if (cand !== undefined) {
          recallDrops.push({
            memoryId: c.id,
            semantic: cand.semantic,
            bm25: cand.bm25,
            entity: cand.entity,
            composite: c.score,
            threshold,
            dropReason: 'mmr_redundant',
          });
        }
      }
    }
    top = selected.map((s) => ({ id: s.id, payload: s.payload, score: s.score }));
  } else {
    // Step 9: sort + format top-K (v1.5 default path)
    top = scored.slice(0, topK);
  }

  // explainable-recall (S1) — fail-soft trace write (threshold + MMR drops),
  // pruned against the kept set (resurface consistency, SEPA T3.1 MEDIUM).
  await writeRecallTrace(deps, recallDrops, new Set(top.map((t) => t.id)));
  emitEvent(tracer, 'extraction_completed', { results: top.length });

  return top.map(rowToItem);
}
