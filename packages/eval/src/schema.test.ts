/**
 * T1.2 — Zod unified StageScore + Baseline schema. Validated at read time
 * (mirrors the tests/fixtures/distillation/loader.ts Zod-at-read precedent).
 */
import { describe, expect, it } from 'vitest';

import { BaselineSchema, StageScoreSchema } from './schema.js';

const validScore = {
  stage: 'extraction',
  precision: 0.82,
  recall: 0.7,
  accuracy: 1,
  n: 12,
  runtimeMs: 4,
};

describe('eval schema', () => {
  it('parses a valid StageScore + Baseline', () => {
    expect(() => StageScoreSchema.parse(validScore)).not.toThrow();
    const baseline = {
      generatedAt: '2026-07-25T00:00:00.000Z',
      model: 'llm-free',
      stages: [validScore, { ...validScore, stage: 'consolidation', accuracy: undefined }],
    };
    const parsed = BaselineSchema.parse(baseline);
    expect(parsed.stages).toHaveLength(2);
  });

  it('test_baseline_schema_rejects_out_of_range_score', () => {
    // NEGATIVE: precision > 1 → ZodError.
    expect(() => StageScoreSchema.parse({ ...validScore, precision: 1.5 })).toThrow();
    // NEGATIVE: precision < 0 → ZodError.
    expect(() => StageScoreSchema.parse({ ...validScore, precision: -0.1 })).toThrow();
    // NEGATIVE: missing required field (stage) → ZodError.
    const { stage: _omit, ...noStage } = validScore;
    void _omit;
    expect(() => StageScoreSchema.parse(noStage)).toThrow();
    // NEGATIVE: baseline with a bad stage inside the array → ZodError.
    expect(() =>
      BaselineSchema.parse({
        generatedAt: '2026-07-25T00:00:00.000Z',
        model: 'llm-free',
        stages: [{ ...validScore, recall: 2 }],
      }),
    ).toThrow();
  });
});
