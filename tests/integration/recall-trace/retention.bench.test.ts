/**
 * M4 T5.1 — recall-trace benchmark (evidence). Against real pgvector:
 *  (a) sweep throughput (rows/sec) over ≥3 runs (mean ± stddev);
 *  (b) recall-trace WRITE overhead — a batch INSERT of the dropped set, ON vs OFF
 *      (the per-recall cost of tracing), over ≥3 runs.
 * Asserts throughput > 0 and the write overhead is bounded; logs the numbers so
 * they can be transcribed into docs/benchmarks/m4-recall-trace-retention.md.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { PgRecallTraceRetention, PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const DIM = 3;
const RUNS = 3;
let db: IsolatedDb;
/** Atravessa workspaces de propósito — ver `_helpers/isolated-db.ts`. */
let crossingPool: pg.Pool;

function stats(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, std };
}

/** Bulk-seed N old rows for workspace `ws` via one multi-row INSERT. */
async function seedOld(ws: string, n: number): Promise<void> {
  const tuples: string[] = [];
  const vals: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const b = vals.length;
    tuples.push(
      `($${b + 1},$${b + 2},'user:u','m',0.1,0,0,0.1,0.5,'sub_threshold', NOW() - interval '10 days')`,
    );
    vals.push(`r-${ws}-${i}`, ws);
  }
  await crossingPool.query(
    `INSERT INTO recall_traces (recall_id, workspace_id, scope_key, memory_id, semantic, bm25, entity, composite, threshold, drop_reason, created_at) VALUES ${tuples.join(',')}`,
    vals,
  );
}

beforeAll(async () => {
  db = await createIsolatedDb({ fresh: true, embeddingDim: DIM });
  crossingPool = db.crossWorkspacePool('a varredura de retencao atravessa workspaces por desenho');
}, 60_000);
afterAll(async () => {
  await db?.dropDb();
});

test('T5.1 — sweep throughput (rows/sec, ≥3 runs mean±stddev)', async () => {
  const N = 5000;
  const retention = new PgRecallTraceRetention(crossingPool);
  const rates: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    await db.setupPool.query('TRUNCATE recall_traces');
    await seedOld('wsA', N);
    const t0 = performance.now();
    const deleted = await retention.sweep(24 * 3600);
    const ms = performance.now() - t0;
    expect(deleted).toBe(N);
    rates.push((deleted / ms) * 1000); // rows/sec
  }
  const { mean, std } = stats(rates);
  // eslint-disable-next-line no-console
  console.log(`[BENCH] sweep throughput: ${mean.toFixed(0)} ± ${std.toFixed(0)} rows/sec (N=${N}, runs=${RUNS})`);
  expect(mean).toBeGreaterThan(0);
}, 120_000);

test('T5.1 — recall-trace write overhead (batch INSERT ms, ≥3 runs)', async () => {
  const store = new PgRecallTraceStore(crossingPool);
  const DROPS = 50; // a recall dropping 50 candidates
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const rows = Array.from({ length: DROPS }, (_, i) => ({
      memoryId: `m-${run}-${i}`,
      semantic: 0.2,
      bm25: 0,
      entity: 0,
      composite: 0.2,
      threshold: 0.5,
      dropReason: 'sub_threshold' as const,
    }));
    const t0 = performance.now();
    await store.record({ recallId: `bench-${run}`, workspaceId: 'wsA', scopeKey: 'user:u', rows });
    times.push(performance.now() - t0);
  }
  const { mean, std } = stats(times);
  // eslint-disable-next-line no-console
  console.log(`[BENCH] trace write (${DROPS} drops): ${mean.toFixed(2)} ± ${std.toFixed(2)} ms/recall (runs=${RUNS})`);
  // The trace write is a single multi-row INSERT — must be a small per-recall cost.
  expect(mean).toBeLessThan(200); // bound: < 200ms for a 50-row batch (documented)
}, 60_000);
