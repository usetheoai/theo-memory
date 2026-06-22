/**
 * 9-step search pipeline — T5.1 of v0-1-local-runtime plan v1.3.
 *
 * Port of reference TS port's `search` (.claude/knowledge-base/references/REDACTED/reference TS port/src/oss/src/memory/
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
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T5.1 + ADR D1.0
 * @see .claude/knowledge-base/references/REDACTED/reference TS port/src/oss/src/memory/index.ts:1037-1269
 * @see .claude/knowledge-base/references/REDACTED/reference TS port/src/oss/src/utils/scoring.ts:1-138
 */
import type { Tracer } from '@opentelemetry/api';

import type { Embedder } from '../dip/embedder.js';
import type { Reranker } from '../dip/reranker.js';
import type { VectorStore, VectorStoreResult } from '../dip/vector-store.js';
import { RerankerConflict } from '../errors.js';
import { lemmatizeForBm25 } from '../lemmatization.js';
import { emitEvent } from '../memory-event.js';
import type { MemoryItemWithScore } from '../memory-item.js';
import type { RecallOptions } from '../options.js';
import type { Filters, Scope } from '../scope.js';
import { combineScores, maxPossible, sigmoidBm25 } from '../scoring.js';

import { mmrRerank } from './mmr.js';

export interface RetrievalDeps {
  readonly vectorStore: VectorStore;
  readonly embedder: Embedder;
  /**
   * cross-encoder-reranker (Item 23) — optional post-threshold reranker.
   * When present AND `options.rerank` is set, the threshold-passing pool is
   * reranked before topK truncation (ADR D3). Absent ⇒ rerank is a no-op.
   */
  readonly reranker?: Reranker;
  readonly tracer?: Tracer;
}

type Payload = Record<string, string | number | boolean | null>;

function scopeFromFilters(filters: Filters): Scope {
  if (filters.user_id !== undefined) {
    return { kind: 'user', userId: filters.user_id };
  }
  if (filters.session_id !== undefined) {
    return { kind: 'session', sessionId: filters.session_id };
  }
  if (filters.agent_id !== undefined) {
    return { kind: 'agent', agentId: filters.agent_id };
  }
  return { kind: 'user', userId: '' };
}

function payloadToScore(payload: Payload, fallback: number): number {
  const raw = payload['_score'];
  return typeof raw === 'number' ? raw : fallback;
}

/**
 * Step 8.5a — cross-encoder rerank stage (ADR D3 + D4). Extracted from
 * `runRetrievalPipeline` for cohesion (review F-arch-2 / plan T2.2 REFACTOR).
 * Reranks the cosine-sorted top `pool` (default topK*4, bounded), truncates to
 * topK. Fail-soft (ADR D4): on inference failure, emit `recall_rerank_failed`
 * and degrade to the original cosine order — a reranker outage MUST NEVER take
 * down recall.
 */
