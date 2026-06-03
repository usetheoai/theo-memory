/**
 * T7.1 — LoCoMo runner for TheMemory v0.7 (SECONDARY per ADR D2).
 *
 * @see plan v1.2 § T7.1 + ADRs D2 / D4
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { main as runLoCoMo } from '../../../benchmarks/scripts/run-locomo.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SMOKE_FIXTURE = join(
  REPO_ROOT,
  'tests',
  'e2e',
  'benchmarks',
  'fixtures',
  'locomo-smoke.json',
);

describe('LoCoMo × TheMemory — smoke', () => {
  let tmpResultsDir: string;

  beforeAll(() => {
    tmpResultsDir = mkdtempSync(join(tmpdir(), 't7-1-smoke-'));
  });
  afterAll(() => {
    rmSync(tmpResultsDir, { recursive: true, force: true });
  });

  it('runs the LoCoMo smoke fixture end-to-end and produces a RunReport', async () => {
    expect(existsSync(SMOKE_FIXTURE)).toBe(true);
    const resultsPath = join(tmpResultsDir, 'themory.json');
    const report = await runLoCoMo({
      fixturePath: SMOKE_FIXTURE,
      resultsPath,
      modelId: 'gpt-4o-mini',
    });
    expect(report.adapter).toBe('themory');
    expect(report.aggregate.questionCount).toBeGreaterThan(0);
    expect(existsSync(resultsPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
      adapter: string;
      final: boolean;
    };
    expect(persisted.adapter).toBe('themory');
    expect(persisted.final).toBe(true);
  });
});
