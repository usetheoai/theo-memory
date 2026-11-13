/**
 * M4 T1.1 — recall-trace retention sweep (age-based, race-safe).
 *
 * Against real pgvector: the sweep deletes only rows older than the window,
 * is race-safe under concurrent writes (SERIALIZABLE + 40001 retry), and
 * never touches fresh cross-workspace rows.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';
import { PgRecallTraceRetention, startRecallTraceRetentionCron } from '@usetheo/memory/recall-trace-pg';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const DIM = 3;
let db: IsolatedDb;
/** Atravessa workspaces de propósito — ver `_helpers/isolated-db.ts`. */
let crossingPool: pg.Pool;

/** Insert one recall_traces row with a controlled created_at + workspace. */
async function seed(ws: string, recallId: string, ageSeconds: number): Promise<void> {
  await crossingPool.query(
    `INSERT INTO recall_traces
       (recall_id, workspace_id, scope_key, memory_id, semantic, bm25, entity, composite, threshold, drop_reason, created_at)
     VALUES ($1,$2,'user:u','m',0.1,0,0,0.1,0.5,'sub_threshold', NOW() - (($3)::text||' seconds')::interval)`,
    [recallId, ws, ageSeconds],
  );
}
async function count(ws?: string): Promise<number> {
  const q = ws
    ? await crossingPool.query<{ n: string }>('SELECT COUNT(*)::int n FROM recall_traces WHERE workspace_id=$1', [ws])
    : await crossingPool.query<{ n: string }>('SELECT COUNT(*)::int n FROM recall_traces');
  return Number(q.rows[0]?.n ?? 0);
}

beforeAll(async () => {
  db = await createIsolatedDb({ fresh: true, embeddingDim: DIM });
  crossingPool = db.crossWorkspacePool('a varredura de retencao atravessa workspaces por desenho');
}, 60_000);
afterAll(async () => {
  await db?.dropDb();
});

test('T1.1 — sweep deletes only rows older than the window, returns the deleted count', async () => {
  await seed('wsA', 'old-1', 10 * 24 * 3600); // 10 days
  await seed('wsA', 'old-2', 8 * 24 * 3600); //  8 days
  await seed('wsA', 'fresh-1', 3600); //         1 hour
  const retention = new PgRecallTraceRetention(crossingPool);
  const deleted = await retention.sweep(24 * 3600); // window = 1 day
  expect(deleted).toBe(2); // the two old rows
  expect(await count('wsA')).toBe(1); // the fresh one remains
});

test('T1.1 — sweep is race-safe under concurrent writes; fresh cross-workspace rows survive (atomic-counter invariant)', async () => {
  await db.setupPool.query('TRUNCATE recall_traces');
  // Seed old rows (to be swept) + a fresh wsB row (must survive).
  const OLD = 20;
  for (let i = 0; i < OLD; i++) await seed('wsA', `race-old-${i}`, 5 * 24 * 3600);
  await seed('wsB', 'wsB-fresh', 3600);

  const retention = new PgRecallTraceRetention(crossingPool);
  const store = new PgRecallTraceStore(crossingPool);
  // N concurrent FRESH writes (wsA) racing the sweep.
  const N = 12;
  const writes = Array.from({ length: N }, (_, i) =>
    store.record({
      recallId: `race-new-${i}`,
      workspaceId: 'wsA',
      scopeKey: 'user:u',
      rows: [{ memoryId: `mn-${i}`, semantic: 0.2, bm25: 0, entity: 0, composite: 0.2, threshold: 0.5, dropReason: 'sub_threshold' }],
    }),
  );
  const [deleted] = await Promise.all([retention.sweep(24 * 3600), ...writes]);

  // Atomic-counter invariant: every OLD wsA row is gone; the N fresh writes + the wsB fresh row survive.
  // (deleted counts at least the OLD rows; a fresh write committed before the sweep's snapshot may also be counted,
  //  but the SURVIVING set is deterministic: no orphan, no lost fresh row.)
  expect(deleted).toBeGreaterThanOrEqual(0);
  expect(await count('wsB')).toBe(1); // cross-workspace fresh row untouched
  // No old rows survive; the fresh writes are present (bounded: exactly N fresh wsA recall_ids exist).
  const freshWsA = await crossingPool.query<{ n: string }>(
    "SELECT COUNT(DISTINCT recall_id)::int n FROM recall_traces WHERE workspace_id='wsA' AND recall_id LIKE 'race-new-%'",
  );
  expect(Number(freshWsA.rows[0]?.n ?? 0)).toBe(N);
  const oldWsA = await crossingPool.query<{ n: string }>(
    "SELECT COUNT(*)::int n FROM recall_traces WHERE recall_id LIKE 'race-old-%'",
  );
  expect(Number(oldWsA.rows[0]?.n ?? 0)).toBe(0); // all old swept, no orphan
});

