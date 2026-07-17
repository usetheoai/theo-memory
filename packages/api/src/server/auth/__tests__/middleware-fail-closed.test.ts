/**
 * Unit tests — Model B slice 1 / T2.1: fail-closed multi-tenant mode.
 *
 * `bearerAuth(verifier, { requireCredential })` + `parseRequireCredentialEnv`:
 *   - requireCredential + no verifier configured → 401 (NOT DEFAULT_PRINCIPAL)
 *   - requireCredential + verify-only verifier → 401 (no DEFAULT_PRINCIPAL shim)
 *   - env parsing: only "true"/"1" enable (EC-4)
 *   - flag off → DEFAULT_PRINCIPAL fallback preserved (single-tenant regression)
 *
 */
import type { AuthVerifier } from '@usetheo/memory/contract';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { bearerAuth, parseRequireCredentialEnv } from '../middleware.js';

const ORIG = process.env['THEMEMORY_API_KEY'];
beforeEach(() => {
  delete process.env['THEMEMORY_API_KEY'];
});
afterEach(() => {
  if (ORIG === undefined) delete process.env['THEMEMORY_API_KEY'];
  else process.env['THEMEMORY_API_KEY'] = ORIG;
});

function appWith(mw: ReturnType<typeof bearerAuth>): Hono {
  const a = new Hono();
  a.use('*', mw);
  a.get('/x', (c) => c.json({ ok: true }, 200));
  return a;
}

describe('bearerAuth — fail-closed multi-tenant mode (T2.1)', () => {
  test('requireCredential + no verifier configured → 401 (not DEFAULT_PRINCIPAL)', async () => {
    const res = await appWith(bearerAuth(undefined, { requireCredential: true })).request('/x');
    expect(res.status).toBe(401);
  });

  test('flag OFF + no verifier → passes through with DEFAULT_PRINCIPAL (regression)', async () => {
    const res = await appWith(bearerAuth(undefined)).request('/x');
    expect(res.status).toBe(200);
  });

  test('requireCredential + verify-only verifier → 401 (no shim to DEFAULT_PRINCIPAL)', async () => {
    const verifyOnly: AuthVerifier = { verify: () => Promise.resolve(true) };
    const res = await appWith(bearerAuth(verifyOnly, { requireCredential: true })).request('/x', {
      headers: { authorization: 'Bearer some-token' },
    });
    expect(res.status).toBe(401);
  });

  test('flag OFF + verify-only verifier (valid) → 200 via DEFAULT_PRINCIPAL shim (regression)', async () => {
    const verifyOnly: AuthVerifier = { verify: () => Promise.resolve(true) };
    const res = await appWith(bearerAuth(verifyOnly)).request('/x', {
      headers: { authorization: 'Bearer some-token' },
    });
    expect(res.status).toBe(200);
  });
});

describe('parseRequireCredentialEnv — truthiness (EC-4)', () => {
  test('"true" and "1" enable', () => {
    expect(parseRequireCredentialEnv('true')).toBe(true);
    expect(parseRequireCredentialEnv('1')).toBe(true);
    expect(parseRequireCredentialEnv('TRUE')).toBe(true);
  });
  test('falsey / empty / whitespace / undefined → false', () => {
    expect(parseRequireCredentialEnv('false')).toBe(false);
    expect(parseRequireCredentialEnv('0')).toBe(false);
    expect(parseRequireCredentialEnv('')).toBe(false);
    expect(parseRequireCredentialEnv('   ')).toBe(false);
    expect(parseRequireCredentialEnv(undefined)).toBe(false);
  });
});
