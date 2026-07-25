/**
 * T3.2 — extraction structural runner (LLM-free). Computes REAL precision/recall
 * of the deterministic CompromiseEntityExtractor over the golden set, plus a
 * noise-rejection accuracy over the negative cases. Numbers are computed, never
 * hardcoded.
 */
import { describe, expect, it } from 'vitest';

import { StageScoreSchema } from '../../schema.js';
import { consolidationStageScore } from '../consolidation/run.js';
import { runExtractionEval } from './run.js';

describe('extraction runner', () => {
  it('test_extraction_runner_emits_valid_stagescore', () => {
    const score = runExtractionEval();
    // Schema-valid (fail-closed if any field is out of range).
    expect(() => StageScoreSchema.parse(score)).not.toThrow();
    expect(score.stage).toBe('extraction');
    expect(score.precision).toBeGreaterThanOrEqual(0);
    expect(score.precision).toBeLessThanOrEqual(1);
    expect(score.recall).toBeGreaterThanOrEqual(0);
    expect(score.recall).toBeLessThanOrEqual(1);
    expect(score.accuracy).toBeDefined();
    // 9 hard cases in the golden set.
    expect(score.n).toBe(9);
    // The numbers are non-degenerate (real signal, not a trivial 0 or 1).
    expect(score.precision).toBeGreaterThan(0);
    expect(score.precision).toBeLessThan(1);
  });

  it('deterministic: two runs produce identical scores', () => {
    const a = runExtractionEval();
    const b = runExtractionEval();
    expect({ p: a.precision, r: a.recall, acc: a.accuracy }).toEqual({
      p: b.precision,
      r: b.recall,
      acc: b.accuracy,
    });
  });

  it('an injected zero-extractor drops precision/recall to 0 (non-vacuous)', () => {
    const score = runExtractionEval({ extract: () => [] });
    expect(score.precision).toBe(0);
    expect(score.recall).toBe(0);
    // Every negative case is correctly rejected -> accuracy 1.
    expect(score.accuracy).toBe(1);
  });

  it('consolidation runner emits a valid StageScore', async () => {
    const score = await consolidationStageScore();
    expect(() => StageScoreSchema.parse(score)).not.toThrow();
    expect(score.stage).toBe('consolidation');
    expect(score.n).toBeGreaterThan(0);
  });
});
