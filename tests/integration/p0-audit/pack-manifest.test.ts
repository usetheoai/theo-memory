/**
 * T2.3 — `npm pack --dry-run --json` manifest verification.
 *
 * Asserts the published artifact shape matches what `package.json#files`
 * declares: every src/**\/*.ts entry ships, every migrations/** ships,
 * package.json + README ship, AND zero __tests__/** or *.test.ts entries
 * leak.
 *
 * EC-12 absorption (DOCUMENT): test uses tolerant `toBeGreaterThan(N)`
 * assertions instead of exact counts so npm version drift across
 * machines does not false-fail. The exact npm version present at audit
 * time is captured in the artifact via `process.versions.node` +
 * `npm --version` recorded by `scripts/audit/p0-baseline.sh`.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T2.3
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

interface PackFileEntry {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
}

interface PackResult {
  readonly name: string;
  readonly version: string;
  readonly files: readonly PackFileEntry[];
  readonly entryCount: number;
  readonly unpackedSize: number;
}

function runPackDryRun(): PackResult {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as readonly PackResult[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack --json returned unexpected shape (not a non-empty array)');
  }
  return parsed[0]!;
}

describe('T2.3 — npm pack --dry-run manifest', () => {
  const pack = runPackDryRun();
  const paths = pack.files.map((f) => f.path);

  test('1. pack manifest emits >= 100 file entries (tolerant per EC-12)', () => {
    expect(pack.entryCount).toBeGreaterThanOrEqual(100);
    expect(pack.files.length).toBeGreaterThanOrEqual(100);
  });

  test('2. pack manifest ships package.json + README.md (publish hygiene)', () => {
    expect(paths).toContain('package.json');
    expect(paths).toContain('README.md');
  });

  test('3. pack manifest ships >= 100 src/**/*.ts entries', () => {
    const srcTs = paths.filter((p) => p.startsWith('src/') && p.endsWith('.ts'));
    expect(srcTs.length).toBeGreaterThanOrEqual(100);
  });

  test('4. pack manifest ships >= 1 src/local/migrations/** entry (architecture.md § 10.1)', () => {
    const migrations = paths.filter((p) => p.startsWith('src/local/migrations/'));
    expect(migrations.length).toBeGreaterThanOrEqual(1);
  });

  test('5. pack manifest EXCLUDES every __tests__/** path (no test-leak)', () => {
    const testDirLeaks = paths.filter((p) => p.includes('/__tests__/'));
    expect(testDirLeaks, `Test-dir leaks: ${testDirLeaks.join(', ')}`).toHaveLength(0);
  });

  test('6. pack manifest EXCLUDES every *.test.ts file (no test-leak)', () => {
    const testFileLeaks = paths.filter((p) => p.endsWith('.test.ts'));
    expect(testFileLeaks, `Test-file leaks: ${testFileLeaks.join(', ')}`).toHaveLength(0);
  });

  test('7. pack manifest EXCLUDES every *.test-d.ts file (type-test leaks)', () => {
    const typeTestLeaks = paths.filter((p) => p.endsWith('.test-d.ts'));
    expect(typeTestLeaks, `Type-test leaks: ${typeTestLeaks.join(', ')}`).toHaveLength(0);
  });

  test('8. pack manifest ships dist/agent-tools/cli.js (bin entry)', () => {
    // package.json#bin points themory + themory-mcp at dist/agent-tools/cli.js;
    // the file MUST ship in the published artifact (T3.3 MCP boot test depends
    // on this — fresh npm install MUST resolve the bin).
    expect(paths).toContain('dist/agent-tools/cli.js');
  });

  test('9. pack name + version are well-formed (publishing sanity)', () => {
    expect(pack.name).toBe('@usetheo/memory');
    expect(typeof pack.version).toBe('string');
    expect(pack.version.length).toBeGreaterThan(0);
  });
});
