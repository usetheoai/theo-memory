import { describe, expect, it } from 'vitest';

import { comparePaired, wilsonInterval } from './paired-comparison.js';

function run(answers: Record<string, boolean>): ReadonlyMap<string, boolean> {
  return new Map(Object.entries(answers));
}

function series(total: number, correct: number): ReadonlyMap<string, boolean> {
  return new Map(Array.from({ length: total }, (_, i) => [`q${i}`, i < correct] as const));
}

describe('wilsonInterval', () => {
  it('is wide for 9 of 12', () => {
    const interval = wilsonInterval(9, 12);

    expect(interval.low).toBeCloseTo(0.468, 3);
    expect(interval.high).toBeCloseTo(0.911, 3);
  });

  it('narrows for 51 of 60', () => {
    const interval = wilsonInterval(51, 60);

    expect(interval.low).toBeCloseTo(0.739, 3);
    expect(interval.high).toBeCloseTo(0.919, 3);
  });

  it('rejects more successes than trials', () => {
    expect(() => wilsonInterval(13, 12)).toThrow('successes must be between 0 and 12, got 13');
  });
});

describe('comparePaired', () => {
  it('reports no difference between two identical series', () => {
    const runs = [series(60, 51), series(60, 51), series(60, 51)];

    const result = comparePaired(runs, runs);

    expect(result).toMatchObject({ questions: 60, armWins: 0, baseWins: 0, ties: 60, pValue: 1 });
  });

  it('detects a 30-point difference on 100 questions', () => {
    const result = comparePaired([series(100, 50)], [series(100, 80)]);

    expect(result.armWins).toBe(30);
    expect(result.baseWins).toBe(0);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('does not call a one-question difference on 60 questions significant', () => {
    const result = comparePaired([series(60, 50)], [series(60, 51)]);

    expect(result.armWins).toBe(1);
    expect(result.pValue).toBe(1);
  });

  it('counts wins in both directions when the totals are equal', () => {
    const base = [run({ a: true, b: false, c: true })];
    const arm = [run({ a: false, b: true, c: true })];

    const result = comparePaired(base, arm);

    expect(result).toMatchObject({ armWins: 1, baseWins: 1, ties: 1, pValue: 1 });
  });

  it('counts a question whose answer changes between runs of one side as unstable', () => {
    const base = [run({ a: true, b: true }), run({ a: false, b: true }), run({ a: true, b: true })];
    const arm = [run({ a: true, b: true }), run({ a: true, b: true }), run({ a: true, b: true })];

    const result = comparePaired(base, arm);

    expect(result.base.unstable).toBe(1);
    expect(result.arm.unstable).toBe(0);
    expect(result.armWins).toBe(1);
  });

  it('reports each side by the majority answer of its runs', () => {
    const base = [run({ a: true, b: false }), run({ a: true, b: false }), run({ a: false, b: false })];

    const result = comparePaired(base, base);

    expect(result.base.majorityCorrect).toBe(1);
    expect(result.base.interval).toEqual(wilsonInterval(1, 2));
  });

  it('rejects sides that asked different questions', () => {
    expect(() => comparePaired([run({ a: true })], [run({ b: true })])).toThrow(
      "Paired comparison needs the same questions on both sides; 'b' is missing from the base.",
    );
  });

  it('rejects a side with no runs', () => {
    expect(() => comparePaired([], [run({ a: true })])).toThrow('Paired comparison needs at least one run per side.');
  });
});
