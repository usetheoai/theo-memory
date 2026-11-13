/**
 * M15 T2.3 (#122) — the candidate lookup must be index-served, not a sequential scan.
 *
 * No migration is written: `memory_entities` already carries
 * `PRIMARY KEY (memory_id, entity_id)` and `memory_id` is its LEADING column, so
 * `memory_id = ANY(...)` is served by that index. Adding a second index on the same leading
 * column would be the inverse of the parsimony ladder's first rung. This test is the
 * evidence for the claim — the alternative is asserting it in prose and hoping.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The assertion targets the access path on `memory_entities`, which is the part this change
 * controls. It does NOT dictate the join strategy for the full boost query: when the other
 * side of the join is broad, the planner may legitimately hash `memory_entities` instead,
 * and forbidding that would be testing the planner's taste rather than our index coverage.
 * The table is seeded past the point where a sequential scan would be the cheaper option,
 * so a passing assertion means something.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const ROWS = 50_000;
let db: IsolatedDb;
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;
let probeIds: string[] = [];

beforeAll(async () => {
  db = await createIsolatedDb({ embeddingDim: 384 });
  scopedPool = db.poolPinnedTo('default');
  const zeroVec = `[${Array(384).fill(0).join(',')}]`;

  // Seeded server-side: shipping 50k uuids over the wire would dominate the runtime.
  await scopedPool.query(
    `INSERT INTO memories (id, workspace_id, text, hash, embedding, payload)
     SELECT gen_random_uuid(), 'default', 'seed', md5(g::text), $1::vector, '{}'::jsonb
       FROM generate_series(1, $2) g`,
    [zeroVec, ROWS],
  );
  await scopedPool.query(
    `INSERT INTO entities (id, workspace_id, name, embedding, payload, type, normalized_key)
     SELECT gen_random_uuid(), 'default', 'seed', $1::vector, '{}'::jsonb, 'NOUN', 'k_' || g
       FROM generate_series(1, $2) g`,
    [zeroVec, ROWS],
  );
  await scopedPool.query(
    `INSERT INTO memory_entities (memory_id, entity_id)
     SELECT m.id, e.id
       FROM (SELECT id, row_number() OVER () rn FROM memories) m
       JOIN (SELECT id, row_number() OVER () rn FROM entities) e USING (rn)`,
  );
  await scopedPool.query('ANALYZE memory_entities');

  const probe = await scopedPool.query<{ memory_id: string }>(
    'SELECT memory_id FROM memory_entities LIMIT 20',
  );
  probeIds = probe.rows.map((r) => r.memory_id);
}, 300_000);

afterAll(async () => {
  await db?.dropDb();
});

describe('entity boost query plan', () => {
  test('test_index_with_memory_id_as_leading_column_exists', async () => {
    const { rows } = await scopedPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'memory_entities'`,
    );

    // Leading column is what makes `memory_id = ANY(...)` index-servable; an index led by
    // entity_id would not help this lookup at all.
    expect(rows.some((r) => /\(memory_id[,)]/.test(r.indexdef))).toBe(true);
  });

  test('test_query_plan_uses_index_scan', async () => {
    const { rows } = await scopedPool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT memory_id, entity_id FROM memory_entities WHERE memory_id = ANY($1::uuid[])`,
      [probeIds],
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');

    expect(plan).toMatch(/Index Scan|Index Only Scan|Bitmap/);
    expect(plan).not.toMatch(/Seq Scan/);
  });
});
