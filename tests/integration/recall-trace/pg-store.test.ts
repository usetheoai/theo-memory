/**
 * Integration test — PgRecallTraceStore round-trip (explainable-recall T2.1)
 * against real pgvector. record() → getByRecallId() preserves the component
 * breakdown + drop-reason; the row cap is enforced; empty batch is a no-op;
 * unknown id returns []; a semantic_gate row with composite=null reads back as
 * null (EC-6).
 *
 * @see plan explainable-recall § Phase 2 / T2.1
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

let db: IsolatedDb;
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;

beforeAll(async () => {
  db = await createIsolatedDb({ fresh: true, embeddingDim: 384 });
  scopedPool = db.poolPinnedTo('ws-1');
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
});

const batchOf = (recallId: string, n: number) => ({
  recallId,
  workspaceId: 'ws-1',
  scopeKey: 'user:u1',
  rows: Array.from({ length: n }, (_, i) => ({
    memoryId: `m${String(i)}`,
    semantic: 0.4 + i * 0.01,
    bm25: 0.1,
    entity: 0,
    composite: 0.5 as number | null,
    threshold: 0.7,
    dropReason: 'sub_threshold' as const,
  })),
});

test('test_pg_store_record_getbyid_roundtrip — record(3) then getByRecallId returns 3 with breakdown', async () => {
  const store = new PgRecallTraceStore(scopedPool);
  await store.record(batchOf('r-round', 3));

  const got = await store.getByRecallId('r-round', 'ws-1');
  expect(got).toHaveLength(3);
  // Rows of one batch share created_at (single INSERT) and carry random uuid
  // ids, so getByRecallId order is stable-by-id but NOT insertion-order — assert
  // by memoryId lookup, never by position.
  const byId = new Map(got.map((r) => [r.memoryId, r]));
  expect(byId.get('m0')).toMatchObject({
    recallId: 'r-round',
    workspaceId: 'ws-1',
    scopeKey: 'user:u1',
    bm25: 0.1,
    entity: 0,
    threshold: 0.7,
    dropReason: 'sub_threshold',
  });
  expect(byId.get('m0')?.semantic).toBeCloseTo(0.4, 5);
  expect(byId.get('m2')?.semantic).toBeCloseTo(0.42, 5);
  expect(byId.get('m0')?.createdAt).toBeInstanceOf(Date);

  // unknown id → []
  expect(await store.getByRecallId('nope', 'ws-1')).toEqual([]);
});

test('cap: maxRowsPerRecall truncates the persisted rows', async () => {
  const store = new PgRecallTraceStore(scopedPool, { maxRowsPerRecall: 2 });
  await store.record(batchOf('r-cap', 5));
  expect(await store.getByRecallId('r-cap', 'ws-1')).toHaveLength(2);
});

test('empty batch is a no-op (no INSERT)', async () => {
  const store = new PgRecallTraceStore(scopedPool);
  await store.record({ recallId: 'r-empty', workspaceId: 'ws-1', scopeKey: 'user:u1', rows: [] });
  expect(await store.getByRecallId('r-empty', 'ws-1')).toEqual([]);
});

test('test_pg_store_preserves_null_composite — semantic_gate row round-trips as null (EC-6)', async () => {
  const store = new PgRecallTraceStore(scopedPool);
  await store.record({
    recallId: 'r-null',
    workspaceId: 'ws-1',
    scopeKey: 'user:u1',
    rows: [
      {
        memoryId: 'm-null',
        semantic: 0.2,
        bm25: 0,
        entity: 0,
        composite: null,
        threshold: 0.5,
        dropReason: 'semantic_gate',
      },
    ],
  });
  const [row] = await store.getByRecallId('r-null', 'ws-1');
  expect(row?.composite).toBeNull();
  expect(row?.dropReason).toBe('semantic_gate');
});
