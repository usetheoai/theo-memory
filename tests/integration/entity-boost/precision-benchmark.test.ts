/**
 * M15 T4.1 (#122) — deterministic precision@k benchmark for the entity boost.
 *
 * ## What this measures, and what it does not
 *
 * Each topic gets one RELEVANT memory linked to the topic's entity, plus three distractors
 * carrying the IDENTICAL embedding and no entity link. The semantic signal therefore cannot
 * discriminate within a topic at all — by construction, every candidate ties.
 *
 * That is deliberate: the plan's D2 asks the benchmark to isolate the boost's contribution.
 * A corpus where the embedding already separates the answer would measure the embedder, and
 * the boost's effect would vanish into the noise.
 *
 * So this reports the boost's discriminating power **when the semantic signal is ambiguous**
 * — the situation the feature exists for. It is NOT a general end-to-end retrieval-quality
 * claim, and it is not comparable to any other system's published numbers. It compares this
 * system against itself, with the feature off and on.
 *
 * Three numbers are produced, per plan D2:
 *   - precision@k without boost / with boost
 *   - recall_set_churn on the POST-THRESHOLD set (never post-topK — a successful promotion
 *     necessarily evicts the last-ranked item, so measuring after truncation would report
 *     the feature's success as a regression and make the target of 0 unreachable)
 *   - boostedCandidateCount, which fails the run if the boost never actually fired
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PgMemoryEntityStore, PgvectorStore } from '@usetheo/memory';
import type { Embedder } from '@usetheo/memory';
import { runRetrievalPipeline } from '../../../packages/core/src/domain/retrieval/pipeline.js';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const DIM = 384;
const WORKSPACE = 'default';
const USER = 'u-bench';
const TOPICS = 25;
const DISTRACTORS_PER_TOPIC = 3;
const K = 1;

let db: IsolatedDb;
let vectorStore: PgvectorStore;
let entityStore: PgMemoryEntityStore;

/** Relevant memory id per topic index. */
const relevantByTopic = new Map<number, string>();
/** Deterministic per-topic vector: one hot dimension, so topics never bleed into each other. */
function topicVector(topic: number): number[] {
  const v = Array(DIM).fill(0) as number[];
  v[topic % DIM] = 1;
  return v;
}

function topicEmbedder(topic: number): Embedder {
  const vec = topicVector(topic);
  return { embed: async () => vec, embedBatch: async (t) => t.map(() => vec) };
}

