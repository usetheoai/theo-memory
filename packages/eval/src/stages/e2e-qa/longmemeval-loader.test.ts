/**
 * Unit tests for `selectRunSubset` — the E2E_QA_LIMIT mode dispatcher that lets the
 * e2e-qa harness run the full LongMemEval_oracle set (REDACTED-comparable) vs the default
 * 12-example smoke subset vs a first-n sample. Pure, keyless, deterministic.
 */
import { describe, expect, it } from 'vitest';

import { selectRunSubset, type LongMemEvalExample } from './longmemeval-loader.js';

/** Minimal valid example; `abs` marks an abstention (`_abs` question_id suffix). */
function ex(n: number, type = 'temporal-reasoning', abs = false): LongMemEvalExample {
  return {
    question_id: `q${String(n)}${abs ? '_abs' : ''}`,
    question_type: type,
    question: `question ${String(n)}`,
    answer: `answer ${String(n)}`,
    question_date: '2026-01-01',
    haystack_dates: ['2026-01-01'],
    haystack_sessions: [[{ role: 'user', content: `turn ${String(n)}` }]],
  };
}

describe('selectRunSubset', () => {
  const dataset = Array.from({ length: 40 }, (_, i) => ex(i));

  it("mode 'full' returns the ENTIRE dataset (identity — the REDACTED-comparable run)", () => {
    const out = selectRunSubset(dataset, 'full');
    expect(out).toHaveLength(dataset.length);
    expect(out).toBe(dataset);
  });

  it("mode '<n>' returns the first n examples in dataset order", () => {
    expect(selectRunSubset(dataset, '5')).toHaveLength(5);
    expect(selectRunSubset(dataset, '5').map((e) => e.question_id)).toEqual([
      'q0',
      'q1',
      'q2',
      'q3',
      'q4',
    ]);
  });

  it('unset mode delegates to the deterministic 12-example smoke subset', () => {
    // With ≥12 typed examples available the default subset caps at 12 (backward-compatible).
    const rich = [
      ...Array.from({ length: 5 }, (_, i) => ex(i, 'temporal-reasoning', true)),
      ...Array.from({ length: 5 }, (_, i) => ex(100 + i, 'temporal-reasoning')),
      ...Array.from({ length: 5 }, (_, i) => ex(200 + i, 'multi-session')),
      ...Array.from({ length: 5 }, (_, i) => ex(300 + i, 'knowledge-update')),
    ];
    const out = selectRunSubset(rich, '');
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.length).toBeGreaterThan(0);
  });

  it("garbage '<n>' falls back to at least 1 (never empty / never NaN slice)", () => {
    expect(selectRunSubset(dataset, 'not-a-number')).toHaveLength(1);
    expect(selectRunSubset(dataset, '0')).toHaveLength(1);
  });
});
