/**
 * T2.1 — the two existing evals (distillation→consolidation, forgetting) now
 * live in the package (ADR D6, one home). This asserts both migrated runners
 * execute their pure logic and render a matrix, DB-free.
 */
import { describe, expect, it } from 'vitest';

import { renderForgettingMatrix, type ScenarioResult } from './forgetting/run.js';
import { renderConsolidationMatrix, runConsolidationEval } from './consolidation/run.js';

describe('migrated eval runners', () => {
  it('test_migrated_runners_execute_and_render_matrix', async () => {
    // Consolidation: LLM-free harness executes over the hand-authored gold set.
    const results = await runConsolidationEval();
    expect(results.length).toBeGreaterThan(0);
    const consolidationMatrix = renderConsolidationMatrix(results);
    expect(consolidationMatrix).toContain('| Policy |');

    // Forgetting: the matrix renderer is pure (the full run needs a DB, gated
    // separately). Feed synthetic scenario rows and assert it renders.
    const scenarios: readonly ScenarioResult[] = [
      { name: '(a) random', evictedTotal: 300, rareSurvivors: 40, recallAt10: 0.8 },
      { name: '(d) triadic + multiplier', evictedTotal: 300, rareSurvivors: 50, recallAt10: 1 },
    ];
    const forgettingMatrix = renderForgettingMatrix(scenarios);
    expect(forgettingMatrix).toContain('| Strategy |');
    expect(forgettingMatrix).toContain('recall@10');
  });
});
