/**
 * T2.2 RED tests — scope verifier middleware for admin endpoints.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.2 + ADR D7.
 *
 * Gates `/v1/admin/keys/*` endpoints to keys carrying `memory:admin`
 * scope (loaded from `theo_api_keys.scopes` JSONB via SHA-256 lookup).
 * Bootstrap admin token (D7) bypasses scope check (it IS admin by
 * definition — its purpose is to bootstrap the first admin key).
 *
 * Scope-check pattern: middleware reads the Bearer token from
 * `Authorization` header, hashes via SHA-256, joins against
 * `theo_api_keys` filtering by required scope. Returns 403
 * SCOPE_INSUFFICIENT on mismatch; 401 INVALID_API_KEY on missing key.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T2.2
 */
import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';

import type { AuthPool } from '../api-key-verifier.js';
import { requireScope } from '../scope-verifier.js';

const ADMIN_TOKEN = `theo_live_${'a'.repeat(40)}`;
const READ_ONLY_TOKEN = `theo_live_${'b'.repeat(40)}`;
const BOOTSTRAP_TOKEN = 'bootstrap-test-token-32chars-min!!';

function makePool(rowsByHash: Record<string, { scopes: string[] }>): AuthPool {
  return {
    query: vi.fn(<T>(_sql: string, params: readonly unknown[]) => {
      const hash = params[0] as string;
      const row = rowsByHash[hash];
      if (!row) return Promise.resolve({ rows: [] as T[] });
      return Promise.resolve({
        rows: [{ scopes: JSON.stringify(row.scopes) }] as T[],
      });
    }),
  };
}

function buildApp(pool: AuthPool, bootstrapToken?: string): Hono {
  const app = new Hono();
  app.use('/v1/admin/*', requireScope({ pool, requiredScope: 'memory:admin', bootstrapToken }));
  app.get('/v1/admin/test', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('requireScope — admin scope gate', () => {
  test('1. passes for token whose key has memory:admin scope', async () => {
    const adminHash = createHash('sha256').update(ADMIN_TOKEN).digest('hex');
    const pool = makePool({ [adminHash]: { scopes: ['memory:admin', 'memory:read'] } });
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/test', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  test('2. rejects 403 SCOPE_INSUFFICIENT for read-only key', async () => {
    const readHash = createHash('sha256').update(READ_ONLY_TOKEN).digest('hex');
    const pool = makePool({ [readHash]: { scopes: ['memory:read'] } });
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/test', {
      headers: { authorization: `Bearer ${READ_ONLY_TOKEN}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('SCOPE_INSUFFICIENT');
  });

  test('3. bootstrap token bypasses scope check (grants admin)', async () => {
    const pool = makePool({}); // no rows
    const app = buildApp(pool, BOOTSTRAP_TOKEN);
    const res = await app.request('/v1/admin/test', {
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  test('4. rejects 401 INVALID_API_KEY for unknown token', async () => {
    const pool = makePool({});
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/test', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_API_KEY');
  });

  test('5. rejects 401 AUTH_REQUIRED when Authorization header missing', async () => {
    const pool = makePool({});
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/test');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AUTH_REQUIRED');
  });
});
