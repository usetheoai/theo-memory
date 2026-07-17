/**
 * GOAL test (recall-scoped-exact-search EG-6 T2.1) — a SPARSE scope in a DENSE
 * multi-scope pgvector index recalls its memory. Reproduces the live-test
 * HNSW-then-filter starvation: many "noise" rows in other scopes are nearer to the
 * query than the single target-scope row, so an HNSW-global-top-ef_search-then-filter
 * search returns 0 for the target scope; the EG-6 MATERIALIZED-CTE exact path filters
 * the scope first and sorts exactly → returns the target row.
 *
 * Exercises `PgvectorStore.search` directly with CRAFTED vectors (no LLM) against real
 * `ankane/pgvector:v0.5.1`, so the starvation is deterministic and the fix is isolated
 * at the store SQL layer where it lives.
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { PgvectorStore, runMigrations } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_recall_scoped_exact_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;
// Many more nearer rows than the default hnsw.ef_search (40), so the lone target-scope
// row ranks far beyond the global top-ef_search frontier — any global-first-then-filter
// strategy (HNSW-then-filter) would return 0 for the target scope by construction.
const NOISE_COUNT = 200;
const DEFAULT_EF_SEARCH = 40;
const QUERY_LITERAL = '[1,0,0,0,0,0,0,0]';

function norm(v: number[]): number[] {
  const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / m);
}

describe.skipIf(ROOT_PG_URI === '')('recall-scoped-exact-search GOAL — sparse scope recalls in a dense index', () => {
  let pool: pg.Pool;
  let store: PgvectorStore;
  const query = norm([1, 0, 0, 0, 0, 0, 0, 0]);

  beforeAll(async () => {
    const adminPool = new pg.Pool({ connectionString: ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres') });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: DIM });
    store = new PgvectorStore(pool, { embeddingDim: DIM });
    await store.initialize();

    // NOISE scope: many rows almost-identical to the query (cosine ~1) → the global nearest.
    const vectors: number[][] = [];
    const ids: string[] = [];
    const payloads: Record<string, string>[] = [];
    for (let i = 0; i < NOISE_COUNT; i += 1) {
      vectors.push(norm([1, (i + 1) * 1e-4, 0, 0, 0, 0, 0, 0]));
      ids.push(randomUUID());
      payloads.push({ text: `noise memory ${i}`, hash: `noise-${i}`, user_id: 'noise' });
    }
    // TARGET scope: a single relevant row (cosine ~0.9 to the query) that ranks AFTER all
    // the noise globally (beyond ef_search) → starved by HNSW-then-filter, found by EG-6.
    vectors.push(norm([0.9, 0.44, 0, 0, 0, 0, 0, 0]));
    ids.push(randomUUID());
    payloads.push({ text: 'the target scope memory', hash: 'target-0', user_id: 'target' });

    await store.insert(vectors, ids, payloads);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('recalls the target-scope memory despite NOISE_COUNT nearer rows in another scope', async () => {
    const results = await store.search(query, 10, { user_id: 'target' });
    expect(results.length).toBe(1);
    expect(String(results[0]?.payload['text'])).toBe('the target scope memory');
  });

  it('NON-VACUOUS: the target ranks beyond the global ef_search frontier (HNSW-then-filter → 0)', async () => {
    // Deterministic proof the setup is starvation-shaped: by EXACT distance, the count of
    // OTHER-scope rows strictly nearer to the query than the lone target row exceeds the
    // default hnsw.ef_search. So any global-top-ef_search-then-filter strategy fetches only
    // nearer (noise) rows and, after the scope filter, returns 0 for the target scope — the
    // exact production bug EG-6 fixes. store.search (CTE exact path) returns it on this data.
    const { rows } = await pool.query<{ nearer: string }>(
      `SELECT count(*)::text AS nearer FROM memories
        WHERE user_id <> 'target'
          AND (embedding <=> $1::vector) < (
            SELECT embedding <=> $1::vector FROM memories WHERE user_id = 'target' LIMIT 1
          )`,
      [QUERY_LITERAL],
    );
    expect(Number(rows[0]?.nearer)).toBeGreaterThan(DEFAULT_EF_SEARCH);
  });

  it('returns [] for an empty scope (CTE yields no rows)', async () => {
    const results = await store.search(query, 10, { user_id: 'nobody' });
    expect(results).toEqual([]);
  });

  it('the scoped query plan does not full-seq-scan (uses the scope btree)', async () => {
    const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN WITH scoped AS MATERIALIZED (SELECT id, embedding FROM memories WHERE user_id = 'target')
       SELECT id, embedding <=> '${`[${query.join(',')}]`}'::vector AS d FROM scoped ORDER BY d ASC LIMIT 10`,
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    // the inner CTE must use the user_id index (index/bitmap scan), not a full seq scan of memories.
    expect(plan).toMatch(/Index|Bitmap/i);
  });
});
