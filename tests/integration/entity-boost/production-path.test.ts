/**
 * M15 /review (#122) — the boost through the PUBLIC API, not through the pipeline.
 *
 * Every other M15 test hand-injects `entityBoostStore` straight into
 * `runRetrievalPipeline`, one layer BELOW the glue that decides whether a real consumer
 * gets the boost at all. That glue — `entityBoostDeps` / `sharedPipelineDeps` in
 * `scoped-retrieval.ts` — is the only link between `Memory.recall()` and Step 6, and it had
 * zero coverage: deleting `...entityBoostDeps(ctx)` left the entire suite green while the
 * feature was dead for every consumer. That is #122 one layer up, which is exactly the risk
 * the implementation log named in prose and never asserted.
 *
 * This test goes through `memory.user(id).recall(query)` and nothing else.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createLocalMemory, PgMemoryEntityStore, PgvectorStore } from '@usetheo/memory';
import type { Memory } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const USER = 'u-prod-path';
const WORKSPACE = 'default';

const QUERY = 'moro em São Paulo';

let db: IsolatedDb;
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;
let memory: Memory;
let dim = 0;
let linkedId = '';
let unlinkedId = '';

/** Seeds a memory row directly, so the test does not depend on an LLM for extraction. */
async function seed(text: string, vec: number[]): Promise<string> {
  const id = randomUUID();
  await scopedPool.query(
    `INSERT INTO memories (id, workspace_id, user_id, text, hash, embedding, payload)
     VALUES ($1, $2, $3, $4, $5, $6::vector, '{}'::jsonb)`,
    [id, WORKSPACE, USER, text, randomUUID(), `[${vec.join(',')}]`],
  );
  return id;
}

beforeAll(async () => {
  const embedder = new DeterministicStubEmbedder();
  dim = (await embedder.embed('probe')).length;
  db = await createIsolatedDb({ embeddingDim: dim });
  scopedPool = db.poolPinnedTo('default');

  memory = await createLocalMemory({
    vectorStore: new PgvectorStore(scopedPool, { embeddingDim: dim }),
    embedder,
    memoryEntityStore: new PgMemoryEntityStore(scopedPool),
  });

  // Both memories carry the SAME vector — at cosine 0.9 to the query, NOT the query's own vector.
  // The two therefore tie in semantic (only the entity link can separate them) but sit BELOW the
  // 1.0 clamp: post-M18 the boost is numerator-only, so a saturated 1.0 corpus would tie the
  // linked and unlinked candidates at the clamp and hide the boost (the M18 headroom precondition).
  // 0.9 leaves room for the boost to promote the linked one. The unlinked one is seeded FIRST so
  // insertion-order bias runs against the hypothesis.
  const qv = [...(await embedder.embed(QUERY))];
  const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] as number), 0);
  const aux = qv.map((x, i) => (i === 0 ? x + 1 : x)); // not parallel to qv
  const proj = dot(aux, qv) / dot(qv, qv);
  const orth = aux.map((x, i) => x - proj * (qv[i] as number)); // orthogonal to qv (Gram-Schmidt)
  const qNorm = Math.sqrt(dot(qv, qv));
  const oNorm = Math.sqrt(dot(orth, orth));
  const g = 0.9;
  const vec = qv.map((x, i) => g * (x / qNorm) + Math.sqrt(1 - g * g) * ((orth[i] as number) / oNorm));
  unlinkedId = await seed('anotacao sobre a cidade', vec);
  linkedId = await seed('anotacao sobre a cidade', vec);

  const { rows } = await scopedPool.query<{ id: string }>(
    `INSERT INTO entities (id, workspace_id, user_id, name, embedding, payload, type, normalized_key)
     VALUES ($1, $2, $3, 'são paulo', $4::vector, '{}'::jsonb, 'NOUN', 'são_paulo')
     RETURNING id`,
    [randomUUID(), WORKSPACE, USER, `[${Array(dim).fill(0).join(',')}]`],
  );
  await scopedPool.query('INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)', [
    linkedId,
    rows[0]?.id,
  ]);
}, 300_000);

afterAll(async () => {
  await db?.dropDb();
});

describe('entity boost through the public recall API', () => {
  test('test_boost_reaches_consumer_through_scoped_recall', async () => {
    const results = await memory.user(USER).recall(QUERY, { topK: 10 });
    const ids = results.map((r) => r.id);

    expect(ids).toContain(linkedId);
    expect(ids).toContain(unlinkedId);
    // Removing the entity-boost deps from scoped-retrieval.ts makes this assertion fail —
    // which is the whole point of the test existing at this layer.
    expect(ids.indexOf(linkedId)).toBeLessThan(ids.indexOf(unlinkedId));
  });

  test('test_entity_boost_false_restores_pre_m15_behaviour', async () => {
    // ADR-0023: the flag must govern the READ path too. Shipped in a `fix(recall)` commit
    // that carried no test at all.
    const off = await createLocalMemory({
      vectorStore: new PgvectorStore(scopedPool, { embeddingDim: dim }),
      embedder: new DeterministicStubEmbedder(),
      memoryEntityStore: new PgMemoryEntityStore(scopedPool),
      entityBoost: false,
    });

    const results = await off.user(USER).recall(QUERY, { topK: 10 });
    const scores = results.map((r) => (r as { score: number }).score);

    // With the boost off the two tied memories keep identical scores; with it on they cannot.
    expect(new Set(scores).size).toBe(1);
  });
});
