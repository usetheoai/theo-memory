/**
 * 9-step search pipeline — T5.1 of v0-1-local-runtime plan v1.3.
 *
 * Port of Mem0-ts's `search` (referencia/mem0/mem0-ts/src/oss/src/memory/
 * index.ts:1037-1269) per blueprint ADR D2. Steps named after Mem0's comments:
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
 * @see referencia/mem0/mem0-ts/src/oss/src/memory/index.ts:1037-1269
 * @see referencia/mem0/mem0-ts/src/oss/src/utils/scoring.ts:1-138
 */
import type { Tracer } from '@opentelemetry/api';

import type { Embedder } from '../dip/embedder.js';
import type { VectorStore, VectorStoreResult } from '../dip/vector-store.js';
import { lemmatizeForBm25 } from '../lemmatization.js';
import { emitEvent } from '../memory-event.js';
import type { MemoryItemWithScore } from '../memory-item.js';
import type { RecallOptions } from '../options.js';
import type { Filters, Scope } from '../scope.js';
import { combineScores, maxPossible, sigmoidBm25 } from '../scoring.js';

export interface RetrievalDeps {
  readonly vectorStore: VectorStore;
  readonly embedder: Embedder;
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

  // Step 9: sort + format top-K
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const scope = scopeFromFilters(filters);
  const now = new Date();

  emitEvent(tracer, 'extraction_completed', { results: top.length });

  return top.map((row) => ({
    id: row.id,
    text: String(row.payload['text'] ?? ''),
    hash: String(row.payload['hash'] ?? row.id),
    scope,
    createdAt: now,
    updatedAt: now,
    metadata: { ...row.payload },
    tValid: now,
    tInvalid: null,
    score: row.score === 0 ? payloadToScore(row.payload, row.score) : row.score,
  }));
}
