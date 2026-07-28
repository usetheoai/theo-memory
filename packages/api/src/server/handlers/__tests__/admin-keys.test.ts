/**
 * T2.1 RED tests — Admin REST handlers for theo_api_keys lifecycle.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.1 (Camada 2 — REST
 * Stripe-shape: List + Create + Revoke + Rotate + Lineage).
 *
 * Mirrors the cloud-repo `theo-cloud/cloud/internal/routes/api_keys.go`
 * handler logic, adapted to TypeScript + Hono.
 *
 * EC absorptions covered here:
 *   - EC-6 (concurrent create id collision via DB UNIQUE PK)
 *   - EC-7 (create dedupes scopes via Set)
 *   - EC-2 (lineage handles cyclic rotated_from safely)
 *
 * Cross-tenant existence-leak invariant from cloud-repo D5: all 404 paths
 * collapse "doesn't exist" + "exists under different tenant" + "already
 * revoked" into a single 404 NOT_FOUND.
 *
 */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';

import type { AuthPool } from '../../auth/api-key-verifier.js';
import {
  createKeyHandler,
  listKeysHandler,
  lineageKeyHandler,
  revokeKeyHandler,
  rotateKeyHandler,
} from '../admin-keys.js';

/**
 * `res.json()` returns `Promise<unknown>` under vitest strict typecheck;
 * tests only consume a known JSON-envelope shape so we centralize the
 * cast through this helper. Keeps assertions narrow without polluting
 * each test with an inline `as { ... }` literal.
 */
async function readBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Test Pool stub — records calls + returns canned rows per call sequence. */
function makePool(callResults: { rows?: unknown[]; throws?: Error }[]): {
  pool: AuthPool;
  queries: { sql: string; params: readonly unknown[] }[];
} {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  let callIdx = 0;
  const queryImpl = <T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[] }> => {
    queries.push({ sql, params });
    const r = callResults[callIdx++] ?? { rows: [] };
    if (r.throws) return Promise.reject(r.throws);
    return Promise.resolve({ rows: (r.rows ?? []) as T[] });
  };
  const pool: AuthPool = {
    query: vi.fn(queryImpl) as AuthPool['query'],
  };
  return { pool, queries };
}

/** Build a Hono app mounting the 5 handlers under /v1/admin/keys/*. */
function buildApp(pool: AuthPool): Hono {
  const app = new Hono();
  app.post('/v1/admin/keys', (c) => createKeyHandler(c, pool, 'test-subject'));
  app.get('/v1/admin/keys/list', (c) => listKeysHandler(c, pool, 'test-subject'));
  app.delete('/v1/admin/keys/:id', (c) => revokeKeyHandler(c, pool, 'test-subject'));
  app.post('/v1/admin/keys/:id/rotate', (c) => rotateKeyHandler(c, pool, 'test-subject'));
  app.get('/v1/admin/keys/:id/lineage', (c) => lineageKeyHandler(c, pool, 'test-subject'));
  return app;
}

