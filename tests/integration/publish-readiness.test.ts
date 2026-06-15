/**
 * Publish-readiness gate for the publishable package `@usetheo/memory`.
 *
 * After the workspace reorg (`standardize-project-structure` + `extract-cli-to-packages`)
 * the publishable surface is `packages/core` (`@usetheo/memory`) — the ONLY non-private
 * workspace package. The root `theo-memory-workspace` is a PRIVATE workspace root and is
 * NOT the publish target. This gate therefore targets `packages/core/package.json` and runs
 * `npm pack` with `cwd = packages/core` (tarball paths are package-relative).
 *
 * Publish model (ADR D1 of `complete-workspace-publish-topology`, owner decision 2026-06-15):
 * **src-only** for the pre-release stage — the package ships its TypeScript source under
 * `src/` + SQL migrations, excludes test artifacts; exports resolve to the `src/` tree.
 *
 * 7 assertions:
 *   1. publishable package is NOT `private`.
 *   2. `files` allow-list is EXACTLY the src-only set (exact-match, not loose `.some(includes)` —
 *      restores the rigor lost in the test migration, review F-tests-2).
 *   3. declares a `publish:check` script (the gate).
 *   4. `npm run publish:check` (in packages/core) exits 0.
 *   5. packed tarball EXCLUDES __tests__ / *.test.ts / *.test-d.ts.
 *   6. packed tarball POSITIVELY INCLUDES the embedders/llms stub source by name.
 *   7. packed tarball POSITIVELY INCLUDES every source file backing a declared `exports` entry.
 *
 * @see .claude/knowledge-base/plans/complete-workspace-publish-topology-plan.md § ADR D1 + T1
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const PACKAGE_DIR = resolve(REPO_ROOT, 'packages', 'core');
const NPM_BIN = '/home/paulo/.nvm/versions/node/v20.19.2/bin/npm';
const HAS_NPM = existsSync(NPM_BIN);

interface PackageJsonShape {
  private?: boolean;
  files?: string[];
  scripts?: Record<string, string>;
  exports?: Record<string, { default?: string; types?: string }>;
}

function readPackageJson(): PackageJsonShape {
  return JSON.parse(readFileSync(resolve(PACKAGE_DIR, 'package.json'), 'utf-8')) as PackageJsonShape;
}

/** Run `npm pack --dry-run --json` in the publishable package and return the packed file paths. */
function packedPaths(): Set<string> {
  const output = execFileSync(NPM_BIN, ['pack', '--dry-run', '--json'], {
    cwd: PACKAGE_DIR,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
  return new Set(parsed.flatMap((entry) => entry.files.map((f) => f.path)));
}

describe('package.json — publishable shape (@usetheo/memory = packages/core)', () => {
  test('the publishable package is NOT marked private', () => {
    const pkg = readPackageJson();
    expect(pkg.private === undefined || pkg.private === false).toBe(true);
  });

  test('files allow-list is EXACTLY the src-only set (ADR D1-a)', () => {
    const pkg = readPackageJson();
    expect(pkg.files).toEqual([
      'src/**/*.ts',
      '!src/**/__tests__/**',
      '!src/**/*.test.ts',
      '!src/**/*.test-d.ts',
      'src/infrastructure/db/migrations/**',
    ]);
  });

  test('declares a publish:check script (the gate)', () => {
    const pkg = readPackageJson();
    expect(pkg.scripts?.['publish:check']).toBeDefined();
    expect(pkg.scripts?.['publish:check']).toMatch(/--dry-run/);
  });
});

describe('publish-readiness — gate executable (cwd = packages/core)', () => {
  test.skipIf(!HAS_NPM)('npm run publish:check exits 0 (tarball shape valid for registry)', () => {
    const result = execFileSync(NPM_BIN, ['run', 'publish:check'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result).toBeDefined();
  }, 30_000);

  test.skipIf(!HAS_NPM)('packed tarball EXCLUDES __tests__, *.test.ts, *.test-d.ts artifacts', () => {
    const allPaths = [...packedPaths()];
    const forbidden = allPaths.filter((p) => p.includes('__tests__') || /\.test(-d)?\.ts$/.test(p));
    expect(forbidden).toEqual([]);
  }, 30_000);

  test.skipIf(!HAS_NPM)('tarball POSITIVELY INCLUDES embedders/llms stub + index source by name', () => {
    const paths = packedPaths();
    // package-relative paths (npm pack runs in packages/core)
    expect(paths.has('src/infrastructure/embedders/stub.ts')).toBe(true);
    expect(paths.has('src/infrastructure/embedders/index.ts')).toBe(true);
    expect(paths.has('src/infrastructure/llms/stub.ts')).toBe(true);
    expect(paths.has('src/infrastructure/llms/index.ts')).toBe(true);
  }, 30_000);

  test.skipIf(!HAS_NPM)('tarball POSITIVELY INCLUDES every source file backing a declared exports entry', () => {
    const pkg = readPackageJson();
    expect(pkg.exports).toBeDefined();
    const paths = packedPaths();
    for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
      const target = conditions.default;
      if (target === undefined) continue;
      const normalized = target.replace(/^\.\//, '');
      expect(paths.has(normalized)).toBe(
        true,
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Exports entry ${subpath} → ${target}: backing source not present in npm pack output`,
      );
    }
  }, 30_000);
});
