/**
 * Concurrency obligations — explainable-recall S1 (plan § Concurrency tests).
 *
 * Two race-aware invariants against real pgvector:
 *  1. recall_id uniqueness — 2 concurrent recalls (Promise.all) each mint their
 *     OWN recall_id (the id is minted per-recall in retrieveResults, not shared
 *     per scoped-memory instance).
 *  2. record() atomicity — N concurrent record() calls with DISTINCT recallIds
 *     all persist independently, each retrievable in full with no cross-batch
 *     interleaving (the multi-row INSERT is one statement per call).
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';
import { PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const DIM = 3;
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
/** O papel contido, fixado no workspace do arquivo — ver `_helpers/isolated-db.ts`. */
let scopedPool: pg.Pool;
let memory: Memory;
let farId: string;

beforeAll(async () => {
  db = await createIsolatedDb({ fresh: true, embeddingDim: DIM });
  scopedPool = db.poolPinnedTo('default');
  const vectorStore = new PgvectorStore(scopedPool, { embeddingDim: DIM });
  await vectorStore.initialize();
  memory = await createLocalMemory({ vectorStore, embedder, embeddingDim: DIM, llm, recallTrace: {} });
  await memory.user('alice').remember('match here');
  const far = await memory.user('alice').remember('far apart');
  farId = far[0]?.id ?? '';
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
});

test('concurrent recalls each mint a DISTINCT recall_id (no shared/collided id)', async () => {
  // Two recalls in parallel, each drops `far` → each writes a trace row for it.
  await Promise.all([
    memory.user('alice').recall('match', { threshold: 0.5, topK: 10 }),
    memory.user('alice').recall('match', { threshold: 0.5, topK: 10 }),
  ]);
  const { rows } = await scopedPool.query<{ recall_id: string }>(
    `SELECT DISTINCT recall_id FROM recall_traces WHERE memory_id = $1`,
    [farId],
  );
  // ≥ 2 distinct recall_ids — the two concurrent recalls did NOT share one id.
  expect(rows.length).toBeGreaterThanOrEqual(2);
});

test('N concurrent record() calls with distinct recallIds all persist independently (atomic)', async () => {
  const store = new PgRecallTraceStore(scopedPool);
  const N = 8;
  const ids = Array.from({ length: N }, (_, i) => `rc-${i}`);
  await Promise.all(
    ids.map((recallId, i) =>
      store.record({
        recallId,
        workspaceId: 'default',
        scopeKey: 'user:alice',
        rows: [
          { memoryId: `m-${i}-a`, semantic: 0.1, bm25: 0, entity: 0, composite: 0.1, threshold: 0.5, dropReason: 'sub_threshold' },
          { memoryId: `m-${i}-b`, semantic: 0.2, bm25: 0, entity: 0, composite: null, threshold: 0.5, dropReason: 'semantic_gate' },
        ],
      }),
    ),
  );
  // Each recallId retrieves EXACTLY its own 2 rows — no interleaving/loss.
  const traces = await Promise.all(ids.map((id) => store.getByRecallId(id, 'default')));
  for (let i = 0; i < N; i++) {
    const t = traces[i]!;
    expect(t).toHaveLength(2);
    expect(new Set(t.map((r) => r.memoryId))).toEqual(new Set([`m-${i}-a`, `m-${i}-b`]));
  }
}, 30_000);
