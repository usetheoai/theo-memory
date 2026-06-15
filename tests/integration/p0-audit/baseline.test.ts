/**
 * T0.1 — Baseline audit script integration test (p0-api-sdk-mcp-correctness-audit plan).
 *
 * Verifies the deterministic baseline audit script produces a valid JSON summary
 * on stdout. The script captures the empirical baseline (paper-name counts,
 * export counts, subpath count, `any` count in public surface, `dist/` presence,
 * `## Dependencies` section presence per EC-1 absorption) that downstream tasks
 * cite as their regression sentinels.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T0.1
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'audit', 'p0-baseline.sh');

describe('T0.1 — Baseline audit script', () => {
  test('1. scripts/audit/p0-baseline.sh exists and is executable', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  test('2. script exits 0 and emits valid JSON on stdout', () => {
    const result = spawnSync('bash', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  test('3. JSON output includes the 6 baseline audit fields', () => {
    const result = spawnSync('bash', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data: Record<string, unknown> = JSON.parse(result.stdout);
    expect(data).toHaveProperty('paper_names');
    expect(data).toHaveProperty('exports');
    expect(data).toHaveProperty('subpaths');
    expect(data).toHaveProperty('any_in_public');
    expect(data).toHaveProperty('dist_exists');
    expect(data).toHaveProperty('dependencies_section_present');
  });

  test('4. paper_names field enumerates all 5 audited tokens', () => {
    const result = spawnSync('bash', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data = JSON.parse(result.stdout) as { paper_names: Record<string, number> };
    expect(Object.keys(data.paper_names).sort()).toEqual(
      ['REDACTED', 'REDACTED', 'REDACTED', 'REDACTED', 'REDACTED'].sort(),
    );
  });

  test('5. exports field counts both src/index.ts and src/core/index.ts', () => {
    const result = spawnSync('bash', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data = JSON.parse(result.stdout) as { exports: Record<string, number> };
    expect(data.exports).toHaveProperty('packages/core/src/index.ts');
    expect(data.exports).toHaveProperty('packages/core/src/domain/index.ts');
    expect(data.exports['packages/core/src/index.ts']).toBeGreaterThan(0);
    expect(data.exports['packages/core/src/domain/index.ts']).toBeGreaterThan(0);
  });

  test('6. dependencies_section_present is true (EC-1 absorption sentinel)', () => {
    const result = spawnSync('bash', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data = JSON.parse(result.stdout) as { dependencies_section_present: boolean };
    expect(data.dependencies_section_present).toBe(true);
  });
});
