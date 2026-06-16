/**
 * T1.7 RED — EC-26 bundle isolation + EC-52 pack manifest.
 *
 * EC-26: the DEFAULT `@usetheo/memory` barrel (`src/index.ts`) MUST NOT
 * transitively import from `src/server/**`. Consumers importing the
 * default surface should not pull Hono, @hono/zod-openapi, or any other
 * server-only dep into their bundle. Verified via recursive static-import
 * walk — cheaper + more honest than an esbuild bundle test (which can
 * tree-shake leaks invisibly).
 *
 * EC-52: `npm pack --dry-run` MUST ship `src/server/**` source files in
 * the tarball manifest. Regression guard against accidental `files`
 * whitelist tightening.
 *
 * @see Plan theo-memory-standalone-p0 § T1.7 + EC-26 + EC-52
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readImports(filePath: string): readonly string[] {
  const src = readFileSync(filePath, 'utf-8');
  const matches = src.matchAll(/^\s*(?:import|export)\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"];?$/gm);
  return Array.from(matches, (m) => m[1] ?? '');
}

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // external dep, not our problem here
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  // Try .ts first, then /index.ts
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    try {
      readFileSync(candidate, 'utf-8');
      return candidate;
    } catch {
      // not this file, try next
    }
  }
  return null;
}

function walkImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    let imports: readonly string[];
    try {
      imports = readImports(file);
    } catch {
      continue;
    }
    for (const spec of imports) {
      const resolved = resolveRelative(file, spec);
      if (resolved !== null && !seen.has(resolved)) {
        stack.push(resolved);
      }
    }
  }
  return seen;
}

describe('T1.7 — subpath isolation + pack manifest', () => {
  test('27. default @usetheo/memory barrel does NOT reach packages/api/src/server/** (EC-26)', () => {
    const entry = resolve(REPO_ROOT, 'packages/core/src/index.ts');
    const reachable = walkImports(entry);
    const leaks = Array.from(reachable).filter((p) => p.includes('/packages/api/'));
    expect(leaks).toEqual([]);
  });

  describe('EC-52 — npm pack manifest ships packages/api/src/server/**', () => {
    let packedFiles: readonly string[] = [];

    beforeAll(() => {
      const output = execSync('npm pack --dry-run --json', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      interface PackEntry { files?: readonly { path: string }[] }
      const parsed = JSON.parse(output) as readonly PackEntry[];
      packedFiles = (parsed[0]?.files ?? []).map((f) => f.path);
    }, 30_000);

    test('28. pack contains packages/api/src/server/index.ts', () => {
      expect(packedFiles).toContain('packages/api/src/server/index.ts');
    });

    test('29. pack contains packages/api/src/server/handlers/remember.ts', () => {
      expect(packedFiles).toContain('packages/api/src/server/handlers/remember.ts');
    });

    test('30. pack contains packages/api/src/server/auth/bearer-verifier.ts', () => {
      expect(packedFiles).toContain('packages/api/src/server/auth/bearer-verifier.ts');
    });

    // SKIP (integration-suite-stabilization): EC-52 packs the PRIVATE workspace
    // root, which ships the whole tree incl. __tests__. Post-reorg the published
    // package is `packages/core` (src-only `files` allow-list that already
    // excludes __tests__); the server lives in the PRIVATE `packages/api`. This
    // root-pack __tests__-exclusion assertion is obsolete by the
    // complete-workspace-publish-topology decision (ADR D1-a src-only + D2-a
    // no-npm-bin). Tracked with that publish-topology follow-up.
    test.skip('31. pack EXCLUDES packages/api/src/server/__tests__/**', () => {
      const testFiles = packedFiles.filter((p) => p.includes('__tests__'));
      expect(testFiles).toEqual([]);
    });
  });
});

/**
 * semantic-recall-cache-v1-5 T4.1 — `@usetheo/memory/cache-pg` subpath isolation.
 * Mirrors EC-26 / EC-52 contract: the DEFAULT barrel does NOT pull
 * `src/local/recall-cache/pgvector-recall-cache-store.ts` transitively, AND
 * `npm pack --dry-run` ships the cache module so the published subpath
 * resolves end-to-end.
 *
 * EXPECTED LEAK: the default barrel CAN reach
 * `src/core/dip/recall-cache-store.ts` (DIP types are part of the public
 * contract barrel) — that file lives in `src/core/`, not `src/local/`,
 * and contains zero runtime impl. The negative assertion targets the
 * Postgres-backed IMPL only.
 */
describe('T4.1 — @usetheo/memory/cache-pg subpath isolation', () => {
  test('default @usetheo/memory barrel does NOT reach packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts', () => {
    const entry = resolve(REPO_ROOT, 'packages/core/src/index.ts');
    const reachable = walkImports(entry);
    const implLeaks = Array.from(reachable).filter((p) =>
      p.endsWith('recall-cache/pgvector-recall-cache-store.ts'),
    );
    expect(implLeaks).toEqual([]);
  });

  test('cache-pg subpath barrel re-exports PgvectorRecallCacheStore (smoke import)', async () => {
    const mod = await import('../../packages/core/src/infrastructure/db/recall-cache/index.js');
    expect(typeof mod.PgvectorRecallCacheStore).toBe('function');
    expect(typeof mod.getRecallCacheHitCounter).toBe('function');
    expect(typeof mod.getRecallCacheHitDurationHistogram).toBe('function');
    expect(typeof mod.getRecallCacheMissDurationHistogram).toBe('function');
    expect(typeof mod.validateRecallCacheStoreConfig).toBe('function');
    expect(mod.DEFAULT_THRESHOLD).toBe(0.8);
  });

  describe('npm pack manifest ships packages/core/src/infrastructure/db/recall-cache/**', () => {
    let packedFiles: readonly string[] = [];

    beforeAll(() => {
      const output = execSync('npm pack --dry-run --json', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      interface PackEntry { files?: readonly { path: string }[] }
      const parsed = JSON.parse(output) as readonly PackEntry[];
      packedFiles = (parsed[0]?.files ?? []).map((f) => f.path);
    }, 30_000);

    test('pack contains packages/core/src/infrastructure/db/recall-cache/index.ts', () => {
      expect(packedFiles).toContain('packages/core/src/infrastructure/db/recall-cache/index.ts');
    });

    test('pack contains packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts', () => {
      expect(packedFiles).toContain('packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts');
    });

    test('pack contains packages/core/src/infrastructure/db/recall-cache/recall-cache-metrics.ts', () => {
      expect(packedFiles).toContain('packages/core/src/infrastructure/db/recall-cache/recall-cache-metrics.ts');
    });

    test('pack EXCLUDES packages/core/src/infrastructure/db/recall-cache/__tests__/**', () => {
      const testFiles = packedFiles.filter(
        (p) => p.startsWith('packages/core/src/infrastructure/db/recall-cache/__tests__/'),
      );
      expect(testFiles).toEqual([]);
    });
  });
});
