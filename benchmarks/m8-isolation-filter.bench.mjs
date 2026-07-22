/**
 * M8 T4.3 — isolation-filter latency benchmark.
 *
 * Measures the `(workspace_id, user_id, session_id)` isolation filter latency WITH
 * vs WITHOUT the composite index `memories_ws_user_session_idx` (migration 0024),
 * on a table seeded with N rows across many users in one workspace. Reports mean ±
 * stddev over R runs per arm and the speedup, plus the EXPLAIN plan node per arm.
 *
 * Usage: THEOMEM_PG_URI=postgres://... node benchmarks/m8-isolation-filter.bench.mjs
 * (the DB must be migrated — the index exists; the bench drops+recreates it per arm).
 */
import pg from 'pg';

const PG_URI = process.env.THEOMEM_PG_URI;
if (!PG_URI) {
  console.error('SKIP: THEOMEM_PG_URI not set');
  process.exit(0);
}

const N = Number(process.env.BENCH_ROWS ?? 20000);
const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const USERS = 200; // rows spread across 200 users in one workspace
const WS = 'tn-bench';
const DIM = 1536;

const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

function stats(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean_ms: +mean.toFixed(3), stddev_ms: +Math.sqrt(variance).toFixed(3), runs: xs.length };
}

async function seed() {
  await pool.query('TRUNCATE memories RESTART IDENTITY CASCADE');
  const emb = `[${Array.from({ length: DIM }, () => 0.1).join(',')}]`;
  // Bulk insert N rows across USERS users, each with a session.
  const batch = 1000;
  for (let off = 0; off < N; off += batch) {
    const vals = [];
    const params = [];
    let p = 1;
    for (let i = 0; i < batch && off + i < N; i++) {
      const u = `u${(off + i) % USERS}`;
      const s = `s${(off + i) % (USERS * 4)}`;
      vals.push(`($${p++},$${p++},$${p++}::vector,$${p++},$${p++},$${p++},$${p++})`);
      params.push(`fact ${off + i}`, `h${off + i}`, emb, JSON.stringify({ text: `fact ${off + i}` }), u, s, WS);
    }
    await pool.query(
      `INSERT INTO memories (text, hash, embedding, payload, user_id, session_id, workspace_id) VALUES ${vals.join(',')}`,
      params,
    );
  }
}

async function timeFilter() {
  // The exact isolation filter a scoped recall/list issues.
  const sql = `SELECT id FROM memories WHERE workspace_id=$1 AND user_id=$2 AND session_id=$3 AND t_invalid IS NULL`;
  const args = [WS, 'u7', 's7'];
  // warm
  await pool.query(sql, args);
  const times = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = process.hrtime.bigint();
    await pool.query(sql, args);
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  const [{ 'QUERY PLAN': plan }] = (
    await pool.query(`EXPLAIN ${sql}`, args)
  ).rows;
  return { stats: stats(times), plan };
}

async function main() {
  console.error(`Seeding ${N} rows across ${USERS} users in workspace ${WS} ...`);
  await seed();

  // Arm 1: WITH the composite index (migration 0024 already created it).
  await pool.query('CREATE INDEX IF NOT EXISTS memories_ws_user_session_idx ON memories USING btree (workspace_id,user_id,session_id) WHERE t_invalid IS NULL');
  await pool.query('ANALYZE memories');
  const withIdx = await timeFilter();

  // Arm 2: WITHOUT the composite index (drop it; single-column indexes remain).
  await pool.query('DROP INDEX IF EXISTS memories_ws_user_session_idx');
  await pool.query('ANALYZE memories');
  const withoutIdx = await timeFilter();

  // Restore the index (leave the DB as migrations expect).
  await pool.query('CREATE INDEX IF NOT EXISTS memories_ws_user_session_idx ON memories USING btree (workspace_id,user_id,session_id) WHERE t_invalid IS NULL');

  const speedup = +(withoutIdx.stats.mean_ms / withIdx.stats.mean_ms).toFixed(2);
  const report = {
    benchmark: 'm8-isolation-filter',
    rows: N,
    users: USERS,
    runs_per_arm: RUNS,
    with_index: { ...withIdx.stats, plan_node: withIdx.plan.split('\n')[0].trim() },
    without_index: { ...withoutIdx.stats, plan_node: withoutIdx.plan.split('\n')[0].trim() },
    speedup_x: speedup,
    verdict: withIdx.stats.mean_ms < withoutIdx.stats.mean_ms ? 'PASS: composite index is faster' : 'FAIL',
  };
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
