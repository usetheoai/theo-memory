/**
 * M18 (#125, #127) — deterministic benchmark for the entity boost. Descends from the M15
 * precision@k benchmark; the corpus now has semantic HEADROOM (query at cosine 0.85, not the
 * saturated 1.0 that ties every candidate at the clamp once the boost is numerator-only) and
 * numLinked-variable monotonicity fixtures.
 *
 * Each topic: one RELEVANT memory linked to the topic's entity + three distractors with the
 * IDENTICAL embedding and no link — so within a topic the semantic signal ties and only the
 * boost can separate them (D2: isolate the boost's contribution; compare the system to itself).
 *
 * Four numbers, per plan T3.1: precision@k off/on; recall_set_churn on the POST-THRESHOLD set
 * (never post-topK — a promotion evicts the last-ranked item, so post-truncation churn would
 * read success as regression); recall_set_churn at the SENSITIVE threshold (0); monotonic
 * violations across numLinked (0). boostedCandidateCount fails the run if the boost never fired.
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
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;
let vectorStore: PgvectorStore;
let entityStore: PgMemoryEntityStore;

/** Relevant memory id per topic index. */
const relevantByTopic = new Map<number, string>();
/** Highest numLinked value exercised by the monotonicity fixtures (#125). */
const MONO_MAX = 6;
/** Memory id whose relevant links exactly N distinct query-matched entities. */
const monoMemoryByN = new Map<number, string>();
/** Deterministic per-topic candidate vector: one hot dimension, so topics never bleed. */
function topicVector(topic: number): number[] {
  const v = Array(DIM).fill(0) as number[];
  v[topic % DIM] = 1;
  return v;
}

/**
 * Shared orthogonal dimension for every query vector — chosen ABOVE the topic range so it
 * never collides with a topic's hot dim (topics use dims 0..TOPICS-1).
 */
const QUERY_ORTHO_DIM = DIM - 1;
const SEMANTIC_HEADROOM = 0.85;

/**
 * The query embeds at cosine SEMANTIC_HEADROOM (0.85) to the topic vector — BELOW the 1.0
 * clamp (M18 / SEPA precondition). The pre-M18 benchmark embedded the query to the topic
 * vector itself (cosine 1.0); once the boost became numerator-only (#127), the relevant and
 * its distractors all clamped to 1.0 and tied, making precision@k a coin-flip and the number
 * vacuous. With 0.85 headroom the boost promotes the linked relevant to min(0.85+boost,1.0)=1.0
 * above the distractors at 0.85 — a real, measured separation.
 */
function queryVector(topic: number): number[] {
  const v = Array(DIM).fill(0) as number[];
  v[topic % DIM] = SEMANTIC_HEADROOM;
  v[QUERY_ORTHO_DIM] = Math.sqrt(1 - SEMANTIC_HEADROOM * SEMANTIC_HEADROOM);
  return v;
}

function topicEmbedder(topic: number): Embedder {
  const vec = queryVector(topic);
  return { embed: async () => vec, embedBatch: async (t) => t.map(() => vec) };
}

async function seed(text: string, vec: number[]): Promise<string> {
  const id = randomUUID();
  await scopedPool.query(
    `INSERT INTO memories (id, workspace_id, user_id, text, hash, embedding, payload)
     VALUES ($1, $2, $3, $4, $5, $6::vector, '{}'::jsonb)`,
    [id, WORKSPACE, USER, text, randomUUID(), `[${vec.join(',')}]`],
  );
  return id;
}

