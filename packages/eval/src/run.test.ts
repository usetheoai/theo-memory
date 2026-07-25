/**
 * T4.1 — orchestrator + committed baseline + regression wiring.
 *
 * Proves the gate PASSES against the committed baseline (deterministic
 * LLM-free run) AND FIRES when the baseline is raised to simulate a candidate
 * regression. Also proves fail-closed on a missing/corrupt baseline file.
 */
import { describe, expect, it } from 'vitest';

import { RegressionError } from './regression.js';
import type { Baseline } from './schema.js';
import { assertGate, collectStageScores, loadBaseline, main } from './run.js';

describe('eval orchestrator gate', () => {
  it('test_orchestrator_gate_passes_baseline_and_fails_seeded_regression', async () => {
    const candidate = await collectStageScores();
    expect(candidate.map((s) => s.stage).sort()).toEqual(['consolidation', 'extraction']);

    const baseline = loadBaseline();
    // The committed baseline is the deterministic run itself -> gate passes.
    expect(() => assertGate(candidate, baseline)).not.toThrow();

    // Raise the baseline (simulate a candidate that regressed below it) -> fire.
    const raised: Baseline = {
      ...baseline,
      stages: baseline.stages.map((s) => ({ ...s, precision: 1, recall: 1 })),
    };
    expect(() => assertGate(candidate, raised)).toThrow(RegressionError);
  });

  it('FAILURE: a missing baseline file fails-closed', () => {
    expect(() => loadBaseline('/nonexistent/baseline.json')).toThrow();
  });

  it('FAILURE: an unknown --stage fails-closed instead of passing vacuously', async () => {
    // A mistyped stage filters to an empty set; without the guard the gate would
    // "PASS" over nothing (false green). It must throw naming the known stages.
    await expect(main(['--stage', 'typo-not-a-stage'])).rejects.toThrow(/unknown --stage/);
  });
});
