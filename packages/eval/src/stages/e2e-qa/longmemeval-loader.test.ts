/**
 * Unit tests for `selectRunSubset` — the E2E_QA_LIMIT mode dispatcher that lets the
 * e2e-qa harness run the selected LongMemEval dataset vs the default
 * 12-example smoke subset vs a first-n sample. Pure, keyless, deterministic.
 */
import { describe, expect, it } from 'vitest';

import {
  chronologicalSessions,
  chronologicalTurns,
  selectRunSubset,
  type LongMemEvalExample,
} from './longmemeval-loader.js';

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

  it("mode 'full' returns the ENTIRE dataset (identity — the full run)", () => {
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

  it('selects exact question IDs in the requested order', () => {
    const out = selectRunSubset(dataset, 'full', 'q7, q2');
    expect(out.map((e) => e.question_id)).toEqual(['q7', 'q2']);
  });

  it('rejects unknown question IDs instead of silently running a different sample', () => {
    expect(() => selectRunSubset(dataset, '', 'q999')).toThrow('Unknown LongMemEval question IDs: q999');
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

describe('chronologicalTurns', () => {
  const example: LongMemEvalExample = {
    question_id: 'q', question_type: 'temporal-reasoning', question: 'q', answer: 'a', question_date: '2023/02/01',
    haystack_dates: ['2023/02/02 (Thu) 00:00', '2023/02/01 (Wed) 00:00'],
    haystack_sessions: [
      [{ role: 'user', content: 'later' }, { role: 'assistant', content: 'reply' }],
      [{ role: 'user', content: 'earlier' }],
    ],
  };

  it('keeps every source turn in chronological session order when cap is zero', () => {
    expect(chronologicalTurns(example, 0).map((turn) => turn.content)).toEqual(['earlier', 'later', 'reply']);
    expect(chronologicalTurns(example, 0)).toHaveLength(3);
  });

  it('retains each session date and applies a positive diagnostic cap', () => {
    expect(chronologicalTurns(example, 2)).toEqual([
      { role: 'user', content: 'earlier', sourceDate: '2023/02/01 (Wed) 00:00' },
      { role: 'user', content: 'later', sourceDate: '2023/02/02 (Thu) 00:00' },
    ]);
  });

  it('rejects a negative cap', () => {
    expect(() => chronologicalTurns(example, -1)).toThrow('non-negative integer');
  });
});

describe('chronologicalSessions', () => {
  const example: LongMemEvalExample = {
    question_id: 'q', question_type: 'multi-session', question: 'q', answer: 'a', question_date: '2023/02/01',
    haystack_dates: ['2023/02/02 (Thu) 00:00', '2023/02/01 (Wed) 00:00'],
    haystack_sessions: [
      [{ role: 'user', content: 'later one' }, { role: 'assistant', content: 'later two' }],
      [{ role: 'user', content: 'earlier' }],
    ],
  };

  it('retains session boundaries and chronological order with unlimited history', () => {
    expect(chronologicalSessions(example)).toEqual([
      { sourceDate: '2023/02/01 (Wed) 00:00', turns: [{ role: 'user', content: 'earlier' }] },
      { sourceDate: '2023/02/02 (Thu) 00:00', turns: [
        { role: 'user', content: 'later one' }, { role: 'assistant', content: 'later two' },
      ] },
    ]);
  });

  it('applies turn caps across sessions and can cap inside a session', () => {
    expect(chronologicalSessions(example, 2)).toEqual([
      { sourceDate: '2023/02/01 (Wed) 00:00', turns: [{ role: 'user', content: 'earlier' }] },
      { sourceDate: '2023/02/02 (Thu) 00:00', turns: [{ role: 'user', content: 'later one' }] },
    ]);
  });
});
