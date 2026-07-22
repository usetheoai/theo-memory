/**
 * M10 T4.2 — scope-aware recall@k benchmark + projection-cost measurement.
 *
 * Two measurements on real pgvector:
 *
 * (1) recall@k — over a fixture where "relevant@k" = the scope-preferred set (recent SESSION
 *     facts ∪ durable GLOBAL facts) and "noise" = stale session ∪ one-off global. All rows share
 *     one embedding so cosine is UNIFORM (semantic can't distinguish) — the ranking is decided
 *     entirely by the scope-aware reweight. Baseline (no reweight) vs scope-aware; recall@k must
 *     not regress (ROADMAP M10 risk #2). Deterministic value; latency mean±stddev over RUNS.
 *
 * (2) projection cost — the T1.1 hot-path change added `created_at` + `confirmation_count` to the
 *     search projection. Times the search SELECT WITH vs WITHOUT those two scalar columns.
 *
 * The reweight formula MIRRORS packages/core/src/domain/retrieval/scope-reweight.ts — keep in sync.
 * The real pipeline wiring is proven separately in tests/integration/recall/scope-aware-ranking.test.ts.
 *
 * Usage: THEOMEM_PG_URI=postgres://... node benchmarks/m10-scope-aware-recall.bench.mjs
 */
import pg from 'pg';

const PG_URI = process.env.THEOMEM_PG_URI;
if (!PG_URI) {
  console.error('SKIP: THEOMEM_PG_URI not set');
  process.exit(0);
}

const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const WS = 'tn-bench-m10';
const USER = 'u-m10';
const SESSION = 's-m10';
const DIM = 1536;
const STABILITY_K = 5; // mirrors scope-reweight.ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const W_SESSION = 0.5;
const W_GLOBAL = 0.5;
const K = 6; // relevant-set size = recall@k cutoff

const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

function stats(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean_ms: +mean.toFixed(3), stddev_ms: +Math.sqrt(variance).toFixed(3), runs: xs.length };
}

// MIRRORS scope-reweight.ts — bounded multiplier score*(1+weight*signal).
function reweightScore(base, row, now) {
  const isSession = row.session_id !== null && row.session_id !== '';
  if (isSession) {
    const ageDays = Math.max(0, (now - new Date(row.created_at).getTime()) / MS_PER_DAY);
    return base * (1 + W_SESSION * (1 / (1 + ageDays)));
  }
  const c = row.confirmation_count ?? 0;
  return base * (1 + W_GLOBAL * (c / (c + STABILITY_K)));
}

async function seed() {
  await pool.query('TRUNCATE memories RESTART IDENTITY CASCADE');
  const emb = `[${Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
  const rows = [];
  // 3 relevant fresh-session (age 0-2d) + 3 relevant durable-global (conf 15-25) = 6 relevant.
  for (let i = 0; i < 3; i++) rows.push({ text: `REL fresh-session ${i}`, session: SESSION, age: i, conf: 1 });
  for (let i = 0; i < 3; i++) rows.push({ text: `REL durable-global ${i}`, session: null, age: 30, conf: 15 + i * 5 });
  // 20 noise stale-session (age 40-90d) + 20 noise one-off-global (conf 1).
  for (let i = 0; i < 20; i++) rows.push({ text: `noise stale-session ${i}`, session: SESSION, age: 40 + i * 2, conf: 1 });
  for (let i = 0; i < 20; i++) rows.push({ text: `noise one-off-global ${i}`, session: null, age: 30, conf: 1 });

  for (const r of rows) {
    const createdAt = new Date(Date.now() - r.age * MS_PER_DAY).toISOString();
    await pool.query(
      `INSERT INTO memories (text, hash, embedding, payload, workspace_id, user_id, session_id, confirmation_count, kind, created_at)
       VALUES ($1,$2,$3::vector,$4::jsonb,$5,$6,$7,$8,'extracted',$9)`,
      [r.text, `h-${r.text}`, emb, JSON.stringify({}), WS, USER, r.session, r.conf, createdAt],
    );
  }
}

// The M8 session∪global union pool for (WS, USER, SESSION).
async function fetchPool() {
  const { rows } = await pool.query(
    `SELECT id, text, session_id, confirmation_count, created_at FROM memories
     WHERE workspace_id=$1 AND user_id=$2 AND (session_id=$3 OR session_id IS NULL) AND t_invalid IS NULL`,
    [WS, USER, SESSION],
  );
  return rows;
}

function isRelevant(text) {
  return text.startsWith('REL ');
}

function recallAtK(orderedTexts) {
  const topK = orderedTexts.slice(0, K);
  const hit = topK.filter(isRelevant).length;
  return +(hit / K).toFixed(3); // relevant set size == K
}

async function measureRecall() {
  const rows = await fetchPool();
  const now = Date.now();
  const base = 1.0; // uniform cosine (all rows share one embedding)

  // Baseline: no reweight — tie-broken deterministically by id (stable insertion order).
  const baseline = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => r.text);
  // Scope-aware: bounded reweight, desc.
  const scoped = [...rows]
    .map((r) => ({ text: r.text, s: reweightScore(base, r, now) }))
    .sort((a, b) => b.s - a.s)
    .map((r) => r.text);

  return { baseline_recall_at_k: recallAtK(baseline), scope_aware_recall_at_k: recallAtK(scoped) };
}

async function measureProjectionCost() {
  const emb = `[${Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
  const filter = `WHERE workspace_id=$2 AND user_id=$3 AND t_invalid IS NULL ORDER BY embedding <=> $1::vector LIMIT 20`;
  const withCols = `SELECT id, text, created_at, confirmation_count FROM memories ${filter}`;
  const withoutCols = `SELECT id, text FROM memories ${filter}`;
  const args = [emb, WS, USER];
  const time = async (sql) => {
    await pool.query(sql, args); // warm
    const t = [];
    for (let r = 0; r < RUNS; r++) {
      const t0 = process.hrtime.bigint();
      await pool.query(sql, args);
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return stats(t);
  };
  return { with_projection: await time(withCols), without_projection: await time(withoutCols) };
}

async function main() {
  console.error(`Seeding fixture (6 relevant + 40 noise) in ${WS} ...`);
  await seed();
  await pool.query('ANALYZE memories');

  const recall = await measureRecall();
  const projection = await measureProjectionCost();
  const deltaMs = +(projection.with_projection.mean_ms - projection.without_projection.mean_ms).toFixed(3);

  const report = {
    benchmark: 'm10-scope-aware-recall',
    k: K,
    relevant_set: 'recent-session ∪ durable-global',
    runs: RUNS,
    recall_at_k: recall,
    recall_delta: +(recall.scope_aware_recall_at_k - recall.baseline_recall_at_k).toFixed(3),
    projection_cost: { ...projection, delta_ms: deltaMs },
    verdict:
      recall.scope_aware_recall_at_k >= recall.baseline_recall_at_k
        ? `PASS: scope-aware recall@${K} does not regress (>= baseline)`
        : `REGRESSION: scope-aware recall@${K} < baseline`,
  };
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
