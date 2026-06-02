/**
 * T7.2 — DMR runner for TheMemory v0.7 (TERTIARY per ADR D2).
 *
 * @see plan v1.2 § T7.2 + ADR D2
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { main as runDmr } from '../../../benchmarks/scripts/run-dmr.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SMOKE_FIXTURE = join(REPO_ROOT, 'tests', 'e2e', 'benchmarks', 'fixtures', 'dmr-smoke.json');

describe('DMR × TheMemory — smoke', () => {
  let tmpResultsDir: string;

  beforeAll(() => {
    tmpResultsDir = mkdtempSync(join(tmpdir(), 't7-2-smoke-'));
  });
  afterAll(() => {
    rmSync(tmpResultsDir, { recursive: true, force: true });
  });

  it('runs the DMR smoke fixture end-to-end and produces a RunReport', async () => {
    expect(existsSync(SMOKE_FIXTURE)).toBe(true);
    const resultsPath = join(tmpResultsDir, 'themory.json');
    const report = await runDmr({
      fixturePath: SMOKE_FIXTURE,
      resultsPath,
      modelId: 'gpt-4o-mini',
    });
    expect(report.adapter).toBe('themory');
    expect(report.aggregate.questionCount).toBe(2);
    expect(report.perQuery).toHaveLength(2);
    expect(existsSync(resultsPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
      adapter: string;
      final: boolean;
    };
    expect(persisted.adapter).toBe('themory');
    expect(persisted.final).toBe(true);
  });
});