describe('createKeyHandler — POST /v1/admin/keys', () => {
  test('1. returns 200 with raw secret + id + key_prefix + scopes on success', async () => {
    const { pool } = makePool([{ rows: [] }]); // INSERT returns no rows
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'prod-agent', scopes: ['memory:read'] }),
    });
    expect(res.status).toBe(200);
    const body = await readBody<{ id: string; name: string; key_prefix: string; secret: string; scopes: string[] }>(res);
    expect(body.id).toMatch(/^apk-[0-9a-f]{16}$/);
    expect(body.name).toBe('prod-agent');
    expect(body.key_prefix).toMatch(/^theo_live_.{2}$/);
    expect(body.secret).toMatch(/^theo_live_[A-Za-z0-9_-]{40,}$/);
    expect(body.scopes).toEqual(['memory:read']);
  });

  test('2. returns 400 EMPTY_NAME for empty/whitespace name', async () => {
    const { pool } = makePool([]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ', scopes: ['memory:read'] }),
    });
    expect(res.status).toBe(400);
    expect((await readBody<{ code: string }>(res)).code).toBe('EMPTY_NAME');
  });

  test('3. returns 400 NAME_TOO_LONG for name > 64 chars', async () => {
    const { pool } = makePool([]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(65), scopes: ['memory:read'] }),
    });
    expect(res.status).toBe(400);
    expect((await readBody<{ code: string }>(res)).code).toBe('NAME_TOO_LONG');
  });

  test('4. returns 400 UNKNOWN_SCOPE for invalid scope', async () => {
    const { pool } = makePool([]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['memory:nonexistent'] }),
    });
    expect(res.status).toBe(400);
    expect((await readBody<{ code: string }>(res)).code).toBe('UNKNOWN_SCOPE');
  });

  test('5. returns 400 EXPIRES_IN_PAST for past expires_at', async () => {
    const { pool } = makePool([]);
    const app = buildApp(pool);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['memory:read'], expires_at: yesterday }),
    });
    expect(res.status).toBe(400);
    expect((await readBody<{ code: string }>(res)).code).toBe('EXPIRES_IN_PAST');
  });

  test('6. EC-7 — dedupes scopes via Set before INSERT', async () => {
    const { pool, queries } = makePool([{ rows: [] }]);
    const app = buildApp(pool);
    await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['memory:read', 'memory:read', 'memory:write'] }),
    });
    // INSERT scopes JSON param. Column list (RBAC slice):
    // (id, subject, tenant_id, workspace_id, user_id, key_name, key_hash, key_prefix, scopes, expires_at)
    // → scopes is at 0-indexed param 8 (workspace_id added ahead of user_id).
    const insertSql = queries.find((q) => /INSERT INTO theo_api_keys/i.test(q.sql));
    expect(insertSql).toBeDefined();
    const scopesParam = insertSql!.params[8];
    expect(JSON.parse(scopesParam as string)).toEqual(['memory:read', 'memory:write']);
  });

  test('7. EC-6 — id collision (UNIQUE violation) propagates as 500 INTERNAL', async () => {
    const uniqueErr = new Error('duplicate key value violates unique constraint');
    // RBAC slice: the mint now resolves the caller (query 0, returns no row →
    // default-deny member/'default' workspace) BEFORE the INSERT (query 1) which
    // throws the unique violation.
    const { pool } = makePool([{ rows: [] }, { throws: uniqueErr }]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['memory:read'] }),
    });
    expect(res.status).toBe(500);
    expect((await readBody<{ code: string }>(res)).code).toBe('INTERNAL');
  });
});

describe('listKeysHandler — GET /v1/admin/keys/list', () => {
  test('8. returns memories list with LIMIT 100 cap (EC-1 cloud)', async () => {
    const { pool, queries } = makePool([
      {
        rows: [
          {
            id: 'apk-1111111111111111',
            key_name: 'prod-agent',
            key_prefix: 'theo_live_Ab',
            scopes: JSON.stringify(['memory:read']),
            created_at: new Date('2026-06-07T10:00:00Z'),
            last_used_at: null,
            expires_at: null,
          },
        ],
      },
    ]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: { id: string; scopes: string[] }[] };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]?.id).toBe('apk-1111111111111111');
    expect(body.keys[0]?.scopes).toEqual(['memory:read']);
    // SQL contains LIMIT 100 (cap per cloud EC-1)
    expect(queries[0]?.sql).toMatch(/LIMIT\s+100/i);
  });

  test('9. excludes revoked rows (WHERE revoked_at IS NULL)', async () => {
    const { pool, queries } = makePool([{ rows: [] }]);
    const app = buildApp(pool);
    await app.request('/v1/admin/keys/list');
    expect(queries[0]?.sql).toMatch(/revoked_at\s+IS\s+NULL/i);
  });
});

