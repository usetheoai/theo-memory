/**
 * THE GOAL TEST — explainable-recall S1 (plan § Goal / Final Phase).
 *
 * With `createLocalMemory({ recallTrace: {} })` against real pgvector: a recall
 * that drops ≥1 candidate writes the matching `recall_traces` rows, retrievable
 * by the (server-minted) `recall_id`; a recall that drops 0 rows writes 0; and
 * a memory built WITHOUT `recallTrace` writes nothing.
 *
 * @see plan explainable-recall § Phase 4 / T4.1 + § Final Phase
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';
import { PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const DIM = 3;

// Crafted embeddings: 'far…' is orthogonal to the query/match direction, so a
// recall of 'match' scores it ~0 (semantic_gate below any threshold > 0).
function vec(t: string): number[] {
  return t.toLowerCase().includes('far') ? [0, 1, 0] : [1, 0, 0];
}
const embedder: Embedder = {
  embed: async (t: string) => vec(t),
  embedBatch: async (ts: readonly string[]) => ts.map(vec),
};
const llm: LLM = {
  generateResponse: async (messages: readonly { role: string; content: string }[]) => {
    const content = messages.find((m) => m.role === 'user')?.content ?? '';
    const line = content.split('\n').find((l) => l.startsWith('user: ')) ?? '';
    const text = line.replace(/^user:\s*/, '') || 'fact';
    return { memory: [{ id: '0', text, attributed_to: 'user' }] };
  },
  generateChat: async () => ({ role: 'assistant' as const, content: '' }),
};

let db: IsolatedDb;
/** Atravessa workspaces de propósito — ver `_helpers/isolated-db.ts`. */
let crossingPool: pg.Pool;
let onMemory: Memory; // recallTrace: {} (default pg impl)
let offMemory: Memory; // no recallTrace
let farId: string;

async function traceCount(): Promise<number> {
  const { rows } = await crossingPool.query<{ n: string }>('SELECT COUNT(*)::int AS n FROM recall_traces');
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  db = await createIsolatedDb({ fresh: true, embeddingDim: DIM });
  crossingPool = db.crossWorkspacePool('semeia mais de um workspace para provar o filtro do store');
  const vectorStore = new PgvectorStore(crossingPool, { embeddingDim: DIM });
  await vectorStore.initialize();

  onMemory = await createLocalMemory({ vectorStore, embedder, embeddingDim: DIM, llm, recallTrace: {} });
  offMemory = await createLocalMemory({ vectorStore, embedder, embeddingDim: DIM, llm });

  await onMemory.user('alice').remember('match here');
  const far = await onMemory.user('alice').remember('far apart');
  farId = far[0]?.id ?? '';
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
});

test('GOAL — recall dropping ≥1 candidate writes recall_traces rows retrievable by recall_id', async () => {
  const before = await traceCount();
  const results = await onMemory.user('alice').recall('match', { threshold: 0.5, topK: 10 });
  // Bare-array contract intact + the near memory is kept, the far one dropped.
  expect(results.some((r) => r.text.includes('match'))).toBe(true);

  expect(await traceCount()).toBeGreaterThan(before);

  // Find the trace row for the dropped `far` memory, then prove it is
  // retrievable by its recall_id via the default store.
  const { rows } = await crossingPool.query<{ recall_id: string; drop_reason: string; composite: number | null }>(
    `SELECT recall_id, drop_reason, composite FROM recall_traces WHERE memory_id = $1`,
    [farId],
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]?.drop_reason).toBe('semantic_gate');
  expect(rows[0]?.composite).toBeNull(); // EC-6

  const store = new PgRecallTraceStore(crossingPool);
  const trace = await store.getByRecallId(rows[0]!.recall_id, 'default');
  expect(trace.some((r) => r.memoryId === farId && r.dropReason === 'semantic_gate')).toBe(true);
});

test('T1.1 — a supplied RecallOptions.recallId keys the trace rows verbatim', async () => {
  const fixed = 'fixed-recall-id-t1-0001';
  await onMemory.user('alice').recall('match', { threshold: 0.5, topK: 10, recallId: fixed });
  const { rows } = await crossingPool.query<{ n: string }>(
    'SELECT COUNT(*)::int AS n FROM recall_traces WHERE recall_id = $1',
    [fixed],
  );
  // The dropped `far` candidate's row must carry the caller-supplied id, not a minted UUID.
  expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0);
});

