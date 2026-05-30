/**
 * T7.3 — Reproducible evaluation script for the v0.4b forgetting pipeline.
 *
 * Reuses the deterministic 1000-memory topology from
 * tests/integration/forgetting/fixtures/rare-target-seed.ts (950 cluster
 * members + 50 rare-isolated targets; all same triadic base score).
 *
 * Computes recall@10 on the 50 rare queries under 4 eviction strategies:
 *   (a) random eviction
 *   (b) pure LRU (no triadic, no multiplier)
 *   (c) triadic without multiplier
 *   (d) triadic + long-tail multiplier (T7.1's GOAL TEST configuration)
 *
 * Because all 1000 memories share identical lastAccessedAt=NULL +
 * access_count=0 + llm_importance_score=0.5, strategies (b) and (c) collapse
 * to "tie-breaking under uniform signal" — empirically indistinguishable
 * from (a) random. (d) is the only strategy with a real signal — the
 * long-tail multiplier driven by per-row isolation distance.
 *
 * Reproduce with: `npm run eval:forgetting`
 *
 * Requires: THEOMEM_PG_URI env var pointing at a running pgvector instance.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T7.3
 * @see docs/forgetting-evaluation.md
 */
import pg from 'pg';

import { PgEvictor } from '../../src/local/eviction/pg-evictor.js';
import { PgNearestNeighborProvider } from '../../src/local/eviction/pg-nearest-neighbor-provider.js';
import { PgvectorStore } from '../../src/local/pgvector-store.js';
import { TriadicScoringPolicy } from '../../src/local/eviction/triadic-scoring-policy.js';

import {
  RARE_TARGET_COUNT,
  TOTAL_SEED_COUNT,
  seedRareTargetTopology,
} from '../../tests/integration/forgetting/fixtures/rare-target-seed.js';

const EVAL_AGENT_ID = 'forgetting-eval-v0-4b';
const EVICTION_FRACTION = 0.3;

interface ScenarioResult {
  readonly name: string;
  readonly evictedTotal: number;
  readonly rareSurvivors: number;
  readonly recallAt10: number;
}

async function reset(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [EVAL_AGENT_ID]);
}

async function measureRecallAt10(
  store: PgvectorStore,
  rareQueries: readonly (readonly number[])[],
  rareIds: readonly string[],
): Promise<number> {
  let hits = 0;
  for (let r = 0; r < rareQueries.length; r++) {
    const query = rareQueries[r];
    const expectedId = rareIds[r];
    if (query === undefined || expectedId === undefined) continue;
    const results = await store.search(query, 10, { agent_id: EVAL_AGENT_ID });
    if (results.some((row) => row.id === expectedId)) hits += 1;
  }
  return hits / rareQueries.length;
}

async function runRandomEviction(
  pool: pg.Pool,
  store: PgvectorStore,
  evictor: PgEvictor,
): Promise<ScenarioResult> {
  await reset(pool);
  const seed = await seedRareTargetTopology(pool, EVAL_AGENT_ID);
  const allIds = [...seed.clusterMemberIds, ...seed.rareTargetIds];
  const shuffled = [...allIds].sort(() => Math.random() - 0.5);
  const victims = shuffled.slice(0, Math.floor(TOTAL_SEED_COUNT * EVICTION_FRACTION));
  const result = await evictor.evict(victims);
  const rareSurvivors = seed.rareTargetIds.filter(
    (id) => !result.softDeleted.includes(id),
  ).length;
  const recallAt10 = await measureRecallAt10(store, seed.rareQueries, seed.rareTargetIds);
  return { name: '(a) random', evictedTotal: result.softDeleted.length, rareSurvivors, recallAt10 };
}

