/**
 * T5.1 — LongMemEval THE GOAL TEST for TheMemory v0.7 (PRIMARY per ADR D2).
 *
 * Two-layer TDD strategy per Drift-T5.1-2:
 *   - Layer 1 (default): smoke fixture (3 questions), runs ~5-10 seconds,
 *     no API keys required (StubAnswerLlm + smoke judge panel). Validates
 *     run-longmemeval.ts wiring end-to-end without the 30-50 min cost.
 *   - Layer 2 (BENCH_RUN=full + OPENAI_API_KEY): real 500-question run
 *     against the downloaded longmemeval_oracle.json. Deferred to CI
 *     dedicated runner; skipped by default in /implement halt-loop.
 *
 * @see plan v1.2 § T5.1 + ADRs D2 / D4 / EC-4
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { main as runLongMemEval } from '../../../benchmarks/scripts/run-longmemeval.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SMOKE_FIXTURE = join(
  REPO_ROOT,
  'tests',
  'e2e',
  'benchmarks',
  'fixtures',
  'longmemeval-smoke.json',
);

describe('LongMemEval × TheMemory — smoke (3 questions, no API keys)', () => {
  let tmpResultsDir: string;

  beforeAll(() => {
    tmpResultsDir = mkdtempSync(join(tmpdir(), 't5-1-smoke-'));
  });

  afterAll(() => {
    rmSync(tmpResultsDir, { recursive: true, force: true });
  });

  it('runs the LongMemEval smoke fixture end-to-end and produces a RunReport', async () => {
    expect(existsSync(SMOKE_FIXTURE)).toBe(true);
    const resultsPath = join(tmpResultsDir, 'themory.json');
    const report = await runLongMemEval({
      fixturePath: SMOKE_FIXTURE,
      resultsPath,
      modelId: 'gpt-4o-mini',
    });
    expect(report.adapter).toBe('themory');
    expect(report.aggregate.questionCount).toBe(3);
    expect(report.perQuery).toHaveLength(3);
    expect(existsSync(resultsPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
      adapter: string;
      perQuery: unknown[];
      final: boolean;
    };
    expect(persisted.adapter).toBe('themory');
    expect(persisted.final).toBe(true);
    expect(persisted.perQuery).toHaveLength(3);
  });

  it('each per-query record carries judge label + latency + cost fields', async () => {
    const resultsPath = join(tmpResultsDir, 'themory-2.json');
    const report = await runLongMemEval({
      fixturePath: SMOKE_FIXTURE,
      resultsPath,
      modelId: 'gpt-4o-mini',
    });
    for (const record of report.perQuery) {
      expect(record.questionId).toMatch(/^lme-smoke-/);
      expect(['CORRECT', 'WRONG', null]).toContain(record.judgeLabel);
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof record.costUsd).toBe('number');
    }
  });
});

describe.skipIf(
  process.env['BENCH_RUN'] !== 'full' || (process.env['OPENAI_API_KEY'] ?? '') === '',
)('LongMemEval × TheMemory — full 500-question run (BENCH_RUN=full)', () => {
  it('produces a 500-record cell for docs/benchmarks/v0.8.md', async () => {
    const fixturePath =
      process.env['LONGMEMEVAL_FIXTURE_PATH'] ??
      join(REPO_ROOT, 'benchmarks', 'data', 'longmemeval', 'longmemeval_oracle.json');
    const resultsPath = join(REPO_ROOT, 'benchmarks', 'results', 'longmemeval', 'themory.json');
    const report = await runLongMemEval({ fixturePath, resultsPath });
    expect(report.perQuery.length).toBeGreaterThanOrEqual(1);
    expect(report.aggregate.questionCount).toBe(report.perQuery.length);
  }, 60 * 60 * 1000);
});
