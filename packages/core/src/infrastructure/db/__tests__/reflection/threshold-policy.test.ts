/**
 * T2.1 tests for ThresholdReflectionPolicy.
 *
 * Mix of unit-tier (no DB) + integration-tier (env-gated real pgvector).
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T2.1
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { EmptyScopeError } from '../../../../domain/errors.js';
import type { Scope } from '../../../../domain/scope.js';
import type { ReflectionTrigger } from '../../../../domain/dip/reflection-policy.js';
import { PgvectorStore } from '../../pgvector-store.js';
import { ThresholdReflectionPolicy } from '../../reflection/threshold-reflection-policy.js';

// =============================================================================
// UNIT TIER — no DB
// =============================================================================

describe('ThresholdReflectionPolicy — unit', () => {
  // Stub store that doesn't touch DB (counter held in memory)
  function makeStubStore() {
    let count = 0;
    return {
      async bumpReflectionCounter(): Promise<number> {
        count += 1;
        return count;
      },
    };
  }

  const TRIGGER: ReflectionTrigger = { kind: 'threshold' };

  test('kind is "threshold"', () => {
    const policy = new ThresholdReflectionPolicy({ threshold: 3, store: makeStubStore() });
    expect(policy.kind).toBe('threshold');
  });

  test('throws when threshold <= 0', () => {
    expect(() => new ThresholdReflectionPolicy({ threshold: 0, store: makeStubStore() })).toThrow(/positive integer/);
    expect(() => new ThresholdReflectionPolicy({ threshold: -1, store: makeStubStore() })).toThrow(/positive integer/);
  });

  test('throws when threshold is non-integer', () => {
    expect(() => new ThresholdReflectionPolicy({ threshold: 1.5, store: makeStubStore() })).toThrow(/positive integer/);
  });

  test('EC-3: shouldReflect throws EmptyScopeError when scope userId is empty', async () => {
    const policy = new ThresholdReflectionPolicy({ threshold: 3, store: makeStubStore() });
    const scope: Scope = { kind: 'user', userId: '   ' };
    await expect(policy.shouldReflect(scope, TRIGGER)).rejects.toThrow(EmptyScopeError);
  });

  test('returns false then false then true when threshold=3', async () => {
    const policy = new ThresholdReflectionPolicy({ threshold: 3, store: makeStubStore() });
    const scope: Scope = { kind: 'user', userId: 'alice' };
    expect(await policy.shouldReflect(scope, TRIGGER)).toBe(false); // count=1
    expect(await policy.shouldReflect(scope, TRIGGER)).toBe(false); // count=2
    expect(await policy.shouldReflect(scope, TRIGGER)).toBe(true); // count=3
    expect(await policy.shouldReflect(scope, TRIGGER)).toBe(false); // count=4
    expect(await policy.shouldReflect(scope, TRIGGER)).toBe(false); // count=5
    expect(await policy.shouldReflect(scope, TRIGGER)).toBe(true); // count=6
  });
});

// =============================================================================
// INTEGRATION TIER — env-gated against real pgvector
// =============================================================================

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('ThresholdReflectionPolicy — integration (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('ThresholdReflectionPolicy — integration (real pgvector)', () => {
    let pool: pg.Pool;
    let store: PgvectorStore;
    const TRIGGER: ReflectionTrigger = { kind: 'threshold' };

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      store = new PgvectorStore({ connectionString: PG_URI });
      await store.initialize();
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE reflection_counters RESTART IDENTITY`);
    });

    test('counter persists across calls (DB-backed)', async () => {
      const policy = new ThresholdReflectionPolicy({ threshold: 3, store });
      const scope: Scope = { kind: 'user', userId: 'alice' };
      expect(await policy.shouldReflect(scope, TRIGGER)).toBe(false);
      expect(await policy.shouldReflect(scope, TRIGGER)).toBe(false);
      expect(await policy.shouldReflect(scope, TRIGGER)).toBe(true);

      // verify DB state
      const result = await pool.query<{ count: string }>(
        `SELECT count FROM reflection_counters WHERE scope_user_id = 'alice'`,
      );
      expect(result.rows[0]?.count).toBe('3');
    });

    test('multi-scope isolation: counter for user:a independent of user:b', async () => {
      const policy = new ThresholdReflectionPolicy({ threshold: 2, store });
      const scopeA: Scope = { kind: 'user', userId: 'alice' };
      const scopeB: Scope = { kind: 'user', userId: 'bob' };
      await policy.shouldReflect(scopeA, TRIGGER); // a: 1
      await policy.shouldReflect(scopeB, TRIGGER); // b: 1
      await policy.shouldReflect(scopeA, TRIGGER); // a: 2 → true
      const result = await pool.query<{ scope_user_id: string; count: string }>(
        `SELECT scope_user_id, count FROM reflection_counters ORDER BY scope_user_id`,
      );
      const counts = Object.fromEntries(result.rows.map((r) => [r.scope_user_id, r.count]));
      expect(counts).toEqual({ alice: '2', bob: '1' });
    });

    test('partial-NULL scope rows match via IS NOT DISTINCT FROM', async () => {
      const policy = new ThresholdReflectionPolicy({ threshold: 100, store });
      const scope: Scope = { kind: 'session', sessionId: 'sess-1' };
      await policy.shouldReflect(scope, TRIGGER);
      await policy.shouldReflect(scope, TRIGGER);
      const result = await pool.query<{ count: string }>(
        `SELECT count FROM reflection_counters
         WHERE scope_session_id = 'sess-1'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.count).toBe('2');
    });

    test('EC-2: bigint column persists count = 9_999_999_999 (10B, above 32-bit max)', async () => {
      await pool.query(
        `INSERT INTO reflection_counters (scope_user_id, count) VALUES ('big', 9999999999)`,
      );
      const policy = new ThresholdReflectionPolicy({ threshold: 100, store });
      const scope: Scope = { kind: 'user', userId: 'big' };
      await policy.shouldReflect(scope, TRIGGER);
      const result = await pool.query<{ count: string }>(
        `SELECT count FROM reflection_counters WHERE scope_user_id = 'big'`,
      );
      expect(result.rows[0]?.count).toBe('10000000000');
    });

    test('no race condition: 10 concurrent shouldReflect calls produce count=10', async () => {
      const policy = new ThresholdReflectionPolicy({ threshold: 100, store });
      const scope: Scope = { kind: 'user', userId: 'concurrent' };
      await Promise.all(Array.from({ length: 10 }, () => policy.shouldReflect(scope, TRIGGER)));
      const result = await pool.query<{ count: string }>(
        `SELECT count FROM reflection_counters WHERE scope_user_id = 'concurrent'`,
      );
      expect(result.rows[0]?.count).toBe('10');
    });
  });
}
