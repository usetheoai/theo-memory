/**
 * T0.1 sentinel — Camada 3 OIDC bridge dependencies present per ADR D4 of
 * `theo-memory-faang-auth-lifecycle-plan.md`.
 *
 * Camada 3 (OidcAuthVerifier + dualValidationAuth middleware) requires:
 *   - `jose` — JWKS primitives (createRemoteJWKSet + jwtVerify with explicit `alg` allowlist)
 *   - `oauth4webapi` — RFC 7662 introspection client (processIntrospectionResponse)
 *
 * Both are zero-dep + tree-shakeable + maintained by panva (canonical author
 * in the OIDC ecosystem). Per blueprint Q5 Rule-9 evaluation.
 *
 * Sentinel guards against accidental removal during package.json edits in
 * unrelated cycles.
 *
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = resolve(HERE, '..', '..', '..', 'package.json');

interface PackageJson {
  readonly dependencies: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as PackageJson;
}

describe('T0.1 sentinel — Camada 3 auth deps present', () => {
  test('jose is declared at major 5 or 6 (panva JWKS/JWT primitives)', () => {
    const pkg = readPackageJson();
    // Accept ^5 OR ^6 — both are CVE-clean; blueprint Q5 wrote ^5 but
    // deps-audit recommended bump to ^6 (latest is 6.2.3 per npm view).
    expect(pkg.dependencies['jose']).toMatch(/^\^[56]\./);
  });

  test('oauth4webapi is declared at major 3 (panva OIDC client)', () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies['oauth4webapi']).toMatch(/^\^3\./);
  });
});
