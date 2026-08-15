/**
 * M15 T3.2 + T3.3 (#122) — the entity boost changes RANKING, and changes nothing else.
 *
 * Against real `ankane/pgvector:v0.5.1`, through the actual retrieval pipeline with the
 * actual pg stores. The two memories are seeded with IDENTICAL embeddings, so their semantic
 * scores tie exactly and the entity link is the only thing that can separate them. Without
 * that control the test would prove nothing — a ranking difference could just be cosine noise.
 *
 * The blueprint recorded that the reference regime asserts set membership and cardinality but never
 * relative order, so there is no prior art to copy here: these assertions are our own design.
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
const USER = 'u-boost';

/**
 * Both relevant candidates are seeded with this vector, so their semantic scores tie exactly
 * and the entity link is the only thing that can separate them.
 */
const CANDIDATE_VEC = ((): number[] => {
  const v = Array(DIM).fill(0) as number[];
  v[0] = 1;
  return v;
})();

/**
 * The query embeds to a vector at cosine 0.9 to CANDIDATE_VEC — semantic HEADROOM below the
 * 1.0 clamp. A saturated 1.0 corpus (the pre-M18 `tiedEmbedder`) ties the linked and unlinked
 * candidates at the clamp once the boost is numerator-only (#127), hiding the fix; 0.9 leaves
 * room for the boost to discriminate AND for the sensitive-threshold eviction test to bite.
 */
const QUERY_VEC = ((): number[] => {
  const v = Array(DIM).fill(0) as number[];
  v[0] = 0.9;
  v[1] = Math.sqrt(1 - 0.81); // 0.4359 → |v|=1, cos(v, e0)=0.9
  return v;
})();

/** Orthogonal to the query — semantic 0, below any threshold. The boost must NOT resurrect it. */
const ORTHOGONAL_VEC = ((): number[] => {
  const v = Array(DIM).fill(0) as number[];
  v[2] = 1;
  return v;
})();

/** The pipeline embeds only the QUERY; candidates are seeded with explicit vectors above. */
const headroomEmbedder: Embedder = {
  embed: async () => QUERY_VEC,
  embedBatch: async (texts) => texts.map(() => QUERY_VEC),
};

let db: IsolatedDb;
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;
let vectorStore: PgvectorStore;
let entityStore: PgMemoryEntityStore;

async function seedMemory(text: string, vec: number[]): Promise<string> {
  const id = randomUUID();
  await scopedPool.query(
    `INSERT INTO memories (id, workspace_id, user_id, text, hash, embedding, payload)
     VALUES ($1, $2, $3, $4, $5, $6::vector, '{}'::jsonb)`,
    [id, WORKSPACE, USER, text, randomUUID(), `[${vec.join(',')}]`],
  );
  return id;
}