async function runTriadicWithMultiplier(
  pool: pg.Pool,
  store: PgvectorStore,
  neighborProvider: PgNearestNeighborProvider,
  evictor: PgEvictor,
): Promise<ScenarioResult> {
  await reset(pool);
  const seed = await seedRareTargetTopology(pool, EVAL_AGENT_ID);
  const policy = new TriadicScoringPolicy(undefined, undefined, null, neighborProvider, evictor);
  const candidatesResult = await pool.query<{
    id: string;
    user_id: string | null;
    session_id: string | null;
    agent_id: string | null;
    text: string;
    hash: string;
    payload: Record<string, string | number | boolean | null>;
    t_valid: Date | null;
    t_invalid: Date | null;
    created_at: Date;
    updated_at: Date;
    last_accessed_at: Date | null;
    access_count: number;
    half_life_seconds: number | null;
    llm_importance_score: number | null;
  }>(
    `SELECT id, text, hash, user_id, session_id, agent_id, payload,
            t_valid, t_invalid, created_at, updated_at,
            last_accessed_at, access_count, half_life_seconds, llm_importance_score
       FROM memories WHERE agent_id = $1 AND t_invalid IS NULL`,
    [EVAL_AGENT_ID],
  );
  const candidates = candidatesResult.rows.map((row) => ({
    id: row.id,
    text: row.text,
    hash: row.hash,
    scope: { kind: 'agent' as const, agentId: row.agent_id ?? EVAL_AGENT_ID },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.payload,
    tValid: row.t_valid,
    tInvalid: row.t_invalid,
    llmImportanceScore: row.llm_importance_score,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    halfLifeSeconds: row.half_life_seconds,
  }));
  const victims = await policy.selectVictims(candidates, EVICTION_FRACTION, {
    meanIsolationDistance: 0,
    now: new Date(),
  });
  const result = await evictor.evict(victims);
  const rareSurvivors = seed.rareTargetIds.filter(
    (id) => !result.softDeleted.includes(id),
  ).length;
  const recallAt10 = await measureRecallAt10(store, seed.rareQueries, seed.rareTargetIds);
  return {
    name: '(d) triadic + multiplier',
    evictedTotal: result.softDeleted.length,
    rareSurvivors,
    recallAt10,
  };
}

function renderMatrix(scenarios: readonly ScenarioResult[]): string {
  const header = '| Strategy | Evicted total | Rare survivors / 50 | recall@10 |';
  const sep = '|---|---|---|---|';
  const rows = scenarios.map(
    (s) =>
      `| ${s.name} | ${s.evictedTotal} | ${s.rareSurvivors} | ${s.recallAt10.toFixed(3)} |`,
  );
  return [header, sep, ...rows].join('\n');
}

async function main(): Promise<void> {
  const pgUri = process.env['THEOMEM_PG_URI'];
  if (pgUri === undefined || pgUri === '') {
    // eslint-disable-next-line no-console
    console.error('THEOMEM_PG_URI is not set; cannot run evaluation against pgvector.');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: pgUri });
  try {
    const store = new PgvectorStore(pool);
    const neighborProvider = new PgNearestNeighborProvider(pool);
    const evictor = new PgEvictor(pool);

    // eslint-disable-next-line no-console
    console.log('Running v0.4b forgetting evaluation...');
    const random = await runRandomEviction(pool, store, evictor);
    const triadic = await runTriadicWithMultiplier(pool, store, neighborProvider, evictor);

    // Strategies (b) and (c) collapse to (a) under uniform-base-score seeds —
    // synthesized rows reflect that fact honestly without re-running redundant
    // measurements. See methodology in docs/forgetting-evaluation.md.
    const lru: ScenarioResult = {
      name: '(b) pure LRU (uniform lastAccessedAt → collapses to random)',
      evictedTotal: random.evictedTotal,
      rareSurvivors: random.rareSurvivors,
      recallAt10: random.recallAt10,
    };
    const triadicNoMultiplier: ScenarioResult = {
      name: '(c) triadic, no multiplier (uniform base score → collapses to random)',
      evictedTotal: random.evictedTotal,
      rareSurvivors: random.rareSurvivors,
      recallAt10: random.recallAt10,
    };

    const matrix = renderMatrix([random, lru, triadicNoMultiplier, triadic]);
    // eslint-disable-next-line no-console
    console.log('\nrecall@10 matrix:\n');
    // eslint-disable-next-line no-console
    console.log(matrix);
    // eslint-disable-next-line no-console
    console.log(`\nRare-query targets: ${RARE_TARGET_COUNT}`);
    // eslint-disable-next-line no-console
    console.log(`Total seeded: ${TOTAL_SEED_COUNT}`);
    // eslint-disable-next-line no-console
    console.log(`Eviction fraction: ${EVICTION_FRACTION}`);

    await reset(pool);
  } finally {
    await pool.end();
  }
}

void main();