async function link(memoryId: string, key: string): Promise<void> {
  const { rows } = await scopedPool.query<{ id: string }>(
    `INSERT INTO entities (id, workspace_id, user_id, name, embedding, payload, type, normalized_key)
     VALUES ($1, $2, $3, $4, $5::vector, '{}'::jsonb, 'NOUN', $6)
     ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''),
                  COALESCE(agent_id,''), COALESCE(type,''), COALESCE(normalized_key,''))
     DO UPDATE SET name = entities.name
     RETURNING id`,
    [randomUUID(), WORKSPACE, USER, key.replace(/_/g, ' '), `[${Array(DIM).fill(0).join(',')}]`, key],
  );
  await scopedPool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)`, [
    memoryId,
    rows[0]?.id,
  ]);
}

/**
 * Threshold chosen so the renormalization effect CAN bite.
 *
 * With the boost active `maxPossible` grows by ENTITY_BOOST_WEIGHT, so an unlinked candidate
 * at semantic 1.0 goes from 1.0/1.0 to 1.0/1.5 = 0.667. At the pipeline default (0.1) that is
 * still 6.7x above the gate, so churn is structurally guaranteed to be 0 and measures
 * NOTHING — which is what the first version of this benchmark did while claiming to watch the
 * risk that ADR D1 accepted. At 0.8 the drop crosses the gate, so a churn of 0 here is a real
 * observation instead of an arithmetic certainty.
 */
const SENSITIVE_THRESHOLD = 0.8;

async function runQuery(topic: number, withBoost: boolean, threshold = 0.1) {
  return runRetrievalPipeline(
    `o que sabemos sobre entidade ${topic}`,
    { user_id: USER, workspace_id: WORKSPACE } as never,
    {
      vectorStore: vectorStore as never,
      embedder: topicEmbedder(topic),
      ...(withBoost ? { entityBoostStore: entityStore } : {}),
    },
    { topK: 200, threshold },
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
  scopedPool = db.poolPinnedTo('default');
  vectorStore = new PgvectorStore(scopedPool, { embeddingDim: DIM });
  entityStore = new PgMemoryEntityStore(scopedPool);

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

  // Monotonicity fixtures (#125): one memory per numLinked value, each linked to exactly n
  // distinct entities that the corresponding query mentions, so `computeEntityBoost` reads
  // numLinked = n. The M15 corpus linked every relevant to exactly ONE entity, so a decreasing
  // curve was invisible; these expose it.
  for (let n = 1; n <= MONO_MAX; n += 1) {
    // Dedicated dim 200 — no topic (dims 0..24) uses it, so these fixtures stay orthogonal to
    // every topic query and never pollute a topic's candidate pool. Their embedding is irrelevant
    // to the measurement anyway (computeEntityBoost reads only the entity links, not the vector).
    const id = await seed(`nota monotonic com ${n} entidades`, topicVector(200));
    for (let e = 0; e < n; e += 1) {
      await link(id, `mono_${n}_e${e}`);
    }
    monoMemoryByN.set(n, id);
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

    // Churn in the SENSITIVE band, where renormalization can actually remove a candidate.
    let sensitiveChurn = 0;
    for (let topic = 0; topic < TOPICS; topic += 1) {
      const before = new Set((await runQuery(topic, false, SENSITIVE_THRESHOLD)).map((r) => r.id));
      const after = new Set((await runQuery(topic, true, SENSITIVE_THRESHOLD)).map((r) => r.id));
      for (const id of before) if (!after.has(id)) sensitiveChurn += 1;
    }

    // How many candidates the STAGE actually boosted — asked of the stage directly, not
    // inferred from a rank delta between two runs.
    //
    // The first version compared ranks across runs. That could not do its job: the baseline
    // ordering is unstable between runs (tied candidates, decided by Postgres row order), so
    // a completely DEAD boost could still produce a non-zero count out of tie-break noise.
    // The guard meant to prove the signal is alive was itself statistical. Reading the map
    // the stage returns is structural: a dead boost returns an empty map, always.
    const { computeEntityBoost } = await import(
      '../../../packages/core/src/domain/retrieval/entity-boost-step.js'
    );
    let boostedCandidateCount = 0;
    for (let topic = 0; topic < TOPICS; topic += 1) {
      const ids = with_.postThresholdSets[topic] ?? [];
      const boosts = await computeEntityBoost(
        `o que sabemos sobre entidade ${topic}`,
        ids,
        { user_id: USER, workspace_id: WORKSPACE },
        { entityBoostStore: entityStore },
      );
      boostedCandidateCount += [...boosts.values()].filter((b) => b > 0).length;
    }

    // Monotonicity (#125): the boost the STAGE assigns must be non-decreasing in numLinked.
    // Read straight from computeEntityBoost on the mono fixtures — a memory linked to n entities
    // the query mentions. The M15 corpus (numLinked always 1) could not see the regression.
    const boostByNumLinked: number[] = [];
    for (let n = 1; n <= MONO_MAX; n += 1) {
      const query = Array.from({ length: n }, (_, e) => `mono ${n} e${e}`).join(' ');
      const boosts = await computeEntityBoost(
        query,
        [monoMemoryByN.get(n) as string],
        { user_id: USER, workspace_id: WORKSPACE },
        { entityBoostStore: entityStore },
      );
      boostByNumLinked.push(boosts.get(monoMemoryByN.get(n) as string) ?? 0);
    }
    let monotonicViolations = 0;
    for (let i = 1; i < boostByNumLinked.length; i += 1) {
      if ((boostByNumLinked[i] as number) < (boostByNumLinked[i - 1] as number)) monotonicViolations += 1;
    }

    const report = {
      milestone: 'M18',
      issues: [125, 127],
      curve: 'W*n/(n+c)',
      saturationC: 0.25,
      semanticHeadroom: SEMANTIC_HEADROOM,
      corpus: { topics: TOPICS, memoriesPerTopic: DISTRACTORS_PER_TOPIC + 1, monotonicityFixtures: MONO_MAX },
      k: K,
      precisionAtK: { withoutBoost: without.precisionAtK, withBoost: with_.precisionAtK },
      delta: with_.precisionAtK - without.precisionAtK,
      recallSetChurn: churn,
      recallSetChurnSensitive: { threshold: SENSITIVE_THRESHOLD, churn: sensitiveChurn },
      monotonicViolations,
      boostByNumLinked: boostByNumLinked.map((b) => Number(b.toFixed(4))),
      boostedCandidateCount,
      latencyMsPerQuery: {
        withoutBoost: Number((without.elapsedMs / TOPICS).toFixed(2)),
        withBoost: Number((with_.elapsedMs / TOPICS).toFixed(2)),
      },
    };
    mkdirSync('docs/benchmarks', { recursive: true });
    writeFileSync('docs/benchmarks/entity-boost-m18.json', `${JSON.stringify(report, null, 2)}\n`);

    // The boost must not degrade precision — on the headroom corpus it strictly IMPROVES it
    // (the linked relevant is promoted above the tied distractors instead of coin-flipping).
    expect(report.precisionAtK.withBoost).toBeGreaterThanOrEqual(report.precisionAtK.withoutBoost);
    // No memory may fall out of the post-threshold set at the default threshold.
    expect(report.recallSetChurn).toBe(0);
    // #127: numerator-only leaves the denominator identical with and without the boost, so an
    // unlinked candidate's score is invariant to the entity signal and can NEVER be evicted.
    // This is now a structural 0 (was 75 in the M15 review's saturated corpus), so the honest
    // assertion is toBe(0), not the >= 0 the vacuous instrument had to use.
    expect(report.recallSetChurnSensitive.churn).toBe(0);
    // #125: casar mais entidades nunca reduz o reforço, medido através do step.
    expect(report.monotonicViolations).toBe(0);
    // ...and the boost genuinely VARIES with numLinked end-to-end — a numLinked that silently
    // collapsed to a constant would also have zero "decreasing" violations, so `toBe(0)` alone
    // is vacuous. The stage must read a real, rising numLinked (n=6 boost > n=1 boost).
    expect(report.boostByNumLinked[MONO_MAX - 1]).toBeGreaterThan(report.boostByNumLinked[0]);
    // Without this, a dead boost would pass the assertions above trivially.
    expect(report.boostedCandidateCount).toBeGreaterThan(0);
    // Latency is REPORTED, not asserted. `measure(false)` runs first and absorbs cold-cache
    // and warm-up, so the two numbers are not comparable with the rigour an assertion
    // implies — and the benchmark doc itself says to read the ratio, not the milliseconds.
    // A number the documentation tells you not to trust must not gate a build. The bounded
    // cost claim is proven structurally instead, by linked-keys.test.ts (one query for any
    // candidate count) and query-plan.test.ts (index-served at 50k rows).
  }, 600_000);
});