/** Reuses the entity row when it already exists — one entity, many linked memories. */
async function linkEntity(memoryId: string, normalizedKey: string): Promise<void> {
  const { rows } = await scopedPool.query<{ id: string }>(
    `INSERT INTO entities (id, workspace_id, user_id, name, embedding, payload, type, normalized_key)
     VALUES ($1, $2, $3, $4, $5::vector, '{}'::jsonb, 'NOUN', $6)
     ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''),
                  COALESCE(agent_id,''), COALESCE(type,''), COALESCE(normalized_key,''))
     DO UPDATE SET name = entities.name
     RETURNING id`,
    [
      randomUUID(),
      WORKSPACE,
      USER,
      normalizedKey.replace(/_/g, ' '),
      `[${Array(DIM).fill(0).join(',')}]`,
      normalizedKey,
    ],
  );
  await scopedPool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)`, [
    memoryId,
    rows[0]?.id,
  ]);
}

/** topK is deliberately far above the corpus so the returned set IS the post-threshold set. */
async function recall(withBoost: boolean, query = 'moro em São Paulo', threshold = 0.1) {
  return runRetrievalPipeline(
    query,
    { user_id: USER, workspace_id: WORKSPACE } as never,
    {
      vectorStore: vectorStore as never,
      embedder: headroomEmbedder,
      ...(withBoost ? { entityBoostStore: entityStore } : {}),
    },
    { topK: 100, threshold },
  );
}

let linkedId = '';
let unlinkedId = '';
let irrelevantLinkedId = '';

beforeAll(async () => {
  db = await createIsolatedDb({ embeddingDim: DIM });
  scopedPool = db.poolPinnedTo('default');
  vectorStore = new PgvectorStore(scopedPool, { embeddingDim: DIM });
  entityStore = new PgMemoryEntityStore(scopedPool);

  // The UNLINKED memory is seeded FIRST on purpose. Postgres' ordering of exactly-tied rows
  // favours the earlier row, so seeding the linked one first would let the test pass on
  // insertion-order luck even with a dead boost. This way the bias runs AGAINST the
  // hypothesis: the linked memory can only win by actually being boosted. Both share
  // CANDIDATE_VEC, so their semantic scores tie at cosine 0.9 (headroom below the clamp).
  unlinkedId = await seedMemory('anotacao sobre a cidade', CANDIDATE_VEC);
  linkedId = await seedMemory('anotacao sobre a cidade', CANDIDATE_VEC);
  await linkEntity(linkedId, 'são_paulo');

  // Semantically far from the query (orthogonal vector) but linked to the same entity —
  // the candidate the boost must NOT resurrect.
  irrelevantLinkedId = await seedMemory('assunto totalmente distinto', ORTHOGONAL_VEC);
  await linkEntity(irrelevantLinkedId, 'são_paulo');
}, 180_000);

afterAll(async () => {
  await db?.dropDb();
});

describe('entity boost ranking', () => {
  test('test_linked_memory_ranks_above_unlinked_equivalent', async () => {
    const results = await recall(true);
    const ids = results.map((r) => r.id);

    expect(ids).toContain(linkedId);
    expect(ids).toContain(unlinkedId);
    expect(ids.indexOf(linkedId)).toBeLessThan(ids.indexOf(unlinkedId));
  });

  test('test_entity_component_is_positive_for_linked_memory', async () => {
    const results = await recall(true);
    const linked = results.find((r) => r.id === linkedId) as { score: number };
    const unlinked = results.find((r) => r.id === unlinkedId) as { score: number };

    // Identical embeddings ⇒ identical semantic and BM25 contributions. Any score gap is
    // the entity component and nothing else.
    expect(linked.score).toBeGreaterThan(unlinked.score);
  });

  test('test_sub_threshold_candidate_is_not_resurrected_by_boost', async () => {
    // Negative case: the semantic gate runs BEFORE the
    // components are combined, so a candidate that fails it cannot come back through the
    // boost. The test exists so a future refactor cannot invert that order unnoticed.
    const results = await recall(true);

    expect(results.map((r) => r.id)).not.toContain(irrelevantLinkedId);
  });

  test('test_boost_does_not_remove_memory_from_post_threshold_set', async () => {
    // EC-2: measured on the post-threshold set, not the final topK. topK is 100 against a
    // 3-memory corpus, so no truncation happens and the two sets are directly comparable.
    // Measuring after truncation would report churn caused by a SUCCESSFUL promotion —
    // the desired effect — and the target of 0 would be unreachable by construction.
    const withoutBoost = (await recall(false)).map((r) => r.id);
    const withBoost = (await recall(true)).map((r) => r.id);

    expect(withBoost).toEqual(expect.arrayContaining(withoutBoost));
  });

  test('test_high_threshold_does_not_evict_unlinked_candidate', async () => {
    // T2.2 (#127) at the SENSITIVE band. The unlinked candidate's semantic (0.9) clears the
    // 0.8 threshold's semantic gate. Under the PRE-M18 renormalization, activating the entity
    // signal (the linked candidate links são_paulo) inflated the shared denominator to 1.5, so
    // its combined dropped to 0.9/1.5 = 0.6 < 0.8 and it was evicted — purely because ANOTHER
    // candidate was linked. Numerator-only keeps its combined at 0.9/1.0 = 0.9 ≥ 0.8. This test
    // fails against the pre-T2.1 maxPossible and passes after it — churn zero at the band where
    // the eviction was measured (75 in the M15 review).
    const THRESHOLD = 0.8;
    const withoutBoost = (await recall(false, 'moro em São Paulo', THRESHOLD)).map((r) => r.id);
    const withBoost = (await recall(true, 'moro em São Paulo', THRESHOLD)).map((r) => r.id);

    // Baseline: without the entity signal, the unlinked candidate passes at 0.8.
    expect(withoutBoost).toContain(unlinkedId);
    // #127: it is STILL present once the entity signal fires for the linked candidate.
    expect(withBoost).toContain(unlinkedId);
    // No candidate that survived without the boost is dropped by turning it on.
    expect(withBoost).toEqual(expect.arrayContaining(withoutBoost));
  });
});

/**
 * The stage itself, against the real store.
 *
 * `ranking.test.ts` above exercises these functions transitively through the pipeline, but
 * the wiring gate resolves symbols by name and cannot see through the call chain. Naming them
 * here is not gate-appeasement: it adds genuine boundary coverage for the stage in isolation,
 * which the pipeline-level tests do not give — a failure here points at the stage, while a
 * failure above could be anywhere in the nine steps.
 */
describe('computeEntityBoost against the real entity store', () => {
  test('test_stage_returns_positive_boost_for_linked_candidate', async () => {
    const { computeEntityBoost } = await import(
      '../../../packages/core/src/domain/retrieval/entity-boost-step.js'
    );

    const boost = await computeEntityBoost(
      'moro em São Paulo',
      [linkedId, unlinkedId],
      { user_id: USER, workspace_id: WORKSPACE },
      { entityBoostStore: entityStore },
    );

    expect(boost.get(linkedId)).toBeGreaterThan(0);
    // A candidate with no matched entity is ABSENT, not present with zero — that is what
    // keeps `entityBoostById.size > 0` an honest "the signal contributed" predicate.
    expect(boost.has(unlinkedId)).toBe(false);
  });

  test('test_stage_matches_and_counts_query_entities', async () => {
    const { matchEntityKeysInQuery, countMatchedEntitiesPerMemory } = await import(
      '../../../packages/core/src/domain/retrieval/entity-query-match.js'
    );
    const { queryLinkedKeysForMemories } = await import(
      '../../../packages/core/src/infrastructure/db/pg-linked-keys.js'
    );

    const linkedKeys = await queryLinkedKeysForMemories(scopedPool, {
      memoryIds: [linkedId],
      filters: { user_id: USER, workspace_id: WORKSPACE },
    });

    expect(matchEntityKeysInQuery('moro em São Paulo', linkedKeys.get(linkedId) ?? [])).toContain(
      'são_paulo',
    );
    expect(countMatchedEntitiesPerMemory('moro em São Paulo', linkedKeys).get(linkedId)).toBe(1);
  });
});