test('T1.1/D1 — recall() returns the SAME array with vs without a supplied recallId', async () => {
  const withId = await onMemory
    .user('alice')
    .recall('match', { threshold: 0.5, topK: 10, recallId: 'd1-check-id' });
  const without = await onMemory.user('alice').recall('match', { threshold: 0.5, topK: 10 });
  // D1 invariant: recallId is an INPUT; the returned bare array is unchanged.
  expect(withId.map((r) => r.id)).toEqual(without.map((r) => r.id));
});

test('T1.1 — an empty-string recallId is treated as absent (minted UUID, never keyed by "")', async () => {
  await onMemory.user('alice').recall('match', { threshold: 0.5, topK: 10, recallId: '' });
  const { rows } = await crossingPool.query<{ n: string }>(
    "SELECT COUNT(*)::int AS n FROM recall_traces WHERE recall_id = ''",
  );
  expect(Number(rows[0]?.n ?? 0)).toBe(0);
});

test('T3.1 — getByRecallId is workspace-scoped: no cross-tenant read (CWE-441)', async () => {
  const store = new PgRecallTraceStore(crossingPool);
  await store.record({
    recallId: 'ws-scoped-1',
    workspaceId: 'wsA',
    scopeKey: 'user:u',
    rows: [
      { memoryId: 'mx', semantic: 0.1, bm25: 0, entity: 0, composite: 0.1, threshold: 0.5, dropReason: 'sub_threshold' },
    ],
  });
  // Another workspace CANNOT read the trace (fail-closed) …
  expect(await store.getByRecallId('ws-scoped-1', 'wsB')).toEqual([]);
  // … while the owning workspace can.
  expect((await store.getByRecallId('ws-scoped-1', 'wsA')).length).toBe(1);
});

test('GOAL — a recall dropping 0 candidates writes 0 new rows', async () => {
  const before = await traceCount();
  await onMemory.user('alice').recall('match', { threshold: 0, topK: 10 }); // threshold 0 → nothing drops
  expect(await traceCount()).toBe(before);
});

test('T2.1 — an opted-out workspace writes 0 trace rows (fail-closed, M4)', async () => {
  const vectorStore = new PgvectorStore(crossingPool, { embeddingDim: DIM });
  const disabledMem = await createLocalMemory({
    vectorStore,
    embedder,
    embeddingDim: DIM,
    llm,
    recallTrace: { disabledWorkspaces: ['default'] }, // the unbound default workspace is opted out
  });
  await disabledMem.user('bob').remember('match here');
  await disabledMem.user('bob').remember('far apart');
  const before = await traceCount();
  await disabledMem.user('bob').recall('match', { threshold: 0.5, topK: 10 });
  // the recall drops `far`, but the workspace is opted out → the write gate returns no context.
  expect(await traceCount()).toBe(before);
});

test('GOAL — tracing OFF (no recallTrace) writes nothing', async () => {
  const before = await traceCount();
  await offMemory.user('alice').recall('match', { threshold: 0.5, topK: 10 });
  expect(await traceCount()).toBe(before);
});

test('test_factory_rejects_invalid_config_fast — maxRowsPerRecall 0 throws at createLocalMemory (EC-1)', async () => {
  const vs = new PgvectorStore(crossingPool, { embeddingDim: DIM });
  await expect(
    createLocalMemory({ vectorStore: vs, embedder, embeddingDim: DIM, llm, recallTrace: { maxRowsPerRecall: 0 } }),
  ).rejects.toThrow(/maxRowsPerRecall/);
});

test('test_resolve_throws_when_table_absent — missing recall_traces fails fast, not silent (EC-3)', async () => {
  const iso = await createIsolatedDb({ fresh: true, embeddingDim: DIM });
  try {
    await iso.setupPool.query('DROP TABLE recall_traces');
    const vs = new PgvectorStore(iso.pool, { embeddingDim: DIM });
    await expect(
      createLocalMemory({ vectorStore: vs, embedder, embeddingDim: DIM, llm, recallTrace: {} }),
    ).rejects.toThrow(/recall_traces table not found/);
  } finally {
    await iso.dropDb();
  }
}, 60_000);
