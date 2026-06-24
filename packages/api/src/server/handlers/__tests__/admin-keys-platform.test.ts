/**
 * Unit tests — Model B slice 1 / T1.2: platform-admin workspace-targeted mint.
 *
 * Stub-pool tests for `createKeyHandler` honoring an optional `workspace_id`:
 *   - platform-admin caller targets an arbitrary workspace → 200 + auto-provision
 *   - non-platform (memory:admin) caller targeting a foreign workspace → 403
 *   - invalid workspace_id identifier → 400 (EC-1)
 *   - caller resolution PG error → 503 fail-closed (EC-2)
 *   - omitted workspace_id → caller-workspace binding unchanged (regression)
 *
 * @see .claude/knowledge-base/plans/model-b-platform-admin-mint-plan.md § T1.2 (ADR D1/D3, EC-1/EC-2)
 */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';

import type { AuthPool } from '../../auth/api-key-verifier.js';
import { createKeyHandler } from '../admin-keys.js';

const PLATFORM_TOKEN = `theo_live_${'p'.repeat(40)}`;
const ADMIN_TOKEN = `theo_live_${'a'.repeat(40)}`;

async function readBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Pool stub returning canned rows per call sequence; records every query. */
function makePool(callResults: { rows?: unknown[]; throws?: Error }[]): {
  pool: AuthPool;
  queries: { sql: string; params: readonly unknown[] }[];
} {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  let i = 0;
  const queryImpl = <T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[] }> => {
    queries.push({ sql, params });
    const r = callResults[i++] ?? { rows: [] };
    if (r.throws) return Promise.reject(r.throws);
    return Promise.resolve({ rows: (r.rows ?? []) as T[] });
  };
  return { pool: { query: vi.fn(queryImpl) as AuthPool['query'] }, queries };
}

function app(pool: AuthPool): Hono {
  const a = new Hono();
  a.post('/v1/admin/keys', (c) => createKeyHandler(c, pool, 'admin-subject'));
  return a;
}

function post(a: Hono, token: string, body: unknown): Promise<Response> {
  return a.request('/v1/admin/keys', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('createKeyHandler — Model B platform-admin workspace targeting (T1.2)', () => {
  test('platform-admin caller mints into an arbitrary workspace + auto-provisions it', async () => {
    const { pool, queries } = makePool([
      { rows: [{ workspace_id: 'ws-platform', scopes: ['memory:platform-admin'], role: 'owner' }] }, // caller resolve
      { rows: [] }, // workspaces upsert
      { rows: [] }, // key insert
    ]);
    const res = await post(app(pool), PLATFORM_TOKEN, {
      name: 'gw-tenant-tn123',
      scopes: ['memory:read', 'memory:write', 'memory:delete'],
      workspace_id: 'tn-123',
    });
    expect(res.status).toBe(200);
    // workspaces upsert ran with the target id
    const upsert = queries.find((q) => q.sql.includes('INSERT INTO workspaces'));
    expect(upsert?.params[0]).toBe('tn-123');
    // key INSERT bound workspace_id = target (4th positional param)
    const keyInsert = queries.find((q) => q.sql.includes('INSERT INTO theo_api_keys'));
    expect(keyInsert?.params[3]).toBe('tn-123');
  });

  test('memory:admin caller targeting a foreign workspace → 403 INSUFFICIENT_SCOPE_FOR_TARGET', async () => {
    const { pool, queries } = makePool([
      { rows: [{ workspace_id: 'ws-own', scopes: ['memory:admin'], role: 'admin' }] }, // caller resolve
    ]);
    const res = await post(app(pool), ADMIN_TOKEN, {
      name: 'k',
      scopes: ['memory:read'],
      workspace_id: 'tn-other',
    });
    expect(res.status).toBe(403);
    expect((await readBody(res)).code).toBe('INSUFFICIENT_SCOPE_FOR_TARGET');
    // No workspace was provisioned (fail before any write)
    expect(queries.some((q) => q.sql.includes('INSERT INTO workspaces'))).toBe(false);
  });

  test('invalid workspace_id identifier → 400 INVALID_WORKSPACE_ID (EC-1)', async () => {
    const tooLong = 'x'.repeat(65);
    const { pool } = makePool([
      { rows: [{ workspace_id: 'ws-platform', scopes: ['memory:platform-admin'], role: 'owner' }] },
    ]);
    const res = await post(app(pool), PLATFORM_TOKEN, {
      name: 'k',
      scopes: ['memory:read'],
      workspace_id: tooLong,
    });
    expect(res.status).toBe(400);
    expect((await readBody(res)).code).toBe('INVALID_WORKSPACE_ID');
  });

  test('caller resolution PG error → 503 fail-closed (EC-2)', async () => {
    const { pool } = makePool([{ throws: new Error('pg down') }]); // caller resolve throws
    const res = await post(app(pool), PLATFORM_TOKEN, {
      name: 'k',
      scopes: ['memory:read'],
      workspace_id: 'tn-123',
    });
    expect(res.status).toBe(503);
    expect((await readBody(res)).code).toBe('SERVICE_UNAVAILABLE');
  });

  test('omitted workspace_id binds the caller workspace (regression)', async () => {
    const { pool, queries } = makePool([
      { rows: [{ workspace_id: 'ws-own', scopes: ['memory:admin'], role: 'admin' }] }, // caller resolve
      { rows: [] }, // workspaces upsert (own ws)
      { rows: [] }, // key insert
    ]);
    const res = await post(app(pool), ADMIN_TOKEN, {
      name: 'k',
      scopes: ['memory:read'],
    });
    expect(res.status).toBe(200);
    const keyInsert = queries.find((q) => q.sql.includes('INSERT INTO theo_api_keys'));
    expect(keyInsert?.params[3]).toBe('ws-own');
  });
});
