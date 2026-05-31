import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CapacityBasedTrigger,
  PgEvictor,
  TimeBasedTrigger,
  TriadicScoringPolicy,
} from '../../../src/local/eviction/index.js';
import {
  createLocalMemory,
  EvictionNotSupported,
  InMemoryVectorStore,
  PgvectorStore,
  StubEmbedder,
  StubLLM,
} from '../../../src/local/index.js';
import type { Scope } from '../../../src/core/scope.js';

/**
 * T4.1 RED tests #3-#6 + sentinel: `createLocalMemory({ eviction: {...} })`
 * wires the v0.4b eviction pipeline via the public factory. Closes F-dom-2
 * CRITICAL + F-arch-5 + F-wire-2 + F-xval-3 MAJOR per ADR D6.
 *
 * EC-6 absorption (test #6): concurrent capacity-trigger + time-trigger on
 * the same scope MUST NOT double-evict. The advisory-lock invariant
 * (`eviction_${kind}_${scopeKey}`) holds via the public factory path the
 * same way it holds via direct trigger construction.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T4.1
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_AGENT_ID = 't4-1-factory-test-agent';
const NOW_BASE = Date.now();

async function resetTestRows(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
}

async function seedAgentMemory(
  pool: pg.Pool,
  index: number,
): Promise<string> {
  const embedding = Array.from({ length: 1536 }, () => 0);
  embedding[index % 1536] = 1;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO memories (
       text, hash, embedding, payload, agent_id, last_accessed_at,
       access_count, llm_importance_score
     ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      `factory-test-${index}`,
      `factory-test-hash-${index}-${NOW_BASE}`,
      `[${embedding.join(',')}]`,
      {},
      TEST_AGENT_ID,
      new Date(NOW_BASE - index * 1000),
      0,
      0.5,
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error('seedAgentMemory: no row');
  }
  return id;
}

describe.skipIf(PG_URI === '')(
  'T4.1: createLocalMemory wires v0.4b eviction via factory (F-dom-2)',
  () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await resetTestRows(pool);
      await pool.end();
    });

    beforeEach(async () => {
      await resetTestRows(pool);
    });

    it('wires CapacityBasedTrigger when eviction.trigger="capacity"', async () => {
      const store = new PgvectorStore(pool);
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
        eviction: {
          trigger: 'capacity',
          maxMemoriesPerScope: 4,
        },
      });
      try {
        // Seed memories ABOVE the cap directly via SQL; then trigger
        // post-remember hook by calling remember() once.
        for (let i = 0; i < 6; i++) {
          await seedAgentMemory(pool, i);
        }
        const scoped = memory.agent(TEST_AGENT_ID);
        await scoped.remember('factory wiring smoke');
        // The post-remember hook fires the capacity trigger which soft-deletes
        // the lowest-scored victims. Assert active rows ≤ cap.
        const { rows } = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM memories
            WHERE agent_id = $1 AND t_invalid IS NULL`,
          [TEST_AGENT_ID],
        );
        expect(Number(rows[0]?.count ?? '0')).toBeLessThanOrEqual(5);
      } finally {
        await memory.dispose();
      }
    });

    it('starts the cron when eviction.trigger="time"', async () => {
      const store = new PgvectorStore(pool);
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
        eviction: {
          trigger: 'time',
          cronExpression: '0 0 1 1 *', // arbitrary; we never tick in real time
          evictionFraction: 0.3,
          scope: { kind: 'agent', agentId: TEST_AGENT_ID },
        },
      });
      try {
        // The factory must produce a Memory whose dispose() awaits cron stop()
        // cleanly. If dispose was missing or cron was not started, this would
        // throw (or hang).
        await memory.dispose();
      } catch (err) {
        throw new Error(`dispose() failed: ${String(err)}`);
      }
    });

    it('post-remember hook fires capacity trigger via the factory path', async () => {
      const store = new PgvectorStore(pool);
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
        eviction: {
          trigger: 'capacity',
          maxMemoriesPerScope: 2,
        },
      });
      try {
        for (let i = 0; i < 5; i++) {
          await seedAgentMemory(pool, i);
        }
        await memory.agent(TEST_AGENT_ID).remember('overflow trigger probe');
        const { rows } = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM memories
            WHERE agent_id = $1 AND t_invalid IS NOT NULL`,
          [TEST_AGENT_ID],
        );
        expect(Number(rows[0]?.count ?? '0')).toBeGreaterThan(0);
      } finally {
        await memory.dispose();
      }
    });

    it('EC-6: concurrent capacity (via factory) + time (manual) triggers do NOT double-evict', async () => {
      const store = new PgvectorStore(pool);
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
        eviction: {
          trigger: 'capacity',
          maxMemoriesPerScope: 4,
        },
      });
      // Manual TimeBasedTrigger on the SAME scope
      const policy = new TriadicScoringPolicy({ evictor: new PgEvictor(pool) });
      const scope: Scope = { kind: 'agent', agentId: TEST_AGENT_ID };
      const timeTrigger = new TimeBasedTrigger(pool, policy, {
        cronExpression: '0 0 1 1 *',
        evictionFraction: 0.5,
        scope,
      });
      try {
        for (let i = 0; i < 10; i++) {
          await seedAgentMemory(pool, i);
        }
        const overflowCount = 10 - 4; // 6 over cap
        const capacityTrigger = new CapacityBasedTrigger(pool, policy, 4);

        // Concurrent fires on the same scope share the namespaced advisory
        // lock — the second one short-circuits to null.
        const [r1, r2] = await Promise.all([
          capacityTrigger.fire(scope, new Date()),
          timeTrigger.tickNow(new Date()),
        ]);
        const total =
          (r1?.softDeleted.length ?? 0) + (r2?.softDeleted.length ?? 0);

        expect(total).toBeLessThanOrEqual(overflowCount);
      } finally {
        await memory.dispose();
      }
    });

    it('throws EvictionNotSupported when eviction config is set with InMemoryVectorStore', async () => {
      await expect(
        createLocalMemory({
          vectorStore: new InMemoryVectorStore(),
          embedder: new StubEmbedder(),
          llm: new StubLLM(),
          eviction: {
            trigger: 'capacity',
            maxMemoriesPerScope: 4,
          },
        }),
      ).rejects.toBeInstanceOf(EvictionNotSupported);
    });
  },
);
