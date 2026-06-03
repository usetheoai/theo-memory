/**
 * T2.1 + T2.2 integration — `createLocalMemory({ recallCache })` end-to-end
 * against real `ankane/pgvector:v0.5.1`.
 *
 * Covers what mocks cannot: the POJO config shape constructs a real
 * `PgvectorRecallCacheStore` against the existing Pool; recall populates;
 * second recall hits; remember/forget/reflect invalidate.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T2.1 + T2.2
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import type { Embedder } from '../../../src/core/dip/embedder.js';
import type { LLM } from '../../../src/core/dip/llm.js';
import { InvalidCacheConfig } from '../../../src/core/errors.js';
import { createLocalMemory, PgvectorStore, runMigrations } from '../../../src/index.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t2_1_factory_wiring';

function vec(seed = 0): readonly number[] {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[seed] = 1;
  return v;
}

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async () => vec(0)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vec(0))),
});

const echoLlm = (): LLM => ({
  generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
    const userLine = messages.find((m) => m.role === 'user')?.content ?? '';
    return { memory: [{ id: '0', text: userLine.replace(/^user:\s*/, '') || 'fact' }] };
  }),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

describe.skipIf(ROOT_PG_URI === '')(
  'T2.1+T2.2 — createLocalMemory recall cache wiring (integration)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let pool: pg.Pool;

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();
      pool = new pg.Pool({ connectionString: testUri });
      await runMigrations(pool);
    }, 60_000);

    afterAll(async () => {
      await pool?.end();
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    });

    beforeEach(async () => {
      await pool.query('TRUNCATE memories, entities, history, recall_cache CASCADE');
    });

    it('T2.1 — POJO config → PgvectorRecallCacheStore constructed; second recall HIT', async () => {
      const embedder = fixedEmbedder();
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder,
        llm: echoLlm(),
        recallCache: { threshold: 0.8 },
      });
      // Seed: 1 memory under alice scope.
      await memory.user('alice').remember('Paulo likes coffee');

      // First recall: MISS → 9-step pipeline + cache populate. Note that
      // remember() also fires invalidateScope(); ensure that ran already.
      const first = await memory.user('alice').recall('coffee');
      expect(first.length).toBeGreaterThan(0);

      // Inspect recall_cache: exactly 1 row for user:alice now.
      const after1 = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'user:alice'`,
      );
      expect(after1.rows[0]?.count).toBe('1');

      // Second recall with same query (same vec) → HIT. We assert by counting
      // embed() calls + verifying the cache row count did NOT grow.
      const embedCallsBefore = (embedder.embed as ReturnType<typeof vi.fn>).mock.calls.length;
      const second = await memory.user('alice').recall('coffee');
      expect(second.length).toBeGreaterThan(0);
      const embedCallsAfter = (embedder.embed as ReturnType<typeof vi.fn>).mock.calls.length;
      // recall wrap embeds once on hit path too (to compute the lookup key);
      // assert it did NOT trigger a full retrieval re-run by checking the
      // cache row count is still 1 (no second set()).
      const after2 = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'user:alice'`,
      );
      expect(after2.rows[0]?.count).toBe('1');
      expect(embedCallsAfter).toBeGreaterThan(embedCallsBefore);
    });

    it('T2.2 (Item 19 AC#3) — remember after pre-warm cache returns FRESH results, not cached', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: echoLlm(),
        recallCache: { threshold: 0.8 },
      });
      await memory.user('alice').remember('Paulo likes coffee');
      await memory.user('alice').recall('coffee'); // populate cache

      const cachedRows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'user:alice'`,
      );
      expect(cachedRows.rows[0]?.count).toBe('1');

      // Write triggers invalidateScope() — cache row gone post-remember.
      await memory.user('alice').remember('Paulo likes tea');
      const postWrite = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'user:alice'`,
      );
      expect(postWrite.rows[0]?.count).toBe('0');

      // Next recall MUST re-populate from DB (not stale cached results).
      const refreshed = await memory.user('alice').recall('coffee');
      // Both memories now present (alice scope) — the freshly persisted "tea"
      // memory is reachable post-invalidation.
      expect(refreshed.length).toBeGreaterThanOrEqual(1);
    });

    it('T2.1-RED-6 (EC-2) — embedder/cache-table dim mismatch throws InvalidCacheConfig', async () => {
      // Mutate the cache-table dim WITHOUT running runMigrations({embeddingDim}).
      // applyDimChange (memories/entities) is not invoked; recall_cache stays at 1536.
      // Use a 384-dim embedder + InMemoryVectorStore — but the InMemoryVectorStore
      // branch rejects recall cache config BEFORE the dim probe (the
      // PgvectorStore-required guard short-circuits). So we test the dim probe
      // path via a PgvectorStore + manually-altered cache-table column.
      const before = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = 'recall_cache' AND a.attname = 'query_embedding'`,
      );
      // Snapshot original dim so we can restore after the test.
      const original = before.rows[0]?.atttypmod;
      // Drop indexes then ALTER the cache table to a smaller vector dim.
      await pool.query('DROP INDEX IF EXISTS recall_cache_scope_hnsw_idx');
      await pool.query('TRUNCATE recall_cache');
      await pool.query(`ALTER TABLE recall_cache ALTER COLUMN query_embedding TYPE vector(384)`);
      try {
        await expect(
          createLocalMemory({
            vectorStore: new PgvectorStore(pool),
            embedder: fixedEmbedder(), // 1536-dim per fixedEmbedder
            llm: echoLlm(),
            recallCache: { threshold: 0.8 },
          }),
        ).rejects.toThrow(InvalidCacheConfig);
      } finally {
        // Restore the cache-table dim so subsequent tests pass cleanly.
        await pool.query(`ALTER TABLE recall_cache ALTER COLUMN query_embedding TYPE vector(${String(original ?? 1536)})`);
        await pool.query(
          'CREATE INDEX IF NOT EXISTS recall_cache_scope_hnsw_idx ON recall_cache USING hnsw (query_embedding vector_cosine_ops)',
        );
      }
    });

    it('T2.1-RED-7 (EC-2 pre-migration) — null table dim does NOT throw (deferred check)', async () => {
      // Drop the table → probeCacheTableDim returns null → factory accepts config.
      // The cache wiring then proceeds; first set() would fail later (table missing)
      // but the factory itself does NOT throw.
      await pool.query('DROP TABLE IF EXISTS recall_cache CASCADE');
      try {
        const memory = await createLocalMemory({
          vectorStore: new PgvectorStore(pool),
          embedder: fixedEmbedder(),
          llm: echoLlm(),
          recallCache: { threshold: 0.8 },
        });
        expect(typeof memory.user).toBe('function');
      } finally {
        // Re-create the table for subsequent tests.
        await runMigrations(pool);
      }
    });
  },
);
