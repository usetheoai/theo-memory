/**
 * Integration test — migration `0023_recall_traces` (explainable-recall T1.1).
 * Applies ALL migrations from a blank DB (reads .sql from src) against real
 * pgvector and asserts the `recall_traces` table exists with the expected
 * columns + indexes, and that `composite` is nullable (EC-6).
 *
 * @see plan explainable-recall § Phase 1 / T1.1
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

let db: IsolatedDb;

beforeAll(async () => {
  // fresh + embeddingDim → blank DB, then runMigrations applies 0000..0023 from src.
  db = await createIsolatedDb({ fresh: true, embeddingDim: 384 });
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
});

test('test_migration_creates_recall_traces — table exists with expected columns + indexes', async () => {
  const cols = await db.pool.query<{ column_name: string; is_nullable: string }>(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'recall_traces'
      ORDER BY ordinal_position`,
  );
  const names = cols.rows.map((r) => r.column_name);
  expect(names).toEqual(
    expect.arrayContaining([
      'id',
      'recall_id',
      'workspace_id',
      'scope_key',
      'memory_id',
      'semantic',
      'bm25',
      'entity',
      'composite',
      'threshold',
      'drop_reason',
      'created_at',
    ]),
  );

  // composite is nullable — semantic_gate drops carry NULL (EC-6).
  const composite = cols.rows.find((r) => r.column_name === 'composite');
  expect(composite?.is_nullable).toBe('YES');
  // ...but the score components + reason are NOT NULL.
  const semantic = cols.rows.find((r) => r.column_name === 'semantic');
  expect(semantic?.is_nullable).toBe('NO');

  const idx = await db.pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'recall_traces'`,
  );
  const idxNames = idx.rows.map((r) => r.indexname);
  expect(idxNames).toEqual(
    expect.arrayContaining(['recall_traces_recall_id_idx', 'recall_traces_ws_created_idx']),
  );
});
