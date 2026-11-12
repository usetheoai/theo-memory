/**
 * Paired comparison of two arms of the system on the same questions.
 *
 * A fixed floor ("at least 9 of 12") cannot tell a real change from run-to-run noise on a small
 * case set. This compares the arms question by question instead: each question is scored by the
 * share of runs that answered it, the arm that scores higher wins the question, and an exact
 * two-sided sign test on the wins says whether the split could be chance. Each side is also
 * reported with a Wilson interval, which stays honest at the sizes these case sets have.
 */

/** One run of one arm: whether each question, by a stable key, was answered. */
export type RunAnswers = ReadonlyMap<string, boolean>;

export interface Interval {
  readonly low: number;
  readonly high: number;
}

export interface SideSummary {
  /** Questions a majority of the side's runs answered. */
  readonly majorityCorrect: number;
  /** Wilson 95% interval of `majorityCorrect` over the questions. */
  readonly interval: Interval;
  /** Questions whose answer changed between runs of this side. */
  readonly unstable: number;
}

export interface PairedComparison {
  readonly questions: number;
  /** Questions the arm answered in a larger share of its runs than the base. */
  readonly armWins: number;
  readonly baseWins: number;
  readonly ties: number;
  /** Exact two-sided sign test on `armWins` against `baseWins`; 1 when neither side won a question. */
  readonly pValue: number;
  readonly base: SideSummary;
  readonly arm: SideSummary;
}

const Z_95 = 1.959963984540054;

export class PairedComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairedComparisonError';
  }
}

/** Wilson score interval for `successes` out of `trials`, 95% by default. */
export function wilsonInterval(successes: number, trials: number, z: number = Z_95): Interval {
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new PairedComparisonError(`trials must be a positive integer, got ${trials}`);
  }
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) {
    throw new PairedComparisonError(`successes must be between 0 and ${trials}, got ${successes}`);
  }
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** Probability of a split at least this uneven when each win is a fair coin. */
function signTestPValue(armWins: number, baseWins: number): number {
  const n = armWins + baseWins;
  if (n === 0) return 1;
  const smaller = Math.min(armWins, baseWins);
  let term = Math.pow(0.5, n);
  let tail = term;
  for (let i = 1; i <= smaller; i++) {
    term = (term * (n - i + 1)) / i;
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

function share(runs: readonly RunAnswers[], key: string, side: string): number {
  let answered = 0;
  for (const run of runs) {
    const value = run.get(key);
    if (value === undefined) {
      throw new PairedComparisonError(`Paired comparison needs the same questions on both sides; '${key}' is missing from the ${side}.`);
    }
    if (value) answered += 1;
  }
  return answered / runs.length;
}

function summarize(shares: readonly number[]): SideSummary {
  const majorityCorrect = shares.filter((s) => s > 0.5).length;
  return {
    majorityCorrect,
    interval: wilsonInterval(majorityCorrect, shares.length),
    unstable: shares.filter((s) => s > 0 && s < 1).length,
  };
}

export function comparePaired(base: readonly RunAnswers[], arm: readonly RunAnswers[]): PairedComparison {
  const firstBase = base[0];
  const firstArm = arm[0];
  if (firstBase === undefined || firstArm === undefined) {
    throw new PairedComparisonError('Paired comparison needs at least one run per side.');
  }
  const keys = [...new Set([...firstBase.keys(), ...firstArm.keys()])];
  const baseShares = keys.map((key) => share(base, key, 'base'));
  const armShares = keys.map((key) => share(arm, key, 'arm'));
  let armWins = 0;
  let baseWins = 0;
  keys.forEach((_, i) => {
    const difference = (armShares[i] as number) - (baseShares[i] as number);
    if (difference > 0) armWins += 1;
    else if (difference < 0) baseWins += 1;
  });
  return {
    questions: keys.length,
    armWins,
    baseWins,
    ties: keys.length - armWins - baseWins,
    pValue: signTestPValue(armWins, baseWins),
    base: summarize(baseShares),
    arm: summarize(armShares),
  };
}