describe('revokeKeyHandler — DELETE /v1/admin/keys/:id', () => {
  test('10. returns 400 INVALID_ID for malformed id (not apk-{16hex})', async () => {
    const { pool, queries } = makePool([]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/not-a-valid-id', { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect((await readBody<{ code: string }>(res)).code).toBe('INVALID_ID');
    // No DB query made — format check before DB
    expect(queries.length).toBe(0);
  });

  test('11. returns 404 NOT_FOUND for unknown id (rowsAffected === 0)', async () => {
    // pg's UPDATE result shape: { rowCount: 0 } when no row matched.
    // Our makePool stub returns { rows: [] }; need to also include rowCount semantics.
    // The handler interrogates rowCount when present, falls back to rows.length === 0.
    const { pool } = makePool([{ rows: [] }]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/apk-2222222222222222', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect((await readBody<{ code: string }>(res)).code).toBe('NOT_FOUND');
  });

  test('12. returns 204 No Content on success', async () => {
    const { pool } = makePool([{ rows: [{ id: 'apk-3333333333333333' }] }]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/apk-3333333333333333', { method: 'DELETE' });
    expect(res.status).toBe(204);
  });
});

describe('rotateKeyHandler — POST /v1/admin/keys/:id/rotate', () => {
  test('13. returns 200 with new secret + old_id + grace_window_hours', async () => {
    const { pool } = makePool([
      // BEGIN
      { rows: [] },
      // SELECT FOR UPDATE the old row
      {
        rows: [
          {
            key_name: 'prod',
            scopes: JSON.stringify(['memory:read']),
            revoked_at: null,
            expires_at: null,
          },
        ],
      },
      // INSERT new row
      { rows: [] },
      // UPDATE old expires_at
      { rows: [] },
      // COMMIT
      { rows: [] },
    ]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/apk-4444444444444444/rotate', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readBody<{ old_id: string; id: string; secret: string; grace_window_hours: number }>(res);
    expect(body.old_id).toBe('apk-4444444444444444');
    expect(body.id).toMatch(/^apk-[0-9a-f]{16}$/);
    expect(body.secret).toMatch(/^theo_live_/);
    expect(body.grace_window_hours).toBe(24); // default
  });

  test('14. returns 400 INVALID_GRACE_WINDOW for out-of-range body', async () => {
    const { pool } = makePool([]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/apk-5555555555555555/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grace_window_hours: 999 }), // > 168 max
    });
    expect(res.status).toBe(400);
    expect((await readBody<{ code: string }>(res)).code).toBe('INVALID_GRACE_WINDOW');
  });

  test('15. returns 404 NOT_FOUND when old key already revoked', async () => {
    const { pool } = makePool([
      { rows: [] },
      {
        rows: [
          {
            key_name: 'p',
            scopes: JSON.stringify(['memory:read']),
            revoked_at: new Date(),
            expires_at: null,
          },
        ],
      },
    ]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/apk-6666666666666666/rotate', { method: 'POST' });
    expect(res.status).toBe(404);
    expect((await readBody<{ code: string }>(res)).code).toBe('NOT_FOUND');
  });
});

describe('lineageKeyHandler — GET /v1/admin/keys/:id/lineage', () => {
  test('16. EC-2 — lineage handles cyclic rotated_from safely via UNION dedupe', async () => {
    // Test that the recursive CTE uses UNION (deduping any cycle) — assert
    // the SQL clause + ordering. Even if a buggy row creates A→B and B→A,
    // the LIMIT 100 + UNION caps the result; we assert the structural query.
    const { pool, queries } = makePool([
      {
        rows: [
          {
            id: 'apk-aaaaaaaaaaaaaaaa',
            key_name: 'root',
            key_prefix: 'theo_live_aa',
            created_at: new Date('2026-06-01T10:00:00Z'),
            revoked_at: null,
            expires_at: null,
          },
        ],
      },
    ]);
    const app = buildApp(pool);
    const res = await app.request('/v1/admin/keys/apk-aaaaaaaaaaaaaaaa/lineage');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lineage: { is_current: boolean }[] };
    expect(body.lineage).toHaveLength(1);
    expect(body.lineage[0]?.is_current).toBe(true);
    // SQL uses UNION (not UNION ALL) per EC-2 absorption
    expect(queries[0]?.sql).toMatch(/UNION\b(?!\s+ALL)/i);
    // LIMIT 100 defensive cap per cloud D2
    expect(queries[0]?.sql).toMatch(/LIMIT\s+100/i);
  });
});