async function applyRerankStage(
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

  // Step 1: preprocess
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
    bm25Results = await deps.vectorStore.keywordSearch(query, internalLimit, filters);
  }
  const queryLength = queryTokens.length;
  const bm25NormalizedById = new Map<string, number>();
  if (bm25Results !== null) {
    for (const r of bm25Results) {
      const raw = r.score ?? 0;
      bm25NormalizedById.set(r.id, sigmoidBm25(raw, queryLength));
    }
  }

  // Step 6: entity boost (v0.1 ships without entity store integration; numLinked=0 always)
  const entityBoostById = new Map<string, number>();

  // Step 7: combined score per candidate (union of semantic + BM25 ids)
  const candidates = new Map<string, { semantic: number; bm25: number; entity: number; payload: Payload }>();
  for (const r of semanticResults) {
    candidates.set(r.id, {
      semantic: r.score ?? 0,
      bm25: bm25NormalizedById.get(r.id) ?? 0,
      entity: entityBoostById.get(r.id) ?? 0,
      payload: { ...r.payload },
    });
  }
  if (bm25Results !== null) {
    for (const r of bm25Results) {
      if (!candidates.has(r.id)) {
        candidates.set(r.id, {
          semantic: 0,
          bm25: bm25NormalizedById.get(r.id) ?? 0,
          entity: entityBoostById.get(r.id) ?? 0,
          payload: { ...r.payload },
        });
      }
    }
  }

  const signals = {
    semantic: true,
    bm25: bm25Results !== null && bm25Results.length > 0,
    entity: entityBoostById.size > 0,
  };
  const maxScore = maxPossible(signals);

  // Step 8: threshold filter (semantic gate BEFORE combining + final threshold AFTER)
  // EC-8: NaN-scored candidates dropped here because `NaN > threshold` is false.
  // principles-alignment-hardening T4.1: capture pre-threshold count for the
  // recall_threshold_filtered event (Princípio 3 IGNORE auditability per ADR D2).
  const preThresholdCount = candidates.size;
  const scored: { id: string; payload: Payload; score: number }[] = [];
  for (const [id, c] of candidates.entries()) {
    if (c.semantic < threshold) {
      continue;
    }
    const combined = combineScores(
      { semantic: c.semantic, bm25: c.bm25, entityBoostScore: c.entity },
      maxScore,
    );
    if (combined < threshold) {
      continue;
    }
    if (Number.isNaN(combined)) {
      continue;
    }
    scored.push({ id, payload: c.payload, score: combined });
  }
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
  const rowToItem = (row: { id: string; payload: Payload; score: number }): MemoryItemWithScore => {
    // v1.1 T2.1: surface attributed_to from the row payload (rowToResult in
    // pgvector-store projects the column into payload[attributed_to] when
    // non-null). String coercion + undefined-when-absent preserves the
    // DTO's optional contract.
    const attributedToRaw = row.payload['attributed_to'];
    const attributedTo = typeof attributedToRaw === 'string' ? attributedToRaw : undefined;
    // principles-alignment-hardening T2.1 / EC-6 — hoist confirmation_count
    // from row payload (search SQL now projects it). recall() results now
    // surface Princípio 1 confirmação signal.
    const confirmationCountRaw = row.payload['confirmation_count'];
    const confirmationCount = typeof confirmationCountRaw === 'number' ? confirmationCountRaw : undefined;
    return {
      id: row.id,
      text: String(row.payload['text'] ?? ''),
      hash: String(row.payload['hash'] ?? row.id),
      scope,
      createdAt: now,
      updatedAt: now,
      metadata: { ...row.payload },
      tValid: now,
      tInvalid: null,
      ...(attributedTo !== undefined ? { attributedTo } : {}),
      ...(confirmationCount !== undefined ? { confirmationCount } : {}),
      score: row.score === 0 ? payloadToScore(row.payload, row.score) : row.score,
    };
  };

  // cross-encoder-reranker T2.2 / ADR D3 — diversify and rerank are mutually
  // exclusive post-threshold reranks of the same pool. Fail-loud BEFORE any
  // inference (Princípio 3 + Inquebrável Rule 8).
  if (options?.rerank !== undefined && options.diversify !== undefined) {
    throw new RerankerConflict();
  }

  // Step 8.5a — cross-encoder rerank (ADR D3). Opt-in via options.rerank AND a
  // wired deps.reranker. When options.rerank is set but no reranker is wired,
  // the rerank is a no-op (results fall through cosine-sorted). Logic extracted
  // to applyRerankStage for cohesion (review F-arch-2 / plan T2.2 REFACTOR).
  if (options?.rerank !== undefined && deps.reranker !== undefined) {
    return applyRerankStage(query, scored, deps.reranker, options.rerank, topK, rowToItem, tracer);
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
    top = selected.map((s) => ({ id: s.id, payload: s.payload, score: s.score }));
  } else {
    // Step 9: sort + format top-K (v1.5 default path)
    top = scored.slice(0, topK);
  }

  emitEvent(tracer, 'extraction_completed', { results: top.length });

  return top.map(rowToItem);
}
