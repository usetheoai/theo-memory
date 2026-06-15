import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CapacityBasedTrigger } from '@usetheo/memory';
import { PgEvictor } from '@usetheo/memory';
import type {
  EvictionPolicy,
  EvictionResult,
  ScoreContext,
} from '@usetheo/memory';
import type { MemoryItem } from '@usetheo/memory';
import type { Scope } from '@usetheo/memory';

/**
 * T12.1 (F-xval-2): triggers invoke the EvictionPolicy `onEvictionStart` +
 * `onEvictionEnd` lifecycle hooks declared by ADR D12. Pre-T12.1 the hooks
 * were declared on the DIP but no trigger ever called them — dead lifecycle
 * surface. T12.1 wires both triggers to call the hooks at the eviction
 * boundary; the test exercises the canonical observability flow.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T12.1
 * @see .claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md § F-xval-2
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_USER_ID = 't12-1-lifecycle';
const NOW = new Date('2026-05-31T12:00:00Z');

class TracingPolicy implements EvictionPolicy {
  readonly kind = 'tracing' as const;
  startCalls: { scope: Scope; fraction: number }[] = [];
  endCalls: { scope: Scope; result: EvictionResult | Error }[] = [];

  async score(_memory: MemoryItem, _context: ScoreContext): Promise<number> {
    await Promise.resolve();
    return 0.5;
  }

  async selectVictims(
    candidates: readonly MemoryItem[],
    fraction: number,
    _context: ScoreContext,
  ): Promise<readonly string[]> {
    await Promise.resolve();
    return candidates.slice(0, Math.floor(candidates.length * fraction)).map((c) => c.id);
  }

  async onEvictionStart(scope: Scope, fraction: number): Promise<void> {
    await Promise.resolve();
    this.startCalls.push({ scope, fraction });
  }

  async onEvictionEnd(scope: Scope, result: EvictionResult | Error): Promise<void> {
    await Promise.resolve();
    this.endCalls.push({ scope, result });
  }
}

describe.skipIf(PG_URI === '')(
  'T12.1 (F-xval-2): EvictionPolicy lifecycle hooks fire from triggers',
  () => {
    let pool: pg.Pool;

    async function reset(): Promise<void> {
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER_ID]);
    }

    async function seedRow(i: number): Promise<void> {
      const embedding = Array.from({ length: 1536 }, () => 0);
      embedding[i % 1536] = 1;
      await pool.query(
        `INSERT INTO memories (
            text, hash, embedding, payload, user_id,
            last_accessed_at, access_count, llm_importance_score
         ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)`,
        [
          `lifecycle-row-${i}`,
          `t12-1-lifecycle-${i}`,
          `[${embedding.join(',')}]`,
          {},
          TEST_USER_ID,
          new Date(NOW.getTime() - i * 1000),
          0,
          0.5,
        ],
      );
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await reset();
      await pool.end();
    });

    beforeEach(async () => {
      await reset();
    });

    it('onEvictionStart is invoked by CapacityBasedTrigger before selectVictims', async () => {
      for (let i = 0; i < 6; i++) {
        await seedRow(i);
      }
      const policy = new TracingPolicy();
      const trigger = new CapacityBasedTrigger(pool, policy, 4);
      const scope: Scope = { kind: 'user', userId: TEST_USER_ID };

      await trigger.fire(scope, NOW);

      expect(policy.startCalls).toHaveLength(1);
      expect(policy.startCalls[0]?.scope).toEqual(scope);
      expect(policy.startCalls[0]?.fraction).toBeCloseTo(2 / 6, 5);
    });

    it('onEvictionEnd is invoked with the eviction result post-selectVictims', async () => {
      for (let i = 0; i < 6; i++) {
        await seedRow(i);
      }
      const evictor = new PgEvictor(pool);
      const policy = new TracingPolicy();
      policy.selectVictims = async (candidates, fraction): Promise<readonly string[]> => {
        const victims = candidates.slice(0, Math.floor(candidates.length * fraction));
        await evictor.evict(victims.map((v) => v.id));
        return victims.map((v) => v.id);
      };
      const trigger = new CapacityBasedTrigger(pool, policy, 4);
      const scope: Scope = { kind: 'user', userId: TEST_USER_ID };

      await trigger.fire(scope, NOW);

      expect(policy.endCalls).toHaveLength(1);
      const ended = policy.endCalls[0];
      expect(ended?.scope).toEqual(scope);
      if (ended?.result instanceof Error) throw new Error('expected EvictionResult');
      expect(ended?.result.softDeleted.length).toBeGreaterThan(0);
    });
  },
);