async function seed(text: string, vec: number[]): Promise<string> {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO memories (id, workspace_id, user_id, text, hash, embedding, payload)
     VALUES ($1, $2, $3, $4, $5, $6::vector, '{}'::jsonb)`,
    [id, WORKSPACE, USER, text, randomUUID(), `[${vec.join(',')}]`],
  );
  return id;
}

async function link(memoryId: string, key: string): Promise<void> {
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO entities (id, workspace_id, user_id, name, embedding, payload, type, normalized_key)
     VALUES ($1, $2, $3, $4, $5::vector, '{}'::jsonb, 'NOUN', $6)
     ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''),
                  COALESCE(agent_id,''), COALESCE(type,''), COALESCE(normalized_key,''))
     DO UPDATE SET name = entities.name
     RETURNING id`,
    [randomUUID(), WORKSPACE, USER, key.replace(/_/g, ' '), `[${Array(DIM).fill(0).join(',')}]`, key],
  );
  await db.pool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)`, [
    memoryId,
    rows[0]?.id,
  ]);
}

async function runQuery(topic: number, withBoost: boolean) {
  return runRetrievalPipeline(
    `o que sabemos sobre entidade ${topic}`,
    { user_id: USER, workspace_id: WORKSPACE } as never,
    {
      vectorStore: vectorStore as never,
      embedder: topicEmbedder(topic),
      ...(withBoost ? { entityBoostStore: entityStore, workspaceId: WORKSPACE } : {}),
    },
    { topK: 200, threshold: 0.1 },
  );
}

interface Measurement {
  precisionAtK: number;
  postThresholdSets: string[][];
  /** Wall-clock ms for the whole query set — the DoD's before/after cost measurement. */
  elapsedMs: number;
}

async function measure(withBoost: boolean): Promise<Measurement> {
  let hits = 0;
  const postThresholdSets: string[][] = [];
  const started = performance.now();
  for (let topic = 0; topic < TOPICS; topic += 1) {
    const results = await runQuery(topic, withBoost);
    const ids = results.map((r) => r.id);
    postThresholdSets.push(ids);
    if (ids.slice(0, K).includes(relevantByTopic.get(topic) as string)) {
      hits += 1;
    }
  }
  return { precisionAtK: hits / TOPICS, postThresholdSets, elapsedMs: performance.now() - started };
}

beforeAll(async () => {
  db = await createIsolatedDb({ embeddingDim: DIM });
  vectorStore = new PgvectorStore(db.pool, { embeddingDim: DIM });
  entityStore = new PgMemoryEntityStore(db.pool);

  for (let topic = 0; topic < TOPICS; topic += 1) {
    const vec = topicVector(topic);
    const relevant = await seed(`nota relevante do topico ${topic}`, vec);
    await link(relevant, `entidade_${topic}`);
    relevantByTopic.set(topic, relevant);
    for (let d = 0; d < DISTRACTORS_PER_TOPIC; d += 1) {
      // Identical embedding, no entity link: the semantic signal cannot tell them apart.
      await seed(`nota distratora ${d} do topico ${topic}`, vec);
    }
  }
}, 300_000);

afterAll(async () => {
  await db?.dropDb();
});

describe('entity boost precision benchmark', () => {
  test('benchmark produces the three numbers and the boost actually fired', async () => {
    const without = await measure(false);
    const with_ = await measure(true);

    // recall_set_churn on the POST-THRESHOLD set (D2 / EC-2).
    let churn = 0;
    for (let i = 0; i < without.postThresholdSets.length; i += 1) {
      const before = new Set(without.postThresholdSets[i]);
      const after = new Set(with_.postThresholdSets[i]);
      for (const id of before) if (!after.has(id)) churn += 1;
    }

    // A candidate is "boosted" when the boost moved the relevant memory to rank 1 where it
    // was not there before; counted across topics so the benchmark cannot pass with a dead
    // boost, which is the defect this whole milestone closes.
    let boostedCandidateCount = 0;
    for (let topic = 0; topic < TOPICS; topic += 1) {
      const rel = relevantByTopic.get(topic) as string;
      const beforeRank = without.postThresholdSets[topic]?.indexOf(rel) ?? -1;
      const afterRank = with_.postThresholdSets[topic]?.indexOf(rel) ?? -1;
      if (afterRank >= 0 && (beforeRank < 0 || afterRank < beforeRank)) boostedCandidateCount += 1;
    }

    const report = {
      milestone: 'M15',
      issue: 122,
      corpus: { topics: TOPICS, memoriesPerTopic: DISTRACTORS_PER_TOPIC + 1, total: TOPICS * (DISTRACTORS_PER_TOPIC + 1) },
      k: K,
      precisionAtK: { withoutBoost: without.precisionAtK, withBoost: with_.precisionAtK },
      delta: with_.precisionAtK - without.precisionAtK,
      recallSetChurn: churn,
      boostedCandidateCount,
      latencyMsPerQuery: {
        withoutBoost: Number((without.elapsedMs / TOPICS).toFixed(2)),
        withBoost: Number((with_.elapsedMs / TOPICS).toFixed(2)),
      },
    };
    mkdirSync('docs/benchmarks', { recursive: true });
    writeFileSync('docs/benchmarks/entity-boost-m15.json', `${JSON.stringify(report, null, 2)}\n`);

    // The boost must not degrade precision.
    expect(report.precisionAtK.withBoost).toBeGreaterThanOrEqual(report.precisionAtK.withoutBoost);
    // No memory may fall out of the post-threshold set.
    expect(report.recallSetChurn).toBe(0);
    // Without this, a dead boost would pass the two assertions above trivially.
    expect(report.boostedCandidateCount).toBeGreaterThan(0);
    // Cost is bounded: the boost adds ONE indexed query over the candidate set, so the
    // per-query cost must stay the same order of magnitude. A blown budget here would mean
    // an N+1 crept back in.
    expect(report.latencyMsPerQuery.withBoost).toBeLessThan(
      report.latencyMsPerQuery.withoutBoost * 3 + 5,
    );
  }, 600_000);
});
