/**
 * T1.1 RED tests — ApiKeyAuthVerifier impl of the 12th DIP AuthVerifier.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T1.1 + T1.2.
 *
 * Camada 2 OSS multi-user lifecycle — `theo_live_*` prefix triggers a
 * SHA-256 lookup against the `theo_api_keys` table (per blueprint Q1
 * Stripe-shape verdict). Coexists with the existing env-var
 * `BearerAuthVerifier` behind the same single-method DIP.
 *
 * **EC-8 absorption:** token containing SQL metachars is handled safely
 * via the parameterized query layer — pinned by an explicit test.
 *
 */
import { createHash } from 'node:crypto';

import { describe, expect, test, vi } from 'vitest';

import { ApiKeyAuthVerifier, type AuthPool } from '../api-key-verifier.js';

/** Test-only Pool stub that records query calls + returns canned rows. */
function makePool(opts: {
  selectRows?: { id: string }[];
  selectThrows?: Error;
}): {
  pool: AuthPool;
  queries: { sql: string; params: readonly unknown[] }[];
} {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const queryImpl = <T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[] }> => {
    queries.push({ sql, params });
    if (opts.selectThrows) return Promise.reject(opts.selectThrows);
    // First call = SELECT; second call = UPDATE last_used_at
    if (queries.length === 1) {
      return Promise.resolve({ rows: (opts.selectRows ?? []) as T[] });
    }
    return Promise.resolve({ rows: [] as T[] });
  };
  const pool: AuthPool = {
    query: vi.fn(queryImpl) as AuthPool['query'],
  };
  return { pool, queries };
}

const VALID_TOKEN = `theo_live_${'a'.repeat(40)}`;
const EXPECTED_HASH = createHash('sha256').update(VALID_TOKEN).digest('hex');

describe('ApiKeyAuthVerifier — implements AuthVerifier DIP (T1.1 RED)', () => {
  test('1. verify returns true when SHA-256 lookup finds the active key', async () => {
    const { pool, queries } = makePool({ selectRows: [{ id: 'apk-aaaaaaaaaaaaaaaa' }] });
    const v = new ApiKeyAuthVerifier(pool);
    await expect(v.verify(VALID_TOKEN)).resolves.toBe(true);
    expect(queries[0]?.params[0]).toBe(EXPECTED_HASH);
  });

  test('2. verify returns false when SELECT finds zero rows (unknown key)', async () => {
    const { pool } = makePool({ selectRows: [] });
    const v = new ApiKeyAuthVerifier(pool);
    await expect(v.verify(VALID_TOKEN)).resolves.toBe(false);
  });

  test('3. verify returns false for token NOT starting with theo_live_ prefix (no DB query made)', async () => {
    const { pool, queries } = makePool({ selectRows: [{ id: 'apk-x' }] });
    const v = new ApiKeyAuthVerifier(pool);
    await expect(v.verify('Bearer eyJ-some-jwt')).resolves.toBe(false);
    await expect(v.verify('sk_test_stripe-style')).resolves.toBe(false);
    expect(queries.length).toBe(0);
  });

  test('4. verify returns false for empty token (no DB query made)', async () => {
    const { pool, queries } = makePool({ selectRows: [{ id: 'apk-x' }] });
    const v = new ApiKeyAuthVerifier(pool);
    await expect(v.verify('')).resolves.toBe(false);
    expect(queries.length).toBe(0);
  });

  test('5. verify returns false for token equal to bare prefix (no entropy past prefix; no DB query)', async () => {
    const { pool, queries } = makePool({ selectRows: [{ id: 'apk-x' }] });
    const v = new ApiKeyAuthVerifier(pool);
    await expect(v.verify('theo_live_')).resolves.toBe(false);
    expect(queries.length).toBe(0);
  });

  test('6. verify SQL clause filters revoked + expired + tenant_id self', async () => {
    const { pool, queries } = makePool({ selectRows: [{ id: 'apk-x' }] });
    const v = new ApiKeyAuthVerifier(pool);
    await v.verify(VALID_TOKEN);
    const selectSql = queries[0]?.sql;
    expect(selectSql).toMatch(/key_hash\s*=\s*\$1/i);
    expect(selectSql).toMatch(/revoked_at\s+IS\s+NULL/i);
    expect(selectSql).toMatch(/expires_at\s+IS\s+NULL\s+OR\s+expires_at\s*>/i);
    expect(selectSql).toMatch(/tenant_id\s*=\s*'self'/i);
  });

  test('7. verify fires last_used_at UPDATE after successful match (fire-and-forget)', async () => {
    const { pool, queries } = makePool({ selectRows: [{ id: 'apk-x' }] });
    const v = new ApiKeyAuthVerifier(pool);
    await v.verify(VALID_TOKEN);
    // First call = SELECT, second call = UPDATE. Allow the fire-and-forget
    // microtask to drain.
    await new Promise((r) => setImmediate(r));
    expect(queries.length).toBe(2);
    expect(queries[1]?.sql).toMatch(/UPDATE\s+theo_api_keys\s+SET\s+last_used_at/i);
    expect(queries[1]?.params[0]).toBe(EXPECTED_HASH);
  });

  test('8. EC-8 — verify handles token with SQL metachars safely (parameterized query pins safety)', async () => {
    // Construct a token that LOOKS like SQL injection. The hash is computed
    // over the raw token bytes; the query passes the hash as $1 — never the
    // raw token. So even if the token is `theo_live_aaa'; DROP TABLE; --`,
    // the SQL is unaffected.
    const evilToken = `theo_live_aaa'; DROP TABLE theo_api_keys; --`;
    const evilHash = createHash('sha256').update(evilToken).digest('hex');
    const { pool, queries } = makePool({ selectRows: [] });
    const v = new ApiKeyAuthVerifier(pool);
    await expect(v.verify(evilToken)).resolves.toBe(false);
    expect(queries[0]?.params[0]).toBe(evilHash);
    // The SQL string MUST NOT interpolate the raw token — only parameterized.
    expect(queries[0]?.sql).not.toContain(evilToken);
    expect(queries[0]?.sql).not.toContain('DROP TABLE');
  });
});
