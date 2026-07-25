/**
 * EC-18 absorption — verify the 4 NEW deps declared in plan v1.3 § Dependencies
 * are present in `package.json` at the PINNED major version per ADR D14
 * (sunset 2026-09-01).
 *
 * Runs as a smoke test against the raw `package.json` to catch any drift
 * between the plan and the manifest. If a future cycle bumps a pinned dep
 * without updating ADR D14 (or supersedes ADR D14 via dep-bumps-2026-Q3),
 * this test surfaces the drift.
 *
 * @see Plan theo-memory-standalone-p0 § ADR D14 — 4 deps pinned with sunset
 * @see EC-18 — hono + @hono/node-server + @hono/zod-openapi version alignment
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = resolve(HERE, '..', '..', '..', 'package.json');

interface PackageJson {
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as PackageJson;
}

describe('T0.1 — NEW dep version alignment per ADR D14 (sunset 2026-09-01)', () => {
  test('hono pinned at >=4.11.4 (dependencies; ADR D4 of theo-memory-faang-auth-lifecycle supersedes ADR D14 hono pin per 2026-01-13 CVEs)', () => {
    const pkg = readPackageJson();
    // Pre-CVE shape `^4.6.x` is FORBIDDEN — the new pin shape is `>=4.11.4`
    // OR a caret form whose floor is >= 4.11.4 (e.g., `^4.11.4` / `^4.12.0`).
    // Detailed range parser lives in tests/unit/deps/hono-cve-pin.test.ts;
    // here a regex suffices since the new ADR D4 only accepts these two shapes.
    expect(pkg.dependencies['hono']).toMatch(/^(>=4\.(1[1-9]|[2-9][0-9])\.[4-9]|>=4\.(1[1-9]|[2-9][0-9])\.[1-9][0-9]+|>=4\.(1[2-9]|[2-9][0-9])\.|>=[5-9]\.|\^4\.(1[1-9]|[2-9][0-9])\.[4-9]|\^4\.(1[2-9]|[2-9][0-9])\.)/);
  });

  test('@hono/node-server pinned at ^2.0.5+ (dependencies; M20 #123 CVE upgrade supersedes ADR D14 v2-deferral)', () => {
    const pkg = readPackageJson();
    // M20 (#123): the v2-deferral of ADR D14 is superseded by the path-traversal CVE
    // (patched >=2.0.5). The v1→v2 compat is proven by the REST server integration suite
    // (47/47 vs real pgvector); a drift back to ^1 or up to ^3 requires an ADR amendment.
    expect(pkg.dependencies['@hono/node-server']).toMatch(/^\^2\.(0\.[5-9]|0\.[1-9][0-9]|[1-9])/);
  });

  test('@hono/zod-openapi pinned at ^0.18 (dependencies; 1.x deferred per ADR D14)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies['@hono/zod-openapi']).toMatch(/^\^0\.(1[8-9]|[2-9][0-9])\./);
  });

  test('commander pinned at ^12.1 (dependencies; v15 deferred per ADR D14)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies['commander']).toMatch(/^\^12\.[1-9]\.|^\^12\.1[0-9]\./);
  });

  test('strip-ansi at ^7.1 (devDependencies)', () => {
    const pkg = readPackageJson();
    expect(pkg.devDependencies['strip-ansi']).toMatch(/^\^7\./);
  });

  test('@apidevtools/swagger-parser at ^10.1 (devDependencies; v12 deferred per ADR D14)', () => {
    const pkg = readPackageJson();
    expect(pkg.devDependencies['@apidevtools/swagger-parser']).toMatch(/^\^10\./);
  });
});

describe('EC-18 — hono + @hono adapter major-version compat smoke', () => {
  test('hono major 4 + @hono/node-server major ^2 + @hono/zod-openapi major ^0 known-compatible', () => {
    const pkg = readPackageJson();
    // Per plan ADR D1 of standalone-p0 + ADR D4 of theo-memory-faang-auth-lifecycle:
    // hono pin shape evolved from `^4.6.x` (D14) to `>=4.11.4` (D4 — CVE-driven), then to
    // `>=4.12.27` (M20 #123 — the 3 hono moderate CVEs). node-server moved 1→2 (M20 #123 —
    // path-traversal CVE). The COMPAT smoke pins the MAJORs; drift beyond requires an ADR.
    const honoRange = pkg.dependencies['hono'];
    expect(honoRange).toBeDefined();
    expect(honoRange?.startsWith('^4.') || honoRange?.startsWith('>=4.')).toBe(true);
    expect(pkg.dependencies['@hono/node-server']?.startsWith('^2.')).toBe(true);
    expect(pkg.dependencies['@hono/zod-openapi']?.startsWith('^0.')).toBe(true);
  });
});
