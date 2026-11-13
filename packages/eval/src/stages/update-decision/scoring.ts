/**
 * Scoring of the update-decision pair set: of two notes about one person, does the second make
 * the first no longer true?
 *
 * Two numbers matter and they pull against each other. `found` is how many real updates a
 * decision ends. `wronglyEnded` is how many notes that stay true it ends anyway: a count for
 * another year, another occasion of an event, a different attribute, one more value of something
 * that admits several, or the same value said again. A decision that ends everything finds every
 * update; the second number is what keeps it honest.
 */
import { wilsonInterval, type Interval } from '../../metrics/paired-comparison.js';

export const PAIR_LABELS = [
  'update', 'correction', 'restated', 'different-attribute', 'different-period', 'another-occurrence', 'additional-value',
] as const;
export type PairLabel = (typeof PAIR_LABELS)[number];

export interface UpdatePair {
  readonly id: string;
  readonly label: PairLabel;
  readonly language: 'en' | 'pt';
  /** The dates the two notes were written; B is the later one. */
  readonly dateA: string;
  readonly dateB: string;
  readonly textA: string;
  readonly textB: string;
  readonly valueA: string;
  readonly valueB: string;
}

/** Whether the second note of a pair with this label makes the first one no longer true. */
export function endsTheFirst(label: PairLabel): boolean {
  return label === 'update' || label === 'correction';
}

export interface DecisionRate {
  readonly count: number;
  readonly of: number;
  readonly interval: Interval;
}

export interface UpdateDecisionSummary {
  /** Real updates and corrections whose first note was ended. */
  readonly found: DecisionRate;
  /** Pairs where both notes stay true and the first one was ended anyway. */
  readonly wronglyEnded: DecisionRate;
  readonly byLabel: Readonly<Record<PairLabel, { readonly ended: number; readonly of: number }>>;
}

function rate(count: number, of: number): DecisionRate {
  return { count, of, interval: of === 0 ? { low: 0, high: 0 } : wilsonInterval(count, of) };
}

/** `ended` says, for each pair id, whether the decision under test ended the first note. */
export function summarizeDecisions(pairs: readonly UpdatePair[], ended: ReadonlyMap<string, boolean>): UpdateDecisionSummary {
  const byLabel = Object.fromEntries(PAIR_LABELS.map((label) => [label, { ended: 0, of: 0 }])) as Record<PairLabel, { ended: number; of: number }>;
  for (const pair of pairs) {
    const decision = ended.get(pair.id);
    if (decision === undefined) throw new Error(`No decision recorded for pair '${pair.id}'.`);
    byLabel[pair.label].of += 1;
    if (decision) byLabel[pair.label].ended += 1;
  }
  const sum = (labels: readonly PairLabel[], key: 'ended' | 'of'): number => labels.reduce((total, label) => total + byLabel[label][key], 0);
  const real = PAIR_LABELS.filter(endsTheFirst);
  const kept = PAIR_LABELS.filter((label) => !endsTheFirst(label));
  return { found: rate(sum(real, 'ended'), sum(real, 'of')), wronglyEnded: rate(sum(kept, 'ended'), sum(kept, 'of')), byLabel };
}
