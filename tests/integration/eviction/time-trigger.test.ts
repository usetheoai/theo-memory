/**
 * T5.2 RED tests for v0.4b `TimeBasedTrigger`.
 *
 * Cron-scheduled background eviction per blueprint D10. REUSES `croner`
 * from v0.4a (zero new runtime dep — Rule 9 honored per blueprint Q2
 * REJECT-all verdict).
 *
 * Plan T5.2 declares 4 RED tests; this file ships 4. Test pattern (per
 * plan deep dive line 799 + v0.4a EC-4 precedent reinforced in blueprint
 * D11): "override cron expression via config to fire on-demand (NOT clock
 * mocking)". The deterministic-test entry point is `tickNow()` which
 * invokes the same callback the cron schedule would. Real-cron timing is
 * covered by `test_time_trigger_fires_per_cron_schedule` with a short
 * 1.5s wait.
 *
 * Plan path deviation: integration test placed at tests/integration/ per
 * established T2.2/T3.1/T4.1/T4.2/T5.1 pattern. Documented in commit body.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T5.2 (D10 + D11 + EC-9)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import { InvalidCronExpressionError, TimeBasedTrigger } from '../../../src/local/eviction/time-based-trigger.js';
import { PgNearestNeighborProvider } from '../../../src/local/eviction/pg-nearest-neighbor-provider.js';
import { TriadicScoringPolicy } from '../../../src/local/eviction/triadic-scoring-policy.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

describe('TimeBasedTrigger constructor (EC-9 cron validation)', () => {
  test('accepts the 6-field per-second cron expression `* * * * * *`', () => {
    expect(
      () =>
        new TimeBasedTrigger(
          { connect: async () => null } as unknown as pg.Pool,
          {} as unknown as TriadicScoringPolicy,
          { cronExpression: '* * * * * *', evictionFraction: 0.3, scopeId: 'x' },
        ),
    ).not.toThrow();
  });

  test('accepts the 5-field minute-cron expression `* * * * *`', () => {
    expect(
      () =>
        new TimeBasedTrigger(
          { connect: async () => null } as unknown as pg.Pool,
          {} as unknown as TriadicScoringPolicy,
          { cronExpression: '* * * * *', evictionFraction: 0.3, scopeId: 'x' },
        ),
    ).not.toThrow();
  });

  test('rejects empty cron expression with InvalidCronExpressionError', () => {
    expect(
      () =>
        new TimeBasedTrigger(
          { connect: async () => null } as unknown as pg.Pool,
          {} as unknown as TriadicScoringPolicy,
          { cronExpression: '', evictionFraction: 0.3, scopeId: 'x' },
        ),
    ).toThrow(InvalidCronExpressionError);
  });

  test('rejects malformed cron expression with InvalidCronExpressionError', () => {
    expect(
      () =>
        new TimeBasedTrigger(
          { connect: async () => null } as unknown as pg.Pool,
          {} as unknown as TriadicScoringPolicy,
          { cronExpression: 'not-a-cron-string', evictionFraction: 0.3, scopeId: 'x' },
        ),
    ).toThrow(InvalidCronExpressionError);
  });
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T5.2 TimeBasedTrigger pgvector tests (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T5.2 TimeBasedTrigger lifecycle + tick (D10; real pgvector)', () => {
    let pool: pg.Pool;
    let policy: TriadicScoringPolicy;

    const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t5-2';
    const TEST_EMBEDDING = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);

    async function seedMemories(count: number, agentId: string = TEST_AGENT_ID): Promise<void> {
      for (let i = 0; i < count; i++) {
        await pool.query(
          `INSERT INTO memories (
              text, hash, embedding, payload, agent_id,
              llm_importance_score, last_accessed_at, access_count
           ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)`,
          [
            `seed ${i}`,
            `h-t5-2-${i}-${Math.random().toString(36).slice(2)}`,
            `[${TEST_EMBEDDING.join(',')}]`,
            {},
            agentId,
            i / count,
            new Date(Date.now() - i * 1000),
            i,
          ],
        );
      }
    }

    async function countActive(agentId: string = TEST_AGENT_ID): Promise<number> {
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM memories WHERE agent_id = $1 AND t_invalid IS NULL`,
        [agentId],
      );
      return Number(result.rows[0]?.count ?? '0');
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      const provider = new PgNearestNeighborProvider(pool);
      policy = new TriadicScoringPolicy(undefined, undefined, null, provider);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    });

    test('tickNow evicts the configured fraction of memories', async () => {
      await seedMemories(100);
      const before = await countActive();
      expect(before).toBe(100);

      const trigger = new TimeBasedTrigger(pool, policy, {
        cronExpression: '* * * * * *',
        evictionFraction: 0.3,
        scopeId: TEST_AGENT_ID,
      });

      await trigger.tickNow(new Date());

      const after = await countActive();
      // Expect ~30 evicted; allow ±5 tolerance for selectVictims edge cases.
      expect(after).toBeGreaterThanOrEqual(65);
      expect(after).toBeLessThanOrEqual(75);
    });

    test('lifecycle: start + stop are both idempotent', () => {
      const trigger = new TimeBasedTrigger(pool, policy, {
        cronExpression: '* * * * * *',
        evictionFraction: 0.3,
        scopeId: TEST_AGENT_ID,
      });

      expect(trigger.isStarted()).toBe(false);
      trigger.start();
      expect(trigger.isStarted()).toBe(true);
      // Idempotent: second start is a no-op
      trigger.start();
      expect(trigger.isStarted()).toBe(true);

      trigger.stop();
      expect(trigger.isStarted()).toBe(false);
      // Idempotent: second stop is a no-op
      trigger.stop();
      expect(trigger.isStarted()).toBe(false);
    });

    test('fires per cron schedule (real-cron sanity check; 1.5s wait)', async () => {
      await seedMemories(20);

      const trigger = new TimeBasedTrigger(pool, policy, {
        cronExpression: '* * * * * *',
        evictionFraction: 0.3,
        scopeId: TEST_AGENT_ID,
      });

      let fireCount = 0;
      trigger.onTick(() => {
        fireCount += 1;
      });

      trigger.start();
      await new Promise((r) => setTimeout(r, 1500));
      trigger.stop();

      // 1.5s window at every-second cron → at least 1 tick.
      expect(fireCount).toBeGreaterThanOrEqual(1);
    });
  });
}
