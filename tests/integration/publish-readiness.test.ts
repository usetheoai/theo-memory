/**
 * Publish-readiness gate for the publishable package `@usetheo/memory`.
 *
 * After the workspace reorg (`standardize-project-structure` + `extract-cli-to-packages`)
 * the publishable surface is `packages/core` (`@usetheo/memory`) — the ONLY non-private
 * workspace package. The root `theo-memory-workspace` is a PRIVATE workspace root and is
 * NOT the publish target. This gate therefore targets `packages/core/package.json` and runs
 * `npm pack` with `cwd = packages/core` (tarball paths are package-relative).
 *
 * Publish model (owner decision 2026-06-15 "Shipar dist JS", SUPERSEDES ADR D1-a src-only of
 * `complete-workspace-publish-topology`): the package ships the BUILT `dist/**` (JS + .d.ts +
 * sourcemaps + the copied drizzle migrations) as the runtime entry — `exports`/`types` resolve
 * to `dist`, so Node-SSR consumers (TheoKit/Next/Vite-SSR) can load it (raw .ts is unresolvable
 * once a bundler externalizes the dep). It ALSO keeps `src/**` (+ src migrations) for sourcemap
 * navigation. Test artifacts are excluded.
 *
 * 8 assertions:
 *   1. publishable package is NOT `private`.
 *   2. `files` allow-list is EXACTLY the dist+src shipping set (exact-match, not loose
 *      `.some(includes)` — restores the rigor lost in the test migration, review F-tests-2).
 *   3. declares a `publish:check` script (the gate).
 *   4. `npm run publish:check` (in packages/core) exits 0.
 *   5. packed tarball EXCLUDES __tests__ / *.test.ts / *.test-d.ts.
 *   6. packed tarball POSITIVELY INCLUDES the embedders/llms stub source by name.
 *   7. packed tarball POSITIVELY INCLUDES every dist file backing a declared `exports` entry.
 *   8. packed tarball ships the dist drizzle migrations (meta/_journal.json + >=1 *.sql) so
 *      `runMigrations()` resolves the journal from the published dist (the dist runner reads
 *      `migrations/` next to itself, NOT the src tree). Regression guard for the consumer-DX fix.
 *
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const PACKAGE_DIR = resolve(REPO_ROOT, 'packages', 'core');
// Resolve npm from PATH so this gate runs for every contributor and on CI.
// (It used to point at one developer's nvm install, which silently skipped the
// gate everywhere else.) Undefined when npm is absent -> the block skips.
function resolveNpmBin(): string | undefined {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (dir === '') continue;
    for (const ext of exts) {
      const candidate = resolve(dir, `npm${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const NPM_BIN = resolveNpmBin();
const HAS_NPM = NPM_BIN !== undefined;

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
  const output = execFileSync(NPM_BIN as string, ['pack', '--dry-run', '--json'], {
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

  test('files allow-list is EXACTLY the dist+src shipping set (supersedes ADR D1-a src-only)', () => {
    // Consumer-DX fix: ADR D1-a's src-only allow-list made the published
    // package unresolvable by Node-SSR consumers (TheoKit/Next/Vite-SSR) — the
    // bundler externalizes the dep and Node cannot execute raw .ts. The package
    // now ships the built dist (JS + .d.ts + sourcemaps) as the runtime entry
    // (exports point at dist) AND keeps src (+ migrations) for sourcemap
    // navigation and tooling. Exact-match (not loose .some(includes)) so an
    // accidental files-array edit is caught.
    const pkg = readPackageJson();
    expect(pkg.files).toEqual([
      'dist/**/*.js',
      'dist/**/*.d.ts',
      'dist/**/*.map',
      'dist/**/*.sql',
      'dist/infrastructure/db/migrations/meta/**',
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
    const result = execFileSync(NPM_BIN as string, ['run', 'publish:check'], {
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

  test.skipIf(!HAS_NPM)(
    'tarball ships the dist drizzle migrations (journal + >=1 *.sql) so runMigrations resolves at runtime',
    () => {
      // The dist migrations-runner resolves `migrations/` next to itself
      // (dirname(import.meta.url)/migrations) — i.e. dist/infrastructure/db/
      // migrations/, NOT the src tree. If the journal + SQL are not in the
      // tarball, a published consumer's runMigrations() throws "Can't find
      // meta/_journal.json". Regression guard for the consumer-DX dist-shipping
      // fix (the build copies them; the files allow-list must ship them).
      const paths = [...packedPaths()];
      expect(paths).toContain('dist/infrastructure/db/migrations/meta/_journal.json');
      const distSql = paths.filter((p) => /^dist\/.*\.sql$/.test(p));
      expect(distSql.length).toBeGreaterThanOrEqual(1);
    },
    60_000,
  );
});
