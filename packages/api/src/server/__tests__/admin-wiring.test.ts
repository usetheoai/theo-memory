/**
 * T1.1 RED tests — admin REST `/v1/admin/keys/*` mounted via opt-in `adminApi`
 * option on `createServer`.
 *
 * Plan: `theo-memory-faang-auth-lifecycle-fixes-cycle-1` § T1.1 + ADR D1.
 *
 * 5 scenarios:
 *   1. Backward-compat — boot WITHOUT adminApi: admin routes 404 (admin sub-app NOT mounted).
 *   2. Auth gate — boot WITH adminApi: admin route without Bearer → 401 AUTH_REQUIRED.
 *   3. Bootstrap path — POST `/v1/admin/keys` with bootstrap Bearer → 200 path (route registered).
 *   4. EC-1 — `createServer({ adminApi: { pool: undefined as any } })` MUST throw at boot.
 *   5. EC-7 — admin route MUST hit requireScope (NOT generic bearerAuth) when both middlewares
 *      active; `theo_live_*` admin key returns 200, NOT 401 from generic bearer mismatch.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-fixes-cycle-1-plan.md § T1.1
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import type { AuthPool } from '../auth/api-key-verifier.js';
import { createServer } from '../index.js';

function stubMemory(): Memory {
  const scoped = {
    remember: vi.fn().mockResolvedValue([]),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'job-1', derivedCount: 0 }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  const stub: Memory = {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    history: vi.fn().mockResolvedValue([]),
    reset: vi.fn().mockResolvedValue(undefined),
    flushReflections: vi.fn().mockResolvedValue(undefined),
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),  };
  return stub;
}

/**
 * `requireScope` middleware hashes the Bearer token and looks it up in
 * theo_api_keys.scopes. For unit testing the wiring (not the storage),
 * we stub the pool to return canned scope rows keyed by token hash.
 */
function stubPoolWithAdminKey(adminTokenHash: string, scopes: readonly string[]): AuthPool {
  return {
    query: vi.fn(<T>(sql: string, params: readonly unknown[]) => {
      // requireScope's SELECT_SCOPES_BY_HASH_SQL passes [hash] as params
      if (!/SELECT scopes FROM theo_api_keys/i.test(sql)) {
        return Promise.resolve({ rows: [] as T[] });
      }
      const hash = params[0] as string;
      if (hash !== adminTokenHash) return Promise.resolve({ rows: [] as T[] });
      return Promise.resolve({
        rows: [{ scopes: JSON.stringify(scopes) }] as T[],
      });
    }) as AuthPool['query'],
  };
}

const BOOTSTRAP_TOKEN = 'bootstrap-secret-' + 'x'.repeat(32);

describe('T1.1 — admin REST wiring via opt-in adminApi option', () => {
  test('1. backward-compat — boot without adminApi: admin routes 404 (sub-app NOT mounted)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/admin/keys', { method: 'POST' }));
    expect(res.status).toBe(404);
  });

  test('2. boot with adminApi: admin route without Bearer → 401 AUTH_REQUIRED', async () => {
    const pool = stubPoolWithAdminKey('dummy-hash', ['memory:admin']);
    const app = createServer({
      memory: stubMemory(),
      adminApi: { pool, bootstrapToken: BOOTSTRAP_TOKEN },
    });
    const res = await app.fetch(new Request('http://localhost/v1/admin/keys/list'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  test('3. boot with adminApi + bootstrapToken: GET /v1/admin/keys/list with bootstrap Bearer → 200', async () => {
    const pool = stubPoolWithAdminKey('dummy-hash', ['memory:admin']);
    const app = createServer({
      memory: stubMemory(),
      adminApi: { pool, bootstrapToken: BOOTSTRAP_TOKEN },
    });
    const res = await app.fetch(
      new Request('http://localhost/v1/admin/keys/list', {
        headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  test('4. EC-1 — createServer throws at boot when adminApi.pool is undefined', () => {
    expect(() =>
      createServer({
        memory: stubMemory(),
        adminApi: { pool: undefined as unknown as AuthPool, bootstrapToken: BOOTSTRAP_TOKEN },
      }),
    ).toThrow(/adminApi\.pool is required/i);
  });

  test('5. EC-7 — admin route hits requireScope (NOT generic bearerAuth) when both middlewares active', async () => {
    // Setup: admin key with hash X has memory:admin scope. THEMEMORY_API_KEY is something ELSE
    // so the generic bearerAuth would reject the admin Bearer if it fired on /v1/admin/*.
    // EC-7 invariant: requireScope MUST resolve first; the admin Bearer routes through requireScope
    // path (NOT generic bearer) and gets a 200 even though THEMEMORY_API_KEY doesn't match it.
    const { createHash } = await import('node:crypto');
    const adminToken = `theo_live_${'a'.repeat(40)}`;
    const adminHash = createHash('sha256').update(adminToken).digest('hex');
    const pool = stubPoolWithAdminKey(adminHash, ['memory:admin']);

    process.env['THEMEMORY_API_KEY'] = 'sk-unrelated-env-secret';
    try {
      const app = createServer({
        memory: stubMemory(),
        adminApi: { pool, bootstrapToken: BOOTSTRAP_TOKEN },
      });
      const res = await app.fetch(
        new Request('http://localhost/v1/admin/keys/list', {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
      );
      // 200: requireScope resolved via theo_api_keys SHA-256 lookup → admin scope present.
      // If this returns 401, the generic bearerAuth ate the request (regression).
      expect(res.status).toBe(200);
    } finally {
      delete process.env['THEMEMORY_API_KEY'];
    }
  });
});
