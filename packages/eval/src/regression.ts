/**
 * T1.3 — Regression comparator (ADR D3). Compares candidate per-stage scores
 * against a committed baseline and fails when any metric drops below
 * `baseline − ε` (a per-metric tolerance band, because LLM output is
 * non-deterministic and exact equality would flake).
 *
 * FAIL-CLOSED by design (Princípio 3): any ambiguity fails rather than silently
 * passing. A stage present in the baseline but missing from the candidate, or a
 * candidate stage the baseline never declared, is a stage-set mismatch that the
 * gate treats as a regression — the baseline is the contract, and changing it
 * requires an explicit PR (guards against baseline-as-theatre). Boundary is
 * INCLUSIVE: candidate exactly at `baseline − ε` is NOT a regression.
 */
import { COMPARED_METRICS, type Baseline, type ComparedMetric, type StageScore } from './schema.js';

/** Per-metric allowed drop below baseline before the gate fires. */
export type Tolerance = Readonly<Record<ComparedMetric, number>>;

/** Default tolerance band. Tuned conservatively; override per invocation. */
export const DEFAULT_TOLERANCE: Tolerance = {
  precision: 0.05,
  recall: 0.05,
  accuracy: 0.05,
};

export interface RegressionDetail {
  readonly stage: string;
  readonly metric: ComparedMetric;
  readonly baseline: number;
  readonly candidate: number;
  readonly tolerance: number;
  readonly regressed: boolean;
}

export interface RegressionResult {
  readonly regressed: boolean;
  readonly details: readonly RegressionDetail[];
  /** Human-readable reasons for any stage-set mismatch (fail-closed). */
  readonly stageMismatch: readonly string[];
}

/** Typed error thrown by `assertNoRegression` when the gate fires. */
export class RegressionError extends Error {
  constructor(
    message: string,
    readonly result: RegressionResult,
  ) {
    super(message);
    this.name = 'RegressionError';
  }
}

function metricValue(score: StageScore, metric: ComparedMetric): number | undefined {
  return score[metric];
}

function compareStage(
  candidate: StageScore,
  base: StageScore,
  tolerance: Tolerance,
): RegressionDetail[] {
  const details: RegressionDetail[] = [];
  for (const metric of COMPARED_METRICS) {
    const baseValue = metricValue(base, metric);
    if (baseValue === undefined) continue; // baseline did not measure this metric
    const candValue = metricValue(candidate, metric);
    const tol = tolerance[metric];
    // Missing candidate metric that the baseline declared → fail-closed.
    const effectiveCandidate = candValue ?? -Infinity;
    const regressed = effectiveCandidate < baseValue - tol; // boundary inclusive
    details.push({
      stage: base.stage,
      metric,
      baseline: baseValue,
      candidate: candValue ?? Number.NaN,
      tolerance: tol,
      regressed,
    });
  }
  return details;
}

export function compareToBaseline(
  candidate: readonly StageScore[],
  baseline: Baseline,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): RegressionResult {
  const candidateByStage = new Map(candidate.map((s) => [s.stage, s]));
  const baselineStages = new Set(baseline.stages.map((s) => s.stage));
  const details: RegressionDetail[] = [];
  const stageMismatch: string[] = [];

  for (const base of baseline.stages) {
    const cand = candidateByStage.get(base.stage);
    if (cand === undefined) {
      stageMismatch.push(`missing candidate stage: ${base.stage}`);
      continue;
    }
    details.push(...compareStage(cand, base, tolerance));
  }
  for (const cand of candidate) {
    if (!baselineStages.has(cand.stage)) {
      stageMismatch.push(`unknown candidate stage not in baseline: ${cand.stage}`);
    }
  }

  const regressed = stageMismatch.length > 0 || details.some((d) => d.regressed);
  return { regressed, details, stageMismatch };
}

export function assertNoRegression(
  candidate: readonly StageScore[],
  baseline: Baseline,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): void {
  const result = compareToBaseline(candidate, baseline, tolerance);
  if (!result.regressed) return;
  const reasons: string[] = [...result.stageMismatch];
  for (const d of result.details) {
    if (d.regressed) {
      reasons.push(
        `${d.stage}.${d.metric}: ${d.candidate.toFixed(3)} < baseline ${d.baseline.toFixed(3)} − ε ${d.tolerance.toFixed(3)}`,
      );
    }
  }
  throw new RegressionError(`Eval regression detected:\n  ${reasons.join('\n  ')}`, result);
}
