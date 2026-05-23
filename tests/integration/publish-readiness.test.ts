/**
 * Publish-readiness gate — T2.3 of plan v0-2-theokit-binding (v1.1).
 *
 * Per ADR D8: removing `"private": true` from package.json is gated by a
 * tarball-shape + dry-run check that runs both locally and from any future CI.
 * The script lives at `package.json#scripts.publish:check` (no `.github/workflows/`
 * yet — KISS, see iteration-6 SEPA brief).
 *
 * 3 tests:
 * 1. package.json is publishable shape (no `private` key; `files` allow-list intact)
 * 2. `npm run publish:check` exits 0 (the script body runs npm pack/publish in dry-run)
 * 3. Packed tarball excludes test artifacts (regression guard for the `files` exclusions)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const NPM_BIN = '/home/paulo/.nvm/versions/node/v20.19.2/bin/npm';

interface PackageJsonShape {
  private?: boolean;
  files?: string[];
  scripts?: Record<string, string>;
}

function readPackageJson(): PackageJsonShape {
  const raw = readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8');
  return JSON.parse(raw) as PackageJsonShape;
}

describe('package.json — publishable shape (ADR D8)', () => {
  test('does NOT declare "private": true (publish gate removed)', () => {
    const pkg = readPackageJson();
    // private absent OR explicitly false; both are publishable per npm spec
    expect(pkg.private === undefined || pkg.private === false).toBe(true);
  });

  test('files allow-list includes src/**/*.ts + migrations AND excludes test artifacts', () => {
    const pkg = readPackageJson();
    expect(pkg.files).toBeDefined();
    const files = pkg.files ?? [];
    expect(files).toContain('src/**/*.ts');
    expect(files).toContain('src/local/migrations/**');
    // Negation patterns guarantee tests are NOT packed
    expect(files).toContain('!src/**/__tests__/**');
    expect(files).toContain('!src/**/*.test.ts');
    expect(files).toContain('!src/**/*.test-d.ts');
  });

  test('declares a publish:check script (the gate)', () => {
    const pkg = readPackageJson();
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts?.['publish:check']).toBeDefined();
    expect(pkg.scripts?.['publish:check']).toMatch(/--dry-run/);
  });
});

describe('publish-readiness — gate executable', () => {
  test('npm run publish:check exits 0 (tarball shape valid for registry)', () => {
    // The script body runs the registry-dry-run check. We don't capture output
    // — exit 0 is the contract. execFileSync throws on non-zero exit.
    const result = execFileSync(NPM_BIN, ['run', 'publish:check'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result).toBeDefined();
  }, 30_000);

  test('packed tarball excludes __tests__, *.test.ts, *.test-d.ts artifacts', () => {
    // `npm pack --dry-run --json` returns array of would-be-packed file entries.
    const output = execFileSync(NPM_BIN, ['pack', '--dry-run', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    expect(parsed).toBeDefined();
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    const allPaths = parsed.flatMap((entry) => entry.files.map((f) => f.path));
    const forbidden = allPaths.filter(
      (p) => p.includes('__tests__') || /\.test(-d)?\.ts$/.test(p),
    );
    expect(forbidden).toEqual([]);
  }, 30_000);
});
