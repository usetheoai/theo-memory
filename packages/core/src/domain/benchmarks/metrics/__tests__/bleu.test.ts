/**
 * T0.1 (v0-8-fixes-cycle-1) — Honest-deferral throw-contract test for BLEU.
 *
 * Drift-T1.1-1: `natural@8.1.x` removed BLEU entirely (empirical proof
 * 2026-06-02: `find node_modules/natural -name '*bleu*'` returned zero
 * matches; `Object.keys(require('natural')).filter(k => /Bleu/i.test(k))`
 * returned []). Per ADR D1 (v0-8-fixes-cycle-1), Option C (defer) is the
 * locked path; `calculateBleuScore` throws `BleuMetricUnavailable` with
 * the marker in the message so any caller that still consumes BLEU
 * surfaces the deferral loudly instead of silently propagating 0.
 *
 * No `describe.skipIf` gate — the throw contract MUST be observable on
 * every `npm test` run; silencing it via skipIf is precisely the
 * F-tests-1 BLOCKER failure mode this task fixes.
 *
 * @see .claude/knowledge-base/plans/v0-8-fixes-cycle-1-plan.md § T0.1 + ADR D1
 * @see .claude/knowledge-base/reviews/v0-8-independent-benchmark-reproduction-review-2026-06-02.md § F-tests-1
 */
import { describe, expect, it } from 'vitest';

import { BleuMetricUnavailable, calculateBleuScore } from '../bleu.js';

describe('calculateBleuScore — honest-deferral throw contract', () => {
  it('throws BleuMetricUnavailable on any invocation', () => {
    expect(() => calculateBleuScore('the cat sat on the mat', 'the cat sat on the mat')).toThrow(
      BleuMetricUnavailable,
    );
  });

  it('throws with Drift-T1.1-1 marker in the message', () => {
    expect(() => calculateBleuScore('a', 'b')).toThrow(/Drift-T1\.1-1/);
  });

  it('throws even when both inputs are empty (deferral is unconditional)', () => {
    expect(() => calculateBleuScore('', '')).toThrow(BleuMetricUnavailable);
  });
});
