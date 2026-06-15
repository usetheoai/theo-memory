/**
 * T3.1 RED tests — `resolveOidcConfig` helper for CLI flag/env normalization.
 *
 * Plan: `theo-memory-faang-auth-lifecycle-fixes-cycle-1` § T3.1 + ADR D4 +
 * EC-2 + EC-5 + EC-6 + EC-9.
 *
 * Extracted from runServer/runMcpServer so the CLI plumb policies have a
 * single source of truth + are unit-testable in isolation. Wired into both
 * runners at T3.2.
 *
 * 8 scenarios:
 *   1. No issuer → returns null (OIDC disabled path; default)
 *   2. EC-5 — invalid issuer URL → throws InvalidArgumentError-shape Error
 *   3. EC-6 — clientId without clientSecret env → throws
 *   4. EC-2 — empty/whitespace THEMORY_OIDC_CLIENT_SECRET → throws (treated as missing)
 *   5. EC-2 — empty/whitespace THEMORY_ADMIN_BOOTSTRAP_TOKEN → normalized to undefined
 *   6. EC-9 — host=0.0.0.0 → oidcDiscovery.resource derived to http://localhost:<port>
 *   7. Valid issuer + client_id + client_secret → returns full config
 *   8. CLI flag overrides env (precedence — flag > env > undefined)
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { resolveOidcConfig, resolveBootstrapToken } from '../oidc-cli-resolver.js';

const ENV_BACKUP: Record<string, string | undefined> = {};
const ENV_KEYS = ['THEMORY_OIDC_ISSUER', 'THEMORY_OIDC_CLIENT_ID', 'THEMORY_OIDC_CLIENT_SECRET', 'THEMORY_ADMIN_BOOTSTRAP_TOKEN'];

beforeEach(() => {
  for (const k of ENV_KEYS) ENV_BACKUP[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ENV_BACKUP[k] === undefined) delete process.env[k];
    else process.env[k] = ENV_BACKUP[k];
  }
});

describe('T3.1 — resolveOidcConfig (CLI + env normalization)', () => {
  test('1. no issuer (flag + env both unset) → returns null', () => {
    delete process.env['THEMORY_OIDC_ISSUER'];
    expect(resolveOidcConfig({ host: '127.0.0.1', port: 8080 })).toBeNull();
  });

  test('2. EC-5 — invalid issuer URL → throws with friendly message naming --issuer', () => {
    expect(() =>
      resolveOidcConfig({ issuer: 'not-a-url', host: '127.0.0.1', port: 8080 }),
    ).toThrow(/--issuer.*valid URL/i);
  });

  test('3. EC-6 — clientId supplied but THEMORY_OIDC_CLIENT_SECRET unset → throws', () => {
    delete process.env['THEMORY_OIDC_CLIENT_SECRET'];
    expect(() =>
      resolveOidcConfig({
        issuer: 'https://auth.example.com',
        clientId: 'my-client',
        host: '127.0.0.1',
        port: 8080,
      }),
    ).toThrow(/THEMORY_OIDC_CLIENT_SECRET/i);
  });

  test('4. EC-2 — empty/whitespace THEMORY_OIDC_CLIENT_SECRET → treated as missing → throws', () => {
    process.env['THEMORY_OIDC_CLIENT_SECRET'] = '   ';
    expect(() =>
      resolveOidcConfig({
        issuer: 'https://auth.example.com',
        clientId: 'my-client',
        host: '127.0.0.1',
        port: 8080,
      }),
    ).toThrow(/THEMORY_OIDC_CLIENT_SECRET/i);
  });

  test('5. EC-2 — empty/whitespace THEMORY_ADMIN_BOOTSTRAP_TOKEN → resolveBootstrapToken returns undefined (no bypass)', () => {
    process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN'] = '   ';
    expect(resolveBootstrapToken()).toBeUndefined();
    process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN'] = '';
    expect(resolveBootstrapToken()).toBeUndefined();
    delete process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN'];
    expect(resolveBootstrapToken()).toBeUndefined();
    // Sanity: valid non-empty value passes through TRIMMED (F-dom-cli-8 fix)
    process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN'] = 'valid-token-' + 'x'.repeat(32);
    expect(resolveBootstrapToken()).toBe('valid-token-' + 'x'.repeat(32));
    // F-dom-cli-8: surrounding whitespace MUST be stripped at source
    process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN'] = '   actual-secret   ';
    expect(resolveBootstrapToken()).toBe('actual-secret');
  });

  test('6. EC-9 — host=0.0.0.0 → oidcDiscovery.resource uses localhost canonical (NOT 0.0.0.0)', () => {
    process.env['THEMORY_OIDC_CLIENT_SECRET'] = 'secret-for-test';
    const cfg = resolveOidcConfig({
      issuer: 'https://auth.example.com',
      clientId: 'my-client',
      host: '0.0.0.0',
      port: 8080,
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.oidcDiscovery.resource).toBe('http://localhost:8080');
    // Sanity: 127.0.0.1 keeps its host
    const cfg2 = resolveOidcConfig({
      issuer: 'https://auth.example.com',
      clientId: 'my-client',
      host: '127.0.0.1',
      port: 8080,
    });
    expect(cfg2!.oidcDiscovery.resource).toBe('http://127.0.0.1:8080');
  });

  test('7. valid issuer + clientId + clientSecret env → returns full config with all four canonical scopes', () => {
    process.env['THEMORY_OIDC_CLIENT_SECRET'] = 'super-secret';
    const cfg = resolveOidcConfig({
      issuer: 'https://auth.example.com',
      clientId: 'my-client',
      host: '127.0.0.1',
      port: 8080,
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.issuer).toBe('https://auth.example.com');
    expect(cfg!.clientId).toBe('my-client');
    expect(cfg!.clientSecret).toBe('super-secret');
    expect(cfg!.oidcDiscovery.issuer).toBe('https://auth.example.com');
    expect(cfg!.oidcDiscovery.scopesSupported).toEqual([
      'memory:read',
      'memory:write',
      'memory:delete',
      'memory:admin',
    ]);
  });

  test('8. CLI flag overrides env (precedence — flag > env > undefined)', () => {
    process.env['THEMORY_OIDC_ISSUER'] = 'https://from-env.example.com';
    process.env['THEMORY_OIDC_CLIENT_ID'] = 'env-client-id';
    process.env['THEMORY_OIDC_CLIENT_SECRET'] = 'env-secret';
    const cfg = resolveOidcConfig({
      issuer: 'https://from-flag.example.com',
      clientId: 'flag-client-id',
      host: '127.0.0.1',
      port: 8080,
    });
    expect(cfg!.issuer).toBe('https://from-flag.example.com');
    expect(cfg!.clientId).toBe('flag-client-id');
    expect(cfg!.clientSecret).toBe('env-secret'); // env-only per ADR D4
  });
});
