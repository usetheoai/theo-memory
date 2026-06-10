/**
 * T1.1 RED tests — BearerAuthVerifier impl + Hono bearer middleware.
 *
 * Absorbs EC-1 (empty/whitespace THEMEMORY_API_KEY ⇒ fail-closed),
 * EC-2 (case-insensitive `Bearer` scheme per RFC 6750), EC-3 (token compared
 * verbatim, no trim), EC-4 (length-check BEFORE `crypto.timingSafeEqual` to
 * prevent RangeError), EC-5 (env var save/restore between tests via
 * `vi.stubEnv` / `vi.unstubAllEnvs`).
 *
 * @see Plan theo-memory-standalone-p0 § ADR D3 amended (2026-06-03)
 * @see Plan theo-memory-standalone-p0 § T1.1 TDD section (13 RED tests + EC-5)
 * @see SEPA pre-RED iter 2 — RED test #4 spies on `crypto.timingSafeEqual`;
 *      RED test #12 asserts downstream handler reached + auth header unread.
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AuthVerifier } from '@usetheo/memory/contract';
import { BearerAuthVerifier, readApiKey } from '../bearer-verifier.js';
import { bearerAuth } from '../middleware.js';

const ORIGINAL_ENV_VALUE = process.env['THEMEMORY_API_KEY'];

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  // EC-5 guard: confirm env restored to the value the suite started with.
  expect(process.env['THEMEMORY_API_KEY']).toBe(ORIGINAL_ENV_VALUE);
});

describe('BearerAuthVerifier — implements AuthVerifier DIP', () => {
  test('1. verify returns true for matching token', async () => {
    const v = new BearerAuthVerifier('sk-secret-token');
    await expect(v.verify('sk-secret-token')).resolves.toBe(true);
  });

  test('2. verify returns false for non-matching token (same length)', async () => {
    const v = new BearerAuthVerifier('sk-secret-token');
    await expect(v.verify('sk-other-tokenX')).resolves.toBe(false);
  });

  test('3. verify returns false for length-mismatch WITHOUT throwing (EC-4)', async () => {
    const v = new BearerAuthVerifier('sk-secret-token');
    await expect(v.verify('a')).resolves.toBe(false);
    await expect(v.verify('')).resolves.toBe(false);
    await expect(v.verify('much-longer-than-expected-token-value')).resolves.toBe(false);
  });

  test('4. verify tolerates extreme length-mismatch without throwing (EC-4 behavior contract)', async () => {
    // EC-4 invariant: length-check MUST happen BEFORE crypto.timingSafeEqual,
    // because timingSafeEqual throws RangeError on different-length Buffer
    // inputs. ESM forbids spying on the named export (vi.spyOn fails on
    // module namespace), so EC-4 is enforced via behavior: a 10000-char-long
    // input against a 5-char expected token MUST resolve cleanly to false.
    // If the length-check guard were missing, timingSafeEqual would throw
    // synchronously inside the await and the test would fail with RangeError.
    const v = new BearerAuthVerifier('short');
    await expect(v.verify('a'.repeat(10_000))).resolves.toBe(false);
    await expect(v.verify('')).resolves.toBe(false);
  });

  test('5. BearerAuthVerifier implements the AuthVerifier interface', () => {
    const v: AuthVerifier = new BearerAuthVerifier('x');
    expect(typeof v.verify).toBe('function');
  });
});

describe('readApiKey — env var sentinel resolution (EC-1)', () => {
  test('6. returns undefined when THEMEMORY_API_KEY unset (auth disabled)', () => {
    vi.stubEnv('THEMEMORY_API_KEY', undefined);
    expect(readApiKey()).toBeUndefined();
  });

  test('7. returns empty-string sentinel when env value is empty (fail-closed, EC-1)', () => {
    vi.stubEnv('THEMEMORY_API_KEY', '');
    expect(readApiKey()).toBe('');
  });

  test('8. returns empty-string sentinel when env value is whitespace-only (fail-closed, EC-1)', () => {
    vi.stubEnv('THEMEMORY_API_KEY', '   \t  ');
    expect(readApiKey()).toBe('');
  });

  test('9. returns the raw value when env is a non-empty token', () => {
    vi.stubEnv('THEMEMORY_API_KEY', 'sk-secret');
    expect(readApiKey()).toBe('sk-secret');
  });
});

describe('bearerAuth middleware — Hono middleware factory', () => {
  test('10. passthrough when env unset; downstream handler reached; Authorization header NOT consumed', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', undefined);
    let downstreamReached = false;
    let observedAuthHeader: string | null | undefined;
    const app = new Hono();
    app.use('*', bearerAuth());
    app.get('/probe', (c) => {
      downstreamReached = true;
      observedAuthHeader = c.req.header('authorization');
      return c.text('ok');
    });
    const res = await app.fetch(
      new Request('http://localhost/probe', {
        headers: { Authorization: 'Bearer should-not-be-checked' },
      }),
    );
    expect(res.status).toBe(200);
    expect(downstreamReached).toBe(true);
    expect(observedAuthHeader).toBe('Bearer should-not-be-checked');
  });

  test('11. fail-closed when env empty (EC-1) — any request returns 401 with WWW-Authenticate: Bearer', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', '');
    const app = new Hono();
    app.use('*', bearerAuth());
    app.get('/probe', (c) => c.text('ok'));
    const res = await app.fetch(
      new Request('http://localhost/probe', {
        headers: { Authorization: 'Bearer anything' },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  test('12. accepts Authorization: bearer xyz (lowercase prefix per RFC 6750 EC-2)', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', 'sk-secret');
    const app = new Hono();
    app.use('*', bearerAuth());
    app.get('/probe', (c) => c.text('ok'));
    const res = await app.fetch(
      new Request('http://localhost/probe', { headers: { Authorization: 'bearer sk-secret' } }),
    );
    expect(res.status).toBe(200);
  });

  test('13. accepts Authorization: BEARER xyz (uppercase prefix EC-2)', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', 'sk-secret');
    const app = new Hono();
    app.use('*', bearerAuth());
    app.get('/probe', (c) => c.text('ok'));
    const res = await app.fetch(
      new Request('http://localhost/probe', { headers: { Authorization: 'BEARER sk-secret' } }),
    );
    expect(res.status).toBe(200);
  });

  test('14. verbatim compare — no trim applied (EC-3)', async () => {
    // EC-3 invariant: BearerAuthVerifier compares tokens VERBATIM. HTTP-layer
    // header normalization (RFC 7230 OWS strip) is OUTSIDE the verifier's
    // contract; we assert the verifier itself does not silently trim. Operator
    // is responsible for clean env values per ADR D3 amended.
    const v = new BearerAuthVerifier(' sk-secret ');
    await expect(v.verify(' sk-secret ')).resolves.toBe(true); // verbatim match
    await expect(v.verify('sk-secret')).resolves.toBe(false); // length-mismatch via missing whitespace
  });

  test('15. returns 401 with www-authenticate: Bearer when token missing', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', 'sk-secret');
    const app = new Hono();
    app.use('*', bearerAuth());
    app.get('/probe', (c) => c.text('ok'));
    const res = await app.fetch(new Request('http://localhost/probe'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  test('16. accepts request with matching bearer token (positive path through middleware)', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', 'sk-secret-token');
    const app = new Hono();
    app.use('*', bearerAuth());
    app.get('/probe', (c) => c.text('authenticated'));
    const res = await app.fetch(
      new Request('http://localhost/probe', {
        headers: { Authorization: 'Bearer sk-secret-token' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('authenticated');
  });
});
