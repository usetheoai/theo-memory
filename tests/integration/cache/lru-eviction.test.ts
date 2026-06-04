/**
 * T1.2 integration — capacity-bounded LRU eviction + EC-7 concurrent-set race.
 *
 * Mocks cannot prove SERIALIZABLE semantics; this test exercises real Postgres.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T1.2 + EC-7
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { MemoryItemWithScore } from '../../../src/core/memory-item.js';
import type { Scope } from '../../../src/core/scope.js';
import { PgvectorRecallCacheStore } from '../../../src/local/recall-cache/pgvector-recall-cache-store.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t1_2_lru_eviction';
const EMBED_DIM = 1536;
const SMALL_CAP = 5; // Use a tiny cap so the test runs in milliseconds.

const ALICE: Scope = { kind: 'user', userId: 'alice' };
const BOB: Scope = { kind: 'user', userId: 'bob' };
const SAMPLE: MemoryItemWithScore[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    text: 't',
    payload: {},
    createdAt: new Date('2026-06-03T00:00:00Z'),
    updatedAt: new Date('2026-06-03T00:00:00Z'),
    score: 1,
  },
];

function vec(seed: number): number[] {
  const out = new Array<number>(EMBED_DIM).fill(0);
  // Spread the seed across a few dims so distinct queries produce distinct vectors.
  out[seed % EMBED_DIM] = 1;
  out[(seed * 7) % EMBED_DIM] = 0.5;
  // L2 normalize
  const norm = Math.sqrt(1 + 0.25);
  return out.map((x) => x / norm);
}

describe.skipIf(ROOT_PG_URI === '')(
  'T1.2 — LRU eviction (integration)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let pool: pg.Pool;
    let store: PgvectorRecallCacheStore;

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();

      pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');
      await m.runMigrations(pool);
      store = new PgvectorRecallCacheStore(pool, { maxSizePerScope: SMALL_CAP });
    }, 60_000);

    afterAll(async () => {
      await pool?.end();
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    });

    beforeEach(async () => {
      await pool.query('TRUNCATE recall_cache RESTART IDENTITY');
    });

    it('T1.2-RED-1 — inserting cap+1 distinct queries leaves count at cap', async () => {
      for (let i = 0; i < SMALL_CAP + 1; i++) {
        await store.set(vec(i + 1), ALICE, SAMPLE, 600);
      }
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'user:alice'`,
      );
      expect(rows[0]?.count).toBe(String(SMALL_CAP));
    });

    it('T1.2-RED-2 — after eviction, the oldest created_at row is gone', async () => {
      for (let i = 0; i < SMALL_CAP; i++) {
        await store.set(vec(i + 1), ALICE, SAMPLE, 600);
        // Tiny spacing so created_at differs by ≥ ms.
        await new Promise((r) => setTimeout(r, 5));
      }
      // The "oldest" row is the first one inserted; capture its id.
      const oldest = await pool.query<{ id: number }>(
        `SELECT id FROM recall_cache WHERE scope_key = 'user:alice' ORDER BY created_at ASC LIMIT 1`,
      );
      const oldestId = oldest.rows[0]?.id;
      // Push one more → eviction fires.
      await store.set(vec(99), ALICE, SAMPLE, 600);
      const stillThere = await pool.query<{ id: number }>(
        `SELECT id FROM recall_cache WHERE id = $1`,
        [oldestId],
      );
      expect(stillThere.rows).toHaveLength(0);
    });

    it('T1.2-RED-3 — eviction respects scope isolation: alice eviction does NOT touch bob', async () => {
      for (let i = 0; i < SMALL_CAP; i++) {
        await store.set(vec(i + 1), BOB, SAMPLE, 600);
      }
      // Now fill alice to cap+1; bob's rows must be untouched.
      for (let i = 0; i < SMALL_CAP + 1; i++) {
        await store.set(vec(i + 100), ALICE, SAMPLE, 600);
      }
      const bobCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'user:bob'`,
      );
      expect(bobCount.rows[0]?.count).toBe(String(SMALL_CAP));
    });

    it('T1.2-RED-4 (EC-7) — Promise.all of N concurrent set()s on full scope ends at cap (no over-delete)', async () => {
      // Pre-fill to cap.
      for (let i = 0; i < SMALL_CAP; i++) {
        await store.set(vec(i + 1), ALICE, SAMPLE, 600);
      }
      // Fire 3 concurrent sets; SERIALIZABLE+retry must serialize them
      // so the final count is exactly SMALL_CAP (not SMALL_CAP - N + 1).
      await Promise.all([
        store.set(vec(200), ALICE, SAMPLE, 600),
        store.set(vec(201), ALICE, SAMPLE, 600),
        store.set(vec(202), ALICE, SAMPLE, 600),
      ]);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'user:alice'`,
      );
      // Final count must equal cap exactly — concurrent eviction did NOT under-evict
      // (final < cap means we deleted too many) NOR over-insert (final > cap means we missed an eviction).
      expect(rows[0]?.count).toBe(String(SMALL_CAP));
    });
  },
);
