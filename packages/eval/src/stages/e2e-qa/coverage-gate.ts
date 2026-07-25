/**
 * #140 harness abstention — pure pre-answer coverage gate.
 *
 * The M21 LongMemEval counter-proof showed the ANSWERER (not recall) over-
 * committing: it hallucinated an answer when recall returned related-but-
 * insufficient memories. The blueprint declined a core `coverage`/`confidence`
 * field (YAGNI + DRY + the LOCKED "memory layer, NOT agent runtime" boundary) —
 * the coverage signal a consumer needs already exists as
 * `MemoryItemWithScore.score` ∈ [0, 1]. This helper is the answerer discipline
 * that belongs in the eval harness: abstain BEFORE the LLM call when coverage is
 * thin, so the harness cannot fabricate an answer from weak evidence.
 *
 * Pure, deterministic, LLM-free: `shouldAbstain(recalled, τ) = recalled.length
 * === 0 || max(score) < τ`. A `max score === τ` is sufficient coverage (answer),
 * not abstention.
 */
import type { MemoryItemWithScore } from '@usetheo/memory';

/**
 * `true` when the answerer should abstain (decline to answer) because recall
 * coverage is thin: either nothing was recalled, or the best recalled memory's
 * composite score is strictly below `tau`.
 */
export function shouldAbstain(items: readonly MemoryItemWithScore[], tau: number): boolean {
  if (items.length === 0) return true;
  const maxScore = Math.max(...items.map((m) => m.score));
  return maxScore < tau;
}
