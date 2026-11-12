/**
 * Public-path resolution tests for `@usetheo/memory/agent-tools` subpath — T0.2.
 *
 * Mirrors v0.2 PR-A's `public-paths.test.ts` pattern:
 *   (a) subpath resolves and exposes the public symbol
 *   (b) main barrel (`src/index.ts`) does NOT leak agent-tools (ADR D8 bundle isolation)
 *   (c) package.json bin entry declared per ADR D8
 *   (d) optional EC-1 absorption gate: `npm run build` produces `dist/agent-tools/cli.js`
 *
 * @see ADR D8 — package surface (subpath + bin + bundle isolation)
 * @see ADR D1 — transport pre-wire (cli.ts stub deferred to T6.1)
 * @see EC-1 (plan v1.1) — build pipeline verified upfront; bin entry resolves
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
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
  exports?: Record<string, unknown>;
  bin?: Record<string, string>;
}

function readPackageJson(): PackageJsonShape {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8')) as PackageJsonShape;
}

describe('@usetheo/memory-cli — agent-tools package resolution (T0.2)', () => {
  test('CLI package resolves and exposes createMcpServer as a function', async () => {
    // Post-workspace-restructure: agent-tools moved from @usetheo/memory/agent-tools
    // subpath to the standalone @usetheo/memory-cli package.
    const mod = await import('../../../packages/cli/src/index.js');
    // Then: createMcpServer is callable (stub at T0.2; real impl at T1.1)
    expect(typeof (mod as { createMcpServer?: unknown }).createMcpServer).toBe('function');
  });
});

describe('@usetheo/memory — main barrel isolation from agent-tools (ADR D8 tripwire)', () => {
  test('src/index.ts source contains zero agent-tools imports (regex-tightened tripwire)', () => {
    // Per SEPA pre-RED advice: naive .toContain('agent-tools') is too aggressive
    // (would reject JSDoc comments mentioning the subpath). Tighten to actual import shape.
    const source = readFileSync(resolve(REPO_ROOT, 'packages', 'core', 'src', 'index.ts'), 'utf-8');
    expect(source).not.toMatch(/from\s+['"]\.\/agent-tools/);
    expect(source).not.toMatch(/from\s+['"]@usetheo\/memory\/agent-tools/);
  });
});

describe('package.json — agent-tools bin entry (ADR D8)', () => {
  test('bin["themory-mcp"] points to ./dist/agent-tools/cli.js', () => {
    const pkg = readPackageJson();
    expect(pkg.bin?.['themory-mcp']).toBe('./dist/agent-tools/cli.js');
  });
});

// The build block re-runs a full `npm run build` in-test. CI has no
// pnpm-workspace-compatible root `npm run build`; the build is already verified by
// the CI Build step. Skip this block when npm is not on PATH — the three
// describes above still assert the real public-surface invariants.
describe.skipIf(!HAS_NPM)('EC-1 absorption gate — build pipeline emits dist/agent-tools/cli.js', () => {
  test('npm run build emits dist/agent-tools/cli.js (slow — runs tsc full pass)', () => {
    // EC-1 (plan v1.1): build pipeline MUST be verified upfront; bin entry depends on this.
    // SEPA pre-RED MAJOR finding: tsc exit 0 alone is NOT proof — verify the actual file exists.
    execFileSync(NPM_BIN as string, ['run', 'build'], { cwd: REPO_ROOT, stdio: 'pipe', encoding: 'utf-8' });
    expect(existsSync(resolve(REPO_ROOT, 'dist', 'agent-tools', 'cli.js'))).toBe(true);
    // No per-test timeout: the suite's 90 s default applies. The build takes about 11 s alone
    // and about 37 s inside a full suite run, which a 30 s cap turned into a load-dependent failure.
  });
});
