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
import type { Tracer } from '@opentelemetry/api';

import type { Embedder } from '../dip/embedder.js';
import { emitEvent } from '../memory-event.js';

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
  /** Text is used to protect distinct values and temporal qualifiers from paraphrase collapse. */
  readonly text?: string;
}

const VALUE_MARKER = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b|\b\d+(?:[.,:/-]\d+)*(?:%|k|m|am|pm)?\b|\$\s?\d[\d,.]*/gi;
const TEMPORAL_MARKER = /\b(?:today|yesterday|tomorrow|last\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|week|month|year)|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:days?|weeks?|months?|years?)\s+ago|black\s+friday|christmas|new\s+year)\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+of\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
const POLARITY_MARKER = /\b(?:not|never|no longer|cannot|can't|isn't|aren't|doesn't|didn't|without)\b/gi;

function materialMarkers(text: string | undefined): string[] {
  if (text === undefined) return [];
  return [
    ...(text.match(TEMPORAL_MARKER) ?? []).map((value) => `time:${value.toLowerCase().replace(/\s+/g, ' ')}`),
    ...(text.match(VALUE_MARKER) ?? []).map((value) => `value:${value.toLowerCase().replace(/\s+/g, '')}`),
    ...(text.match(POLARITY_MARKER) ?? []).map((value) => `polarity:${value.toLowerCase().replace(/\s+/g, ' ')}`),
  ];
}

function compatibleMaterialMarkers(a: string | undefined, b: string | undefined): boolean {
  const left = materialMarkers(a);
  const right = materialMarkers(b);
  return left.length === right.length && left.every((marker, index) => marker === right[index]);
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
 * Near-duplicate collapse via STABLE-SEED single-linkage clustering. Each
 * candidate joins the first cluster whose SEED (the first member, fixed at
 * cluster creation) it matches (cosine ≥ `threshold`); otherwise it seeds a new
 * cluster. Per cluster, the newest member by {@link preferAsRepresentative}
 * survives and the rest are dropped.
 *
 * Why a fixed seed (not a mutable "current representative"): comparing against a
 * representative that gets replaced by each newer member causes transitive drift
 * — in a chain A~B, B~C, A≁C the survivor would walk to C and wrongly drop A
 * even though A is NOT a near-duplicate of C (review F-1). A stable seed keeps A
 * and C in separate clusters, so only genuine near-duplicates of the same seed
 * collapse. This is strictly MORE conservative (drops ≤ the mutable variant),
 * which also lowers precision-regression risk. O(k·clusters) ≤ O(k²) over the
 * bounded pool the caller passes.
 */
export function collapseByRecency(
  candidates: readonly RecencyCollapseCandidate[],
  threshold: number,
): RecencyCollapseResult {
  const clusters: RecencyCollapseCandidate[][] = [];
  for (const cand of candidates) {
    const cluster = clusters.find(
      (c) => {
        const seed = c[0] as RecencyCollapseCandidate;
        return compatibleMaterialMarkers(cand.text, seed.text)
          && cosineSimilarity(cand.embedding, seed.embedding) >= threshold;
      },
    );
    if (cluster === undefined) clusters.push([cand]);
    else cluster.push(cand);
  }
  const droppedIds: string[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) continue;
    let survivor = cluster[0] as RecencyCollapseCandidate;
    for (const member of cluster.slice(1)) {
      if (preferAsRepresentative(member, survivor)) survivor = member;
    }
    for (const member of cluster) {
      if (member.id !== survivor.id) droppedIds.push(member.id);
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
  tracer?: Tracer,
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
      text: String(c.payload['text'] ?? ''),
    })),
    tau,
  );
  const droppedSet = new Set(droppedIds);
  for (const c of pool) {
    const cand = droppedSet.has(c.id) ? candidates.get(c.id) : undefined;
    if (cand !== undefined) recordDrop(drops, c.id, cand, threshold, c.score, 'superseded_recency');
  }
  // Princípio 3 — the collapse is an IGNORE decision (older near-dups pruned), so
  // make it observable even when no recall-trace store is wired. No-op when the
  // tracer is undefined. Mirrors `scope_reweight_applied`.
  emitEvent(tracer, 'recency_collapse_applied', {
    collapsed_count: droppedSet.size,
    pool_size: pool.length,
  });
  return scored.filter((c) => !droppedSet.has(c.id));
}
