/**
 * T1.3 — Regression comparator. The milestone's core new mechanism (ADR D3):
 * a committed baseline + a per-metric tolerance band, FAIL-CLOSED.
 */
import { describe, expect, it } from 'vitest';

import {
  assertNoRegression,
  compareToBaseline,
  DEFAULT_TOLERANCE,
  RegressionError,
} from './regression.js';
import type { Baseline, StageScore } from './schema.js';

const baseline: Baseline = {
  generatedAt: '2026-07-25T00:00:00.000Z',
  model: 'llm-free',
  stages: [
    { stage: 'extraction', precision: 0.8, recall: 0.7, accuracy: 1, n: 12, runtimeMs: 3 },
    { stage: 'consolidation', precision: 0.9, recall: 0.9, accuracy: 0.85, n: 10, runtimeMs: 2 },
  ],
};

function candidate(overrides: Partial<StageScore> & { stage: string }): StageScore {
  const base = baseline.stages.find((s) => s.stage === overrides.stage);
  return { ...(base ?? baseline.stages[0]), ...overrides } as StageScore;
}

describe('regression gate', () => {
  it('passes when candidate meets or exceeds baseline', () => {
    const cand: StageScore[] = [
      candidate({ stage: 'extraction', precision: 0.85, recall: 0.72 }),
      candidate({ stage: 'consolidation' }),
    ];
    const result = compareToBaseline(cand, baseline);
    expect(result.regressed).toBe(false);
    expect(() => assertNoRegression(cand, baseline)).not.toThrow();
  });

  it('test_regression_gate_fails_closed_on_seeded_drop', () => {
    // SEEDED regression: extraction precision drops well below baseline - ε.
    const cand: StageScore[] = [
      candidate({ stage: 'extraction', precision: 0.5 }),
      candidate({ stage: 'consolidation' }),
    ];
    const result = compareToBaseline(cand, baseline);
    expect(result.regressed).toBe(true);
    expect(result.details.some((d) => d.stage === 'extraction' && d.metric === 'precision' && d.regressed)).toBe(true);
    expect(() => assertNoRegression(cand, baseline)).toThrow(RegressionError);
  });

  it('EDGE: candidate exactly at baseline - epsilon is NOT a regression (inclusive)', () => {
    const eps = DEFAULT_TOLERANCE.precision;
    const cand: StageScore[] = [
      candidate({ stage: 'extraction', precision: 0.8 - eps }),
      candidate({ stage: 'consolidation' }),
    ];
    expect(compareToBaseline(cand, baseline).regressed).toBe(false);
    expect(() => assertNoRegression(cand, baseline)).not.toThrow();
  });

  it('NEGATIVE: an unknown candidate stage fails-closed', () => {
    const cand: StageScore[] = [
      candidate({ stage: 'extraction' }),
      candidate({ stage: 'consolidation' }),
      { stage: 'ghost-stage', precision: 1, recall: 1, n: 1, runtimeMs: 0 },
    ];
    expect(() => assertNoRegression(cand, baseline)).toThrow(RegressionError);
  });

  it('NEGATIVE: a missing candidate stage fails-closed', () => {
    const cand: StageScore[] = [candidate({ stage: 'extraction' })];
    expect(() => assertNoRegression(cand, baseline)).toThrow(RegressionError);
  });
});
