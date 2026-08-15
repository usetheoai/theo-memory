/**
 * M18 (#127) — the numerator-only boost's influence on ranking is BOUNDED by ENTITY_BOOST_WEIGHT.
 *
 * `/review` (domain-database) flagged that the precision benchmark cannot falsify the domination
 * risk: there the linked memory is always the relevant one, so "boost on ⇒ precision up" holds by
 * construction. Numerator-only makes the boost more influential than the pre-M18 renormalization
 * did — a linked candidate's numerator gains the full boost against an unchanged denominator. This
 * test measures the cross-over against real pgvector: an entity match legitimately promotes a
 * slightly-less-relevant candidate (the feature's intent), but CANNOT resurrect an arbitrarily
 * less-relevant one — the boost caps at W, so it can only overcome a semantic gap up to W.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PgMemoryEntityStore, PgvectorStore } from '@usetheo/memory';
import type { Embedder } from '@usetheo/memory';
import { runRetrievalPipeline } from '../../../packages/core/src/domain/retrieval/pipeline.js';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const DIM = 384;
const WORKSPACE = 'default';
const USER = 'u-dom';

/** A vector at cosine `gamma` to the query vector e0 = [1,0,...]: [gamma, sqrt(1-gamma^2), 0...]. */
function atCosine(gamma: number): number[] {
  const v = Array(DIM).fill(0) as number[];
  v[0] = gamma;
  v[1] = Math.sqrt(1 - gamma * gamma);
  return v;
}

/** The query embeds to e0, so a candidate seeded with atCosine(g) scores semantic = g. */
const queryEmbedder: Embedder = {
  embed: async () => {
    const v = Array(DIM).fill(0) as number[];
    v[0] = 1;
    return v;
  },
  embedBatch: async (texts) => texts.map(() => { const v = Array(DIM).fill(0) as number[]; v[0] = 1; return v; }),
};

let db: IsolatedDb;
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;
let vectorStore: PgvectorStore;
let entityStore: PgMemoryEntityStore;
let highUnlinkedId = '';
let lowLinkedId = '';
let veryLowLinkedId = '';

async function seed(vec: number[]): Promise<string> {
  const id = randomUUID();
  await scopedPool.query(
    `INSERT INTO memories (id, workspace_id, user_id, text, hash, embedding, payload)
     VALUES ($1, $2, $3, $4, $5, $6::vector, '{}'::jsonb)`,
    [id, WORKSPACE, USER, 'anotacao neutra sem sobreposicao lexical', randomUUID(), `[${vec.join(',')}]`],
  );
  return id;
}

async function linkSaoPaulo(memoryId: string): Promise<void> {
  const { rows } = await scopedPool.query<{ id: string }>(
    `INSERT INTO entities (id, workspace_id, user_id, name, embedding, payload, type, normalized_key)
     VALUES ($1, $2, $3, 'sao paulo', $4::vector, '{}'::jsonb, 'NOUN', 'são_paulo')
     ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''),
                  COALESCE(agent_id,''), COALESCE(type,''), COALESCE(normalized_key,''))
     DO UPDATE SET name = entities.name RETURNING id`,
    [randomUUID(), WORKSPACE, USER, `[${Array(DIM).fill(0).join(',')}]`],
  );
  await scopedPool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)`, [
    memoryId,
    rows[0]?.id,
  ]);
}

async function rankedIds(): Promise<string[]> {
  const results = await runRetrievalPipeline(
    'moro em São Paulo',
    { user_id: USER, workspace_id: WORKSPACE } as never,
    { vectorStore: vectorStore as never, embedder: queryEmbedder, entityBoostStore: entityStore },
    { topK: 100, threshold: 0.1 },
  );
  return results.map((r) => r.id);
}

beforeAll(async () => {
  db = await createIsolatedDb({ embeddingDim: DIM });
  scopedPool = db.poolPinnedTo('default');
  vectorStore = new PgvectorStore(scopedPool, { embeddingDim: DIM });
  entityStore = new PgMemoryEntityStore(scopedPool);
  await scopedPool.query(`INSERT INTO workspaces (id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [WORKSPACE]);

  // Semantic 0.9, no entity link — the strong-but-unlinked candidate the boost competes against.
  highUnlinkedId = await seed(atCosine(0.9));
  // Semantic 0.6, linked. Gap to highUnlinked is 0.3 < W(0.5): boost SHOULD let it leapfrog.
  lowLinkedId = await seed(atCosine(0.6));
  await linkSaoPaulo(lowLinkedId);
  // Semantic 0.3, linked. Gap is 0.6 > W: boost is capped at W and CANNOT resurrect it.
  veryLowLinkedId = await seed(atCosine(0.3));
  await linkSaoPaulo(veryLowLinkedId);
}, 180_000);

afterAll(async () => {
  await db?.dropDb();
});

describe('entity boost domination is bounded by ENTITY_BOOST_WEIGHT (#127)', () => {
  test('a linked candidate leapfrogs an unlinked one within the boost margin (design intent)', async () => {
    const ids = await rankedIds();
    // 0.6 + entityBoost(1)=0.4 -> 1.0 (clamped) > 0.9: the entity match legitimately wins.
    expect(ids.indexOf(lowLinkedId)).toBeLessThan(ids.indexOf(highUnlinkedId));
  });

  test('the boost CANNOT resurrect a candidate beyond the boost margin (bounded domination)', async () => {
    const ids = await rankedIds();
    // 0.3 + 0.4 = 0.7 < 0.9: the boost caps at W, so a large semantic gap still wins.
    expect(ids).toContain(veryLowLinkedId); // it survives the threshold...
    expect(ids.indexOf(highUnlinkedId)).toBeLessThan(ids.indexOf(veryLowLinkedId)); // ...but ranks below.
  });
});
