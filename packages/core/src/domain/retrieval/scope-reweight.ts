/**
 * M10 — `scopeAwareReweight`: the deterministic, bounded, PURE scope-aware reweight stage.
 *
 * Over the M8 `session ∪ global` union pool, nudge each row's score by its scope-of-origin:
 * - SESSION-origin (payload `session_id` set) → RECENCY boost: `1 / (1 + ageDays)` ∈ (0, 1],
 *   newer → higher, so the current conversation surfaces.
 * - GLOBAL-origin (`session_id` NULL) → STABILITY boost: `count / (count + K)` ∈ [0, 1),
 *   higher `confirmation_count` → higher, so durable facts are not buried under session noise.
 *
 * `newScore = baseScore * (1 + weight * signal)` — a BOUNDED multiplier (`weight ∈ [0,1]`,
 * `signal ∈ [0,1]`), so the boost is at most `(1 + weight)×` and never inverts a large base-score
 * gap (Princípio 1: a continuous nudge, not a re-rank from scratch). Pure: no I/O, no clock —
 * `now` is injected so the recency term is deterministic + testable.
 *
 * Isolation is NOT this function's concern — it runs on an already-`(workspace, user)`-safe
 * pool (`composeFilters` filters upstream). Weight-range validation is the caller's boundary
 * (pipeline), matching the `diversify.lambda` precedent.
 */
import type { MemoryItemWithScore } from '../memory-item.js';

/** Confirmation-count half-scale: count=K → 0.5 stability. Tunable; 5 is a conservative default. */
const STABILITY_K = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ScopeReweightWeights {
  readonly sessionRecencyWeight: number;
  readonly globalStabilityWeight: number;
}

/** True iff the row originated in a session scope (its `session_id` is a non-empty string). */
function isSessionOrigin(item: MemoryItemWithScore): boolean {
  const sid = item.metadata['session_id'];
  return typeof sid === 'string' && sid.length > 0;
}

/**
 * Recency signal ∈ [0, 1]. Reads the PROJECTED `created_at` from the row payload (T1.1) — NOT the
 * `MemoryItem.createdAt` DTO field, which the pipeline back-fills with `now` when the projection is
 * absent. An absent/unparseable timestamp (legacy / stale-impl rows) is therefore NEUTRAL (0), never
 * a spurious MAX-recency boost that would bury genuinely fresh facts (plan T2.1 AC; Risk #1). A present
 * timestamp decays `1/(1+ageDays)`: newer → higher. Deterministic given `now`.
 */
function recencySignal(item: MemoryItemWithScore, now: Date): number {
  const raw = item.metadata['created_at'];
  if (typeof raw !== 'string') return 0; // absent projection → neutral, not max
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return 0; // unparseable → neutral
  const ageDays = Math.max(0, (now.getTime() - t) / MS_PER_DAY);
  return 1 / (1 + ageDays);
}

/** Stability signal ∈ [0, 1): count/(count+K), higher confirmation → higher. */
function stabilitySignal(confirmationCount: number | undefined): number {
  const c = confirmationCount ?? 0;
  return c / (c + STABILITY_K);
}

export function scopeAwareReweight(
  items: readonly MemoryItemWithScore[],
  weights: ScopeReweightWeights,
  now: Date,
): MemoryItemWithScore[] {
  const reweighted = items.map((item) => {
    const boost = isSessionOrigin(item)
      ? weights.sessionRecencyWeight * recencySignal(item, now)
      : weights.globalStabilityWeight * stabilitySignal(item.confirmationCount);
    return { ...item, score: item.score * (1 + boost) };
  });
  // Stable sort by the reweighted score (desc); ties keep input order (deterministic).
  return reweighted.sort((a, b) => b.score - a.score);
}
