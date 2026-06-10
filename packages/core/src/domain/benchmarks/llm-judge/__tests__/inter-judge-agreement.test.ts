/**
 * T1.2 RED tests for EC-10 inter-judge agreement.
 *
 * Liberal-shape interpretation: return shape with `warning` field when
 * N<2 valid judges, rather than null. Preserves audit trail per
 * cycle-implement.md § 3 (Honestidade Extrema).
 *
 * @see plan v1.2 § T1.2 + EC-10
 */
import { describe, expect, it } from 'vitest';

import { computeAgreement } from '../inter-judge-agreement.js';

describe('computeAgreement (EC-10)', () => {
  it('returns NaN percentAgreement with warning when only 1 valid judge', () => {
    const result = computeAgreement(['CORRECT']);
    expect(result.validJudgeCount).toBe(1);
    expect(Number.isNaN(result.percentAgreement)).toBe(true);
    expect(result.warning).toMatch(/N<2/);
  });

  it('returns NaN percentAgreement with warning when all judges returned null', () => {
    const result = computeAgreement([null, null]);
    expect(result.validJudgeCount).toBe(0);
    expect(Number.isNaN(result.percentAgreement)).toBe(true);
  });

  it('returns 1.0 agreement when 2 judges agree', () => {
    const result = computeAgreement(['CORRECT', 'CORRECT']);
    expect(result.percentAgreement).toBeCloseTo(1.0);
    expect(result.validJudgeCount).toBe(2);
    expect(result.warning).toBeUndefined();
  });

  it('returns 0.5 agreement when 2 judges disagree', () => {
    const result = computeAgreement(['CORRECT', 'WRONG']);
    expect(result.percentAgreement).toBeCloseTo(0.5);
    expect(result.validJudgeCount).toBe(2);
  });

  it('handles 3 judges with one null (uses 2 valid labels)', () => {
    const result = computeAgreement(['CORRECT', 'CORRECT', null]);
    expect(result.validJudgeCount).toBe(2);
    expect(result.percentAgreement).toBeCloseTo(1.0);
  });

  it('returns 2/3 agreement when 3 judges split 2-vs-1', () => {
    const result = computeAgreement(['CORRECT', 'CORRECT', 'WRONG']);
    expect(result.validJudgeCount).toBe(3);
    expect(result.percentAgreement).toBeCloseTo(2 / 3);
  });
});
