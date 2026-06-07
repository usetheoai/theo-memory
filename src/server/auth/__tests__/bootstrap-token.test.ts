/**
 * T2.2.1 RED tests — bootstrap-token self-revoke utilities.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.2.1 + EC-3.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T2.2.1
 */
import { describe, expect, test, vi } from 'vitest';

import type { AuthPool } from '../api-key-verifier.js';
import { isBootstrapAllowed, markBootstrapConsumedTx } from '../bootstrap-token.js';

function poolReturning(rows: unknown[]): {
  pool: AuthPool;
  queries: { sql: string }[];
} {
  const queries: { sql: string }[] = [];
  const pool: AuthPool = {
    query: vi.fn(<T>(sql: string) => {
      queries.push({ sql });
      return Promise.resolve({ rows: rows as T[] });
    }),
  };
  return { pool, queries };
}

describe('isBootstrapAllowed', () => {
  test('1. returns true when admin_config row has bootstrap_consumed=false', async () => {
    const { pool } = poolReturning([{ bootstrap_consumed: false }]);
    await expect(isBootstrapAllowed(pool)).resolves.toBe(true);
  });

  test('2. returns false when admin_config row has bootstrap_consumed=true (self-revoke fired)', async () => {
    const { pool } = poolReturning([{ bootstrap_consumed: true }]);
    await expect(isBootstrapAllowed(pool)).resolves.toBe(false);
  });

  test('3. returns false when admin_config row is missing (fail-closed per Inq Rule 8)', async () => {
    const { pool } = poolReturning([]);
    await expect(isBootstrapAllowed(pool)).resolves.toBe(false);
  });
});

describe('markBootstrapConsumedTx', () => {
  test('4. flips flag when not yet consumed (UPDATE returns 1 row)', async () => {
    const { pool, queries } = poolReturning([{ id: 1 }]);
    await expect(markBootstrapConsumedTx(pool)).resolves.toBe(1);
    expect(queries[0]?.sql).toMatch(/UPDATE\s+admin_config/i);
    expect(queries[0]?.sql).toMatch(/bootstrap_consumed\s*=\s*true/i);
    expect(queries[0]?.sql).toMatch(/WHERE.*bootstrap_consumed\s*=\s*false/i);
    expect(queries[0]?.sql).toMatch(/RETURNING\s+id/i);
  });

  test('5. no-ops idempotently when already consumed (UPDATE returns 0 rows)', async () => {
    const { pool } = poolReturning([]);
    await expect(markBootstrapConsumedTx(pool)).resolves.toBe(0);
  });
});
