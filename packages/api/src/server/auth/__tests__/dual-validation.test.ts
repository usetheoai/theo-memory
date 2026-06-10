/**
 * T3.1 RED tests — dualValidationAuth middleware.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T3.1 + ADR D1 + EC-1.
 */
/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() spies are closures; passing them to expect.toHaveBeenCalledWith is the canonical vitest pattern */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';

import type { AuthVerifier } from '@usetheo/memory/contract';
import { dualValidationAuth } from '../dual-validation.js';

const VALID_THEO_LIVE = `theo_live_${'a'.repeat(40)}`;
const INVALID_SHAPE_PREFIX = 'theo_live_short'; // prefix matches but shape regex fails
const JWT_LIKE = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';

function alwaysTrue(): AuthVerifier {
  return { verify: vi.fn(() => Promise.resolve(true)) };
}
function alwaysFalse(): AuthVerifier {
  return { verify: vi.fn(() => Promise.resolve(false)) };
}

function buildApp(opts: Parameters<typeof dualValidationAuth>[0]): Hono {
  const app = new Hono();
  app.use('/v1/*', dualValidationAuth(opts));
  app.get('/v1/test', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('dualValidationAuth — routing by prefix-shape', () => {
  test('1. theo_live_ with valid shape → routes to apiKey verifier', async () => {
    const apiKey = alwaysTrue();
    const oidc = alwaysFalse();
    const app = buildApp({ apiKey, oidc });
    const res = await app.request('/v1/test', { headers: { authorization: `Bearer ${VALID_THEO_LIVE}` } });
    expect(res.status).toBe(200);
    expect(apiKey.verify).toHaveBeenCalledWith(VALID_THEO_LIVE);
    expect(oidc.verify).not.toHaveBeenCalled();
  });

  test('2. non-theo_live_ (JWT) → routes to OIDC verifier', async () => {
    const apiKey = alwaysFalse();
    const oidc = alwaysTrue();
    const app = buildApp({ apiKey, oidc });
    const res = await app.request('/v1/test', { headers: { authorization: `Bearer ${JWT_LIKE}` } });
    expect(res.status).toBe(200);
    expect(oidc.verify).toHaveBeenCalledWith(JWT_LIKE);
    expect(apiKey.verify).not.toHaveBeenCalled();
  });

  test('3. returns 401 AUTH_REQUIRED when no Authorization header', async () => {
    const app = buildApp({ apiKey: alwaysTrue(), oidc: alwaysTrue() });
    const res = await app.request('/v1/test');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  test('4. returns 401 INVALID_TOKEN when no verifier accepts the token', async () => {
    const apiKey = alwaysFalse();
    const oidc = alwaysFalse();
    const app = buildApp({ apiKey, oidc });
    const res = await app.request('/v1/test', { headers: { authorization: `Bearer ${JWT_LIKE}` } });
    expect(res.status).toBe(401);
  });

  test('5. EC-1 — theo_live_ prefix but invalid shape → falls through to OIDC + logs warning', async () => {
    const apiKey = vi.fn(() => Promise.resolve(false));
    const oidc = alwaysTrue();
    const warnLog: { msg: string; details: Record<string, unknown> }[] = [];
    const app = buildApp({
      apiKey: { verify: apiKey },
      oidc,
      logWarn: (msg, details) => warnLog.push({ msg, details }),
    });
    const res = await app.request('/v1/test', { headers: { authorization: `Bearer ${INVALID_SHAPE_PREFIX}` } });
    // Shape mismatch → apiKey verifier NOT called; OIDC called instead.
    expect(apiKey).not.toHaveBeenCalled();
    expect(oidc.verify).toHaveBeenCalledWith(INVALID_SHAPE_PREFIX);
    expect(res.status).toBe(200);
    expect(warnLog).toHaveLength(1);
    expect(warnLog[0]?.msg).toBe('prefix_collision_detected');
  });
});