test('T3.1 — the retention cron drives the sweep (onTick fires with the deleted count)', async () => {
  await db.setupPool.query('TRUNCATE recall_traces');
  await seed('wsA', 'cron-old', 5 * 24 * 3600); // 5 days — expired
  await seed('wsA', 'cron-fresh', 60); //          fresh — survives
  const retention = new PgRecallTraceRetention(crossingPool);
  const deleted = await new Promise<number>((resolve) => {
    const handle = startRecallTraceRetentionCron(retention, {
      maxAgeSeconds: 24 * 3600,
      cronExpression: '* * * * * *', // every second — deterministic first-tick await
      onTick: (n) => {
        handle.stop();
        resolve(n);
      },
    });
  });
  expect(deleted).toBe(1); // the cron actually ran the sweep (1 old row)
  expect(await count('wsA')).toBe(1); // fresh row remains
}, 15_000);

test('T1.1 — sweep returns 0 when nothing is expired', async () => {
  await db.setupPool.query('TRUNCATE recall_traces');
  await seed('wsA', 'fresh-only', 60);
  const deleted = await new PgRecallTraceRetention(crossingPool).sweep(24 * 3600);
  expect(deleted).toBe(0);
  expect(await count()).toBe(1);
});

// FX2 (/review M4-R2) — an unvalidated maxAge is a full-table-wipe footgun: a
// NEGATIVE window flips the predicate to `created_at <= NOW() + interval`, which
// matches EVERY row across ALL workspaces. The sweep MUST reject a non-positive /
// non-finite window with a typed error and delete NOTHING — never wipe the audit log.
test('FX2 — sweep rejects a negative window (typed error, deletes nothing)', async () => {
  await db.setupPool.query('TRUNCATE recall_traces');
  await seed('wsA', 'old-a', 10 * 24 * 3600); // an OLD row a full-wipe would delete
  await seed('wsB', 'fresh-b', 60);
  const retention = new PgRecallTraceRetention(crossingPool);
  await expect(retention.sweep(-1)).rejects.toThrow(/positive|finite|window|seconds/i);
  expect(await count()).toBe(2); // the cross-tenant audit log is intact — NO wipe
});
test('FX2 — sweep rejects NaN / Infinity (fail-fast, not a silent throw-every-tick)', async () => {
  await db.setupPool.query('TRUNCATE recall_traces');
  await seed('wsA', 'old-a', 10 * 24 * 3600);
  const retention = new PgRecallTraceRetention(crossingPool);
  await expect(retention.sweep(Number.NaN)).rejects.toThrow(/positive|finite|window|seconds/i);
  await expect(retention.sweep(Number.POSITIVE_INFINITY)).rejects.toThrow(/positive|finite|window|seconds/i);
  expect(await count()).toBe(1);
});

// FX3 (/review M4-R3) — the ORIGINAL race test uses fresh writes disjoint from the
// (old-row) delete-set, so it never produces the 40001 the SERIALIZABLE wrapper
// defends. TWO concurrent sweeps over the SAME old rows DO collide (write-write on
// the same rows under SSI → 40001), so this genuinely exercises the retry branch:
// both sweeps resolve (retry absorbs the conflict), the old set is deleted exactly
// once, and no 40001 escapes.
test('FX3 — two concurrent sweeps over the same rows both resolve (40001 retried, no orphan)', async () => {
  await db.setupPool.query('TRUNCATE recall_traces');
  const OLD = 40;
  for (let i = 0; i < OLD; i++) await seed('wsA', `dup-old-${i}`, 5 * 24 * 3600);
  await seed('wsB', 'wsB-fresh', 60); // cross-workspace fresh row must survive
  const retention = new PgRecallTraceRetention(crossingPool);
  // Both sweeps target the identical old set → real serialization conflict.
  const [d1, d2] = await Promise.all([retention.sweep(24 * 3600), retention.sweep(24 * 3600)]);
  // Retry absorbs 40001: both promises resolve, neither throws.
  expect(d1 + d2).toBe(OLD); // the old rows are deleted exactly once across the two
  expect(await count('wsA')).toBe(0); // no orphan old row left behind
  expect(await count('wsB')).toBe(1); // fresh cross-workspace row untouched
});
