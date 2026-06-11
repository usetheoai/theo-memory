/**
 * EC-10 absorption: inter-judge agreement.
 *
 * Liberal-shape interpretation: returns a shape with `warning` field
 * when N<2 valid (non-null) judge labels exist. Preserves audit trail
 * per cycle-implement.md § 3 (Honestidade Extrema) rather than silently
 * discarding the warning by returning null.
 *
 * Cohen's kappa is currently null for v0.8 (simple %-agreement is
 * sufficient for binary labels per ADR D3 wording).
 *
 * @see plan v1.2 § T1.2 + EC-10
 */
import type { JudgeLabel } from './json-extractor.js';

export interface InterJudgeAgreement {
  readonly percentAgreement: number;
  readonly kappa: number | null;
  readonly validJudgeCount: number;
  readonly warning?: string;
}

export function computeAgreement(
  labels: readonly (JudgeLabel | null)[],
): InterJudgeAgreement {
  const valid = labels.filter((l): l is JudgeLabel => l !== null);
  if (valid.length < 2) {
    return {
      percentAgreement: Number.NaN,
      kappa: null,
      validJudgeCount: valid.length,
      warning: 'agreement undefined for N<2 valid judges',
    };
  }
  const correctCount = valid.filter((l) => l === 'CORRECT').length;
  const majority: JudgeLabel = correctCount >= valid.length / 2 ? 'CORRECT' : 'WRONG';
  const matches = valid.filter((l) => l === majority).length;
  return {
    percentAgreement: matches / valid.length,
    kappa: null,
    validJudgeCount: valid.length,
  };
}
