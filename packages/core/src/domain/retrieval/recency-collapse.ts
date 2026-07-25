/**
 * M22 / #141 — recall-time most-recent-wins collapse (opt-in, ADR D1).
 *
 * TheMemory is ADD-only (ADR-0003): an updated fact is a NEW `remember`, so two
 * live duplicates of the same fact can coexist until reflect reconciles them.
 * The recall pipeline ranks by relevance ONLY (`scoring.ts` has no recency term),
 * so a stale duplicate with higher semantic similarity can out-rank / crowd out
 * its fresh update. This PURE stage collapses near-duplicate candidates AFTER the
 * score combine: for every pair with cosine(embedding) ≥ τ it keeps the one with
 * the newest `createdAt` and drops the older (recorded as a `superseded_recency`
 * recall-trace drop upstream). It NEVER touches the score formula — it only prunes
 * a near-duplicate cluster, so non-update queries are untouched (Drawbacks row 1).
 *
 * Pure by construction (no I/O, no clock): the caller embeds the candidate texts
 * (reusing the MMR batch-embed path) and parses `createdAt`, then passes the
 * enriched candidates here — mirroring how `mmrRerank` is a pure function fed by
 * `pipeline.ts`. Determinism: equal `createdAt` breaks the tie by higher score,
 * then by lexicographically smaller id.
 *
 * @see CLAUDE.md § IMPORTANTE Princípio 1 (most-recent-wins) + Princípio 3 (auditable drop)
 * @see blueprint stale-recall-and-abstention § "#141 — the fix (weighed)" option (b)
 */
import type { Embedder } from '../dip/embedder.js';

import { cosineSimilarity } from './cosine.js';
import {
  recordDrop,
  type Candidate,
  type DroppedCandidate,
  type ScoredRow,
} from './stages/threshold-filter.js';

/** Conservative default τ: only true paraphrases (cosine ≥ 0.9) collapse (blueprint). */
export const DEFAULT_RECENCY_COLLAPSE_THRESHOLD = 0.9;

/**
 * A post-threshold candidate enriched with the two signals the collapse needs:
 * its embedding (near-duplicate detection) and its `createdAt` as epoch ms
 * (`Number.NEGATIVE_INFINITY` when absent/unparseable — an unknown-age row never
 * out-ranks a real timestamp; two unknowns fall back to the score/id tiebreak).
 */
export interface RecencyCollapseCandidate {
  readonly id: string;
  readonly score: number;
  readonly embedding: readonly number[];
  readonly createdAtMs: number;
}

export interface RecencyCollapseResult {
  /** Ids dropped because a newer near-duplicate representative superseded them. */
  readonly droppedIds: readonly string[];
}

/**
 * `true` iff `a` should be kept as the surviving representative over `b`:
 * newer `createdAt` wins; ties break by higher score, then by smaller id. Total
 * + deterministic so the collapse never flakes on equal timestamps (EC / Q1).
 */
function preferAsRepresentative(a: RecencyCollapseCandidate, b: RecencyCollapseCandidate): boolean {
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs > b.createdAtMs;
  if (a.score !== b.score) return a.score > b.score;
  return a.id < b.id;
}

/**
 * Greedy near-duplicate collapse. Walks the candidates in the given order
 * (score-desc from the pipeline), keeping one representative per cluster (cosine
 * ≥ `threshold`) — the newest by {@link preferAsRepresentative}. O(k²) over the
 * bounded pool the caller passes. Returns only the dropped ids; the caller maps
 * them back to the survivor pool + the recall trace.
 */
export function collapseByRecency(
  candidates: readonly RecencyCollapseCandidate[],
  threshold: number,
): RecencyCollapseResult {
  const kept: RecencyCollapseCandidate[] = [];
  const droppedIds: string[] = [];
  for (const cand of candidates) {
    const dupIndex = kept.findIndex((rep) => cosineSimilarity(cand.embedding, rep.embedding) >= threshold);
    if (dupIndex === -1) {
      kept.push(cand);
      continue;
    }
    const rep = kept[dupIndex] as RecencyCollapseCandidate;
    if (preferAsRepresentative(cand, rep)) {
      droppedIds.push(rep.id);
      kept[dupIndex] = cand;
    } else {
      droppedIds.push(cand.id);
    }
  }
  return { droppedIds };
}

/**
 * Parse a payload `created_at` (ISO string from the store projection) to epoch ms.
 * Absent / non-string / unparseable ⇒ `Number.NEGATIVE_INFINITY` (unknown age →
 * never beats a real timestamp), mirroring `scope-reweight.ts`'s neutral handling.
 */
export function parseCreatedAtMs(raw: string | number | boolean | null | undefined): number {
  if (typeof raw !== 'string') return Number.NEGATIVE_INFINITY;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Pipeline wiring for the collapse (opt-in Step 8.5b). Bounds the candidate pool
 * to `topK * 3` (O(k²)), reuses the MMR-path batch-embed to get candidate
 * embeddings, runs {@link collapseByRecency}, records each dropped older
 * duplicate as a `superseded_recency` recall-trace drop (via the shared
 * {@link recordDrop}), and returns the surviving rows (score order preserved).
 *
 * Extracted from `pipeline.ts` (module-size budget) mirroring `applyRerankStage`
 * / `applyGraphExpansionStage`. Pure of clock/randomness; the only I/O is the
 * embedder batch call the caller already performs for MMR.
 */
export async function applyRecencyCollapseStage(
  scored: readonly ScoredRow[],
  candidates: ReadonlyMap<string, Candidate>,
  embedder: Embedder,
  config: { readonly threshold?: number },
  topK: number,
  threshold: number,
  drops: DroppedCandidate[],
): Promise<ScoredRow[]> {
  const tau = config.threshold ?? DEFAULT_RECENCY_COLLAPSE_THRESHOLD;
  const pool = scored.slice(0, topK * 3);
  const embeddings = await embedder.embedBatch(pool.map((c) => String(c.payload['text'] ?? '')));
  const { droppedIds } = collapseByRecency(
    pool.map((c, i) => ({
      id: c.id,
      score: c.score,
      embedding: embeddings[i] ?? [],
      createdAtMs: parseCreatedAtMs(c.payload['created_at']),
    })),
    tau,
  );
  const droppedSet = new Set(droppedIds);
  for (const c of pool) {
    const cand = droppedSet.has(c.id) ? candidates.get(c.id) : undefined;
    if (cand !== undefined) recordDrop(drops, c.id, cand, threshold, c.score, 'superseded_recency');
  }
  return scored.filter((c) => !droppedSet.has(c.id));
}
