/**
 * `npm pack --dry-run --json` manifest verification for the publishable package
 * `@usetheo/memory` (= `packages/core`, the only non-private workspace package).
 *
 * Asserts the published artifact shape matches `packages/core/package.json#files`
 * (ADR D1-a src-only, owner decision 2026-06-15): every `src` `.ts` entry ships,
 * every migrations `.sql` ships, package.json ships, AND zero `__tests__` /
 * `*.test.ts` / `*.test-d.ts` entries leak.
 *
 * Bin note (ADR D2-a, owner decision 2026-06-15): the published `@usetheo/memory`
 * is a LIBRARY and ships NO standalone bin in the pre-release src-only stage — the
 * `themory` CLI is delivered via the Docker image (which carries the built dist),
 * not via `npx @usetheo/memory`. So there is no bin-entry assertion here (revisit at
 * v1.0 if compiled artifacts + an npm bin are shipped).
 *
 * Runs `npm pack` with `cwd = packages/core`, so tarball paths are package-relative.
 *
 * EC-12: tolerant `toBeGreaterThanOrEqual(N)` assertions so npm version drift does
 * not false-fail.
 *
 * @see .claude/knowledge-base/plans/complete-workspace-publish-topology-plan.md § T1 + ADR D1/D2
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'core');
const NPM_BIN = '<HOME>/.nvm/versions/node/v20.19.2/bin/npm';
const NPM = existsSync(NPM_BIN) ? NPM_BIN : 'npm';

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
  const result = spawnSync(NPM, ['pack', '--dry-run', '--json'], {
    cwd: PACKAGE_DIR,
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

describe('npm pack --dry-run manifest (@usetheo/memory = packages/core, src-only)', () => {
  const pack = runPackDryRun();
  const paths = pack.files.map((f) => f.path);

  test('1. pack manifest emits >= 100 file entries (tolerant per EC-12)', () => {
    expect(pack.entryCount).toBeGreaterThanOrEqual(100);
    expect(pack.files.length).toBeGreaterThanOrEqual(100);
  });

  test('2. pack manifest ships package.json (publish hygiene)', () => {
    expect(paths).toContain('package.json');
  });

  test('3. pack manifest ships >= 100 src/**/*.ts entries (package-relative)', () => {
    const srcTs = paths.filter((p) => p.startsWith('src/') && p.endsWith('.ts'));
    expect(srcTs.length).toBeGreaterThanOrEqual(100);
  });

  test('4. pack manifest ships EVERY migrations *.sql file (behavioral floor)', () => {
    const migrationsDir = join(PACKAGE_DIR, 'src', 'infrastructure', 'db', 'migrations');
    const expectedSql = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(expectedSql.length, 'sanity — at least one .sql file in source migrations dir').toBeGreaterThan(0);
    for (const sqlFile of expectedSql) {
      expect(paths).toContain(`src/infrastructure/db/migrations/${sqlFile}`);
    }
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

  test('8. pack name is the publishable package + version well-formed', () => {
    expect(pack.name).toBe('@usetheo/memory');
    expect(typeof pack.version).toBe('string');
    expect(pack.version.length).toBeGreaterThan(0);
  });
});
