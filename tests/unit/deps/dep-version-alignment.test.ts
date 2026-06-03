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
  test('hono pinned at ^4.6 (dependencies)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies['hono']).toMatch(/^\^4\.[6-9]\.|^\^4\.[1-9][0-9]\./);
  });

  test('@hono/node-server pinned at ^1.13 (dependencies; v2 deferred per ADR D14)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies['@hono/node-server']).toMatch(/^\^1\.(1[3-9]|[2-9][0-9])\./);
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
  test('hono major ^4 + @hono/node-server major ^1 + @hono/zod-openapi major ^0 known-compatible', () => {
    const pkg = readPackageJson();
    // Per plan ADR D1: aligned at "hono ^4.6 + @hono/zod-openapi ^0.18 + @hono/node-server ^1.13"
    // confirmed via vendor docs (see SEPA paired knowledge skill WebSearch on 2026-06-03).
    // If any of these majors drift, the smoke fails and forces an ADR amendment.
    expect(pkg.dependencies['hono']?.startsWith('^4.')).toBe(true);
    expect(pkg.dependencies['@hono/node-server']?.startsWith('^1.')).toBe(true);
    expect(pkg.dependencies['@hono/zod-openapi']?.startsWith('^0.')).toBe(true);
  });
});
