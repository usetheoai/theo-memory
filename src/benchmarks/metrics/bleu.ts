/**
 * BLEU score wrapper around the `natural` library's BleuScore.
 *
 * Per ADR D1 (own the runner, ADOPT only metric primitives), this is a
 * thin wrapper that does not reinvent BLEU computation. The underlying
 * library handles n-gram counting + smoothing.
 *
 * `natural` is declared as an optionalDependency in package.json so that
 * core consumers who do not run benchmarks need not install it. The
 * `isBleuAvailable()` predicate gates test suites that depend on BLEU.
 *
 * EC-7 absorption — empty / whitespace inputs return 0 (no signal). The
 * underlying library returns NaN on empty inputs in some versions; the
 * guard at the wrapper boundary normalizes this to 0.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.1
 * @see .claude/knowledge-base/reviews/v0-8-independent-benchmark-reproduction-edge-cases-2026-06-02.md § EC-7
 */

import { createRequire } from 'node:module';

const DEFAULT_WEIGHTS: readonly number[] = [0.25, 0.25, 0.25, 0.25];

type NaturalBleuFn = (
  reference: string,
  candidate: string,
  weights: readonly number[],
) => number;

let cachedBleuFn: NaturalBleuFn | null = null;
let probedAvailability: boolean | null = null;

function loadNaturalBleu(): NaturalBleuFn | null {
  if (probedAvailability !== null) {
    return cachedBleuFn;
  }
  try {
    const req = createRequire(import.meta.url);
    const natural = req('natural') as { BleuScore: NaturalBleuFn };
    if (typeof natural.BleuScore !== 'function') {
      probedAvailability = false;
      return null;
    }
    cachedBleuFn = natural.BleuScore;
    probedAvailability = true;
    return cachedBleuFn;
  } catch {
    probedAvailability = false;
    return null;
  }
}

export function isBleuAvailable(): boolean {
  return loadNaturalBleu() !== null;
}

export function calculateBleuScore(
  prediction: string,
  reference: string,
  weights: readonly number[] = DEFAULT_WEIGHTS,
): number {
  const predTrim = prediction.trim();
  const refTrim = reference.trim();
  if (predTrim.length === 0 || refTrim.length === 0) {
    return 0;
  }
  const bleu = loadNaturalBleu();
  if (bleu === null) {
    return 0;
  }
  const score = bleu(refTrim, predTrim, weights);
  if (!Number.isFinite(score)) {
    return 0;
  }
  return score;
}
