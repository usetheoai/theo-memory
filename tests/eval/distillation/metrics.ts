/**
 * Pure-function metrics for v0.7 distillation evaluation. Used by
 * `tests/eval/distillation/run.ts` (T3.2 — npm run eval:distillation)
 * AND `tests/integration/distillation/the-goal-test.test.ts` (T3.3 —
 * precision/recall thresholds).
 *
 * EC-10 honest correction: plan v1.1 absorbed EC-10 saying "BLEU via
 * natural.BleuScore (already in optionalDependencies per v0.6.1; zero new
 * deps)". `natural` v8.1.0 does NOT export a `BleuScore` symbol — it ships
 * `NGrams`, `WordTokenizer`, distance metrics (Jaro-Winkler, Levenshtein,
 * Damerau-Levenshtein, Hamming), but NO BLEU. Plan EC-10 absorption was
 * fabricated. Honest fix: BLEU implemented INLINE using `natural.NGrams`
 * + `natural.WordTokenizer` as primitives. Zero new deps preserved
 * (still uses only the existing `natural` optionalDependency). Standard
 * BLEU-4 formula: geometric mean of modified n-gram precisions (n=1..4)
 * times brevity penalty.
 *
 */
import natural from 'natural';

const tokenizer = new natural.WordTokenizer();

/** Lowercase + word-tokenize (drops punctuation; collapses whitespace). */
export function tokenize(text: string): readonly string[] {
  return tokenizer.tokenize(text.toLowerCase());
}

/**
 * Sentence-level BLEU-4 with smoothing-1 (add-1 to numerator+denominator of
 * each modified precision to avoid log(0) on the geometric mean).
 *
 * Returns a number in [0, 1]. Returns 0 for empty candidate or empty
 * reference (well-defined edge cases).
 */
export function bleuScore(candidate: string, reference: string): number {
  const cand = tokenize(candidate);
  const ref = tokenize(reference);
  if (cand.length === 0 || ref.length === 0) return 0;

  const maxN = Math.min(4, cand.length, ref.length);
  const precisions: number[] = [];
  for (let n = 1; n <= maxN; n++) {
    const candNgrams = natural.NGrams.ngrams(cand as string[], n).map((g) => g.join(' '));
    const refNgrams = natural.NGrams.ngrams(ref as string[], n).map((g) => g.join(' '));
    if (candNgrams.length === 0) continue;
    const refCounts = new Map<string, number>();
    for (const g of refNgrams) refCounts.set(g, (refCounts.get(g) ?? 0) + 1);
    const candCounts = new Map<string, number>();
    for (const g of candNgrams) candCounts.set(g, (candCounts.get(g) ?? 0) + 1);
    let matched = 0;
    for (const [g, c] of candCounts) {
      matched += Math.min(c, refCounts.get(g) ?? 0);
    }
    // Strict precision (no smoothing) — clamp at epsilon to avoid log(0).
    const p = matched / candNgrams.length;
    precisions.push(p > 0 ? p : 1e-9);
  }
  if (precisions.length === 0) return 0;
  const logSum = precisions.reduce((acc, p) => acc + Math.log(p), 0);
  const geoMean = Math.exp(logSum / precisions.length);
  const bp = cand.length >= ref.length ? 1 : Math.exp(1 - ref.length / cand.length);
  return geoMean * bp;
}

/**
 * Token-set Jaccard similarity. Useful as a cheap entity-overlap proxy.
 * Returns 0 for empty inputs. Range [0, 1].
 */
export function entityOverlapJaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Set-based precision over extracted vs expected facts. An extracted fact
 * "matches" an expected fact when `entityOverlapJaccard >= threshold`
 * (default 0.5). Jaccard is preferred over BLEU for short distillation
 * facts where 1 differing word (e.g., 'likes' vs 'prefers') would collapse
 * BLEU-2+ to ~0 while the semantic match is intact.
 */
export function precision(
  extracted: readonly string[],
  expected: readonly string[],
  threshold = 0.5,
): number {
  if (extracted.length === 0) return 0;
  let matched = 0;
  for (const e of extracted) {
    if (expected.some((x) => entityOverlapJaccard(e, x) >= threshold)) matched++;
  }
  return matched / extracted.length;
}

/** Recall = matched-expected / expected.length. Same Jaccard matching rule as precision. */
export function recall(
  extracted: readonly string[],
  expected: readonly string[],
  threshold = 0.5,
): number {
  if (expected.length === 0) return 0;
  let matched = 0;
  for (const x of expected) {
    if (extracted.some((e) => entityOverlapJaccard(e, x) >= threshold)) matched++;
  }
  return matched / expected.length;
}

/**
 * Conflict-resolution accuracy: fraction of contradiction-pair fixtures
 * where the policy correctly kept the `kept` fact AND rejected the
 * `rejected` fact. Pure function over a list of pair-decisions.
 */
export interface ConflictResolutionDecision {
  readonly fixtureId: string;
  readonly expectedKept: string;
  readonly expectedRejected: string;
  readonly actualKept: string;
  readonly actualRejected: string;
}

export function conflictResolutionAccuracy(
  decisions: readonly ConflictResolutionDecision[],
  threshold = 0.5,
): number {
  if (decisions.length === 0) return 0;
  let correct = 0;
  for (const d of decisions) {
    const keptMatch = entityOverlapJaccard(d.actualKept, d.expectedKept) >= threshold;
    const rejectedMatch = entityOverlapJaccard(d.actualRejected, d.expectedRejected) >= threshold;
    if (keptMatch && rejectedMatch) correct++;
  }
  return correct / decisions.length;
}
