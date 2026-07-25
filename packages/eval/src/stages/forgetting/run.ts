/**
 * Forgetting eval (migrated from tests/eval/forgetting/run.ts — ADR D6).
 *
 * recall@10 on 50 rare queries under 4 eviction strategies, over the
 * deterministic 1000-memory topology. The eviction machinery is consumed
 * through the PUBLIC `@usetheo/memory` surface (PgEvictor / PgvectorStore /
 * TriadicScoringPolicy / PgNearestNeighborProvider) — the eval is an outer
 * consumer of the library, never an inward dependency (rules/architecture.md).
 *
 * The full run needs a live pgvector (`THEOMEM_PG_URI`); `renderForgettingMatrix`
 * is pure so it is unit-tested DB-free. Reproduce: `pnpm --filter
 * @usetheo/memory-eval run eval:forgetting`.
 */
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import {
  PgEvictor,
  PgNearestNeighborProvider,
  PgvectorStore,
  TriadicScoringPolicy,
} from '@usetheo/memory';

import {
  RARE_TARGET_COUNT,
  TOTAL_SEED_COUNT,
  seedRareTargetTopology,
} from '../../../../../tests/integration/forgetting/fixtures/rare-target-seed.js';

const EVAL_AGENT_ID = 'forgetting-eval-v0-4b';
const EVICTION_FRACTION = 0.3;

export interface ScenarioResult {
  readonly name: string;
  readonly evictedTotal: number;
  readonly rareSurvivors: number;
  readonly recallAt10: number;
}

type SeedTopology = Awaited<ReturnType<typeof seedRareTargetTopology>>;

async function reset(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [EVAL_AGENT_ID]);
}

/** Shared prelude: clear the eval agent's rows and re-seed the topology. */
async function resetAndSeed(pool: pg.Pool): Promise<SeedTopology> {
  await reset(pool);
  return seedRareTargetTopology(pool, EVAL_AGENT_ID);
}

/** Assemble a ScenarioResult from an eviction outcome + a recall measurement. */
function scenarioFrom(
  name: string,
  seed: SeedTopology,
  softDeleted: readonly string[],
  recallAt10: number,
): ScenarioResult {
  const rareSurvivors = seed.rareTargetIds.filter((id) => !softDeleted.includes(id)).length;
  return { name, evictedTotal: softDeleted.length, rareSurvivors, recallAt10 };
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

async function runRandomEviction(pool: pg.Pool, store: PgvectorStore, evictor: PgEvictor): Promise<ScenarioResult> {
  const seed = await resetAndSeed(pool);
  const allIds = [...seed.clusterMemberIds, ...seed.rareTargetIds];
  const { shuffleDeterministic } = await import(
    '../../../../../tests/integration/forgetting/fixtures/deterministic-hash.js'
  );
  const shuffled = shuffleDeterministic(allIds, 0x4b_11_2);
  const victims = shuffled.slice(0, Math.floor(TOTAL_SEED_COUNT * EVICTION_FRACTION));
  const result = await evictor.evict(victims);
  const recallAt10 = await measureRecallAt10(store, seed.rareQueries, seed.rareTargetIds);
  return scenarioFrom('(a) random', seed, result.softDeleted, recallAt10);
}

function toCandidateRow(row: {
  id: string;
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
}) {
  return {
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
  };
}

async function runTriadicWithMultiplier(
  pool: pg.Pool,
  store: PgvectorStore,
  neighborProvider: PgNearestNeighborProvider,
  evictor: PgEvictor,
): Promise<ScenarioResult> {
  const seed = await resetAndSeed(pool);
  const policy = new TriadicScoringPolicy({ neighborProvider, evictor });
  const candidatesResult = await pool.query<Parameters<typeof toCandidateRow>[0]>(
    `SELECT id, text, hash, user_id, session_id, agent_id, payload,
            t_valid, t_invalid, created_at, updated_at,
            last_accessed_at, access_count, half_life_seconds, llm_importance_score
       FROM memories WHERE agent_id = $1 AND t_invalid IS NULL`,
    [EVAL_AGENT_ID],
  );
  const candidates = candidatesResult.rows.map(toCandidateRow);
  const victims = await policy.selectVictims(candidates, EVICTION_FRACTION, {
    meanIsolationDistance: 0,
    now: new Date(),
  });
  const result = await evictor.evict(victims);
  const recallAt10 = await measureRecallAt10(store, seed.rareQueries, seed.rareTargetIds);
  return scenarioFrom('(d) triadic + multiplier', seed, result.softDeleted, recallAt10);
}

/** (b)/(c) collapse to (a) under the uniform-base-score seed — same numbers, new label. */
function relabel(name: string, from: ScenarioResult): ScenarioResult {
  return { ...from, name };
}

/** Pure matrix renderer — DB-free, unit-tested. */
export function renderForgettingMatrix(scenarios: readonly ScenarioResult[]): string {
  const header = '| Strategy | Evicted total | Rare survivors / 50 | recall@10 |';
  const sep = '|---|---|---|---|';
  const rows = scenarios.map(
    (s) => `| ${s.name} | ${s.evictedTotal} | ${s.rareSurvivors} | ${s.recallAt10.toFixed(3)} |`,
  );
  return [header, sep, ...rows].join('\n');
}

async function main(): Promise<void> {
  const pgUri = process.env['THEOMEM_PG_URI'];
  if (pgUri === undefined || pgUri === '') {
    console.error('THEOMEM_PG_URI is not set; cannot run evaluation against pgvector.');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: pgUri });
  try {
    const store = new PgvectorStore(pool);
    const neighborProvider = new PgNearestNeighborProvider(pool);
    const evictor = new PgEvictor(pool);

    console.log('Running forgetting evaluation...');
    const random = await runRandomEviction(pool, store, evictor);
    const triadic = await runTriadicWithMultiplier(pool, store, neighborProvider, evictor);
    const lru = relabel('(b) pure LRU (uniform lastAccessedAt -> collapses to random)', random);
    const triadicNoMultiplier = relabel(
      '(c) triadic, no multiplier (uniform base score -> collapses to random)',
      random,
    );

    console.log('\nrecall@10 matrix:\n');
    console.log(renderForgettingMatrix([random, lru, triadicNoMultiplier, triadic]));
    console.log(`\nRare-query targets: ${String(RARE_TARGET_COUNT)}`);
    console.log(`Total seeded: ${String(TOTAL_SEED_COUNT)}`);
    console.log(`Eviction fraction: ${String(EVICTION_FRACTION)}`);

    await reset(pool);
  } finally {
    await pool.end();
  }
}

// Run only when invoked directly (tsx src/stages/forgetting/run.ts); importing
// the module for unit tests must NOT execute the DB path.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
