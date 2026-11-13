/**
 * M15 T2.2 (#122) — `linkedKeysForMemories` against real `ankane/pgvector:v0.5.1`.
 *
 * The unit layer cannot prove any of this: that the join reaches the right rows, that a
 * foreign workspace is excluded, that an empty id list never reaches the pool, and — the
 * one that matters most for the hot read path — that the whole candidate batch costs ONE
 * query rather than one per candidate.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PgMemoryEntityStore } from '@usetheo/memory';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const WORKSPACE = 'default';
const OTHER_WORKSPACE = 'other-workspace';

let db: IsolatedDb;
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;
let store: PgMemoryEntityStore;

/** Seeds one memory plus one entity linked to it, and returns the memory id. */
async function seedLinkedMemory(
  pool: pg.Pool,
  opts: { workspaceId: string; normalizedKey: string },
): Promise<string> {
  const memoryId = randomUUID();
  const entityId = randomUUID();
  await pool.query(
    `INSERT INTO memories (id, workspace_id, text, hash, embedding, payload)
     VALUES ($1, $2, $3, $4, $5::vector, '{}'::jsonb)`,
    [
      memoryId,
      opts.workspaceId,
      `memory for ${opts.normalizedKey}`,
      randomUUID(),
      `[${Array(384).fill(0).join(',')}]`,
    ],
  );
  await pool.query(
    `INSERT INTO entities (id, workspace_id, name, embedding, payload, type, normalized_key)
     VALUES ($1, $2, $3, $4::vector, '{}'::jsonb, 'NOUN', $5)`,
    [
      entityId,
      opts.workspaceId,
      opts.normalizedKey.replace(/_/g, ' '),
      `[${Array(384).fill(0).join(',')}]`,
      opts.normalizedKey,
    ],
  );
  await pool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)`, [
    memoryId,
    entityId,
  ]);
  return memoryId;
}

/** Wraps the real pool so a test can assert HOW MANY round-trips a call costs. */
function countingPool(): { pool: pg.Pool; queries: () => number } {
  let queries = 0;
  const pool = {
    query: async (...args: unknown[]) => {
      queries += 1;
      return scopedPool.query(...(args as Parameters<pg.Pool['query']>));
    },
  } as unknown as pg.Pool;
  return { pool, queries: () => queries };
}

beforeAll(async () => {
  db = await createIsolatedDb({ embeddingDim: 384 });
  scopedPool = db.poolPinnedTo('default');
  store = new PgMemoryEntityStore(scopedPool);
}, 180_000);

afterAll(async () => {
  await db?.dropDb();
});

describe('linkedKeysForMemories', () => {
  test('test_returns_linked_keys_for_candidate_memories', async () => {
    const memoryId = await seedLinkedMemory(scopedPool, {
      workspaceId: WORKSPACE,
      normalizedKey: 'paulo',
    });

    const result = await store.linkedKeysForMemories({
      memoryIds: [memoryId],
      filters: { workspace_id: WORKSPACE },
    });

    expect(result.get(memoryId)).toContain('paulo');
  });

  test('test_empty_id_list_does_not_touch_the_pool', async () => {
    const spy = countingPool();

    const result = await new PgMemoryEntityStore(spy.pool).linkedKeysForMemories({
      memoryIds: [],
      filters: { workspace_id: WORKSPACE },
    });

    expect(result.size).toBe(0);
    expect(spy.queries()).toBe(0);
  });

  test('test_foreign_workspace_rows_are_not_returned', async () => {
    // A linha estrangeira é semeada pelo pool de travessia: escrevê-la é, por
    // definição, atravessar. O que está sob teste é o filtro do STORE, que roda
    // sobre o pool contido logo abaixo — semear pelo contido seria impossível
    // (a policy recusa) e semear pelo superusuário esconderia que isto é uma
    // travessia.
    const foreignId = await seedLinkedMemory(
      db.crossWorkspacePool('semeia a linha estrangeira que o filtro do store deve ignorar'),
      { workspaceId: OTHER_WORKSPACE, normalizedKey: 'berlim' },
    );

    const result = await store.linkedKeysForMemories({
      memoryIds: [foreignId],
      filters: { workspace_id: WORKSPACE },
    });

    expect(result.has(foreignId)).toBe(false);
  });

  test('test_absent_workspace_resolves_to_default_scope', async () => {
    // EC-4: letting `undefined` reach the SQL comparison would compare against NULL, match
    // nothing, and leave the boost permanently at zero without raising anything.
    const memoryId = await seedLinkedMemory(scopedPool, {
      workspaceId: 'default',
      normalizedKey: 'sao_carlos',
    });

    const result = await store.linkedKeysForMemories({ memoryIds: [memoryId], filters: {} });

    expect(result.get(memoryId)).toContain('sao_carlos');
  });

  test('test_single_query_for_many_candidates', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      ids.push(await seedLinkedMemory(scopedPool, { workspaceId: WORKSPACE, normalizedKey: `ent_${i}` }));
    }

    const spy = countingPool();

    const result = await new PgMemoryEntityStore(spy.pool).linkedKeysForMemories({
      memoryIds: ids,
      filters: { workspace_id: WORKSPACE },
    });

    expect(result.size).toBe(20);
    expect(spy.queries()).toBe(1); // N+1 would be 20 round-trips on the hot read path
  });
});
