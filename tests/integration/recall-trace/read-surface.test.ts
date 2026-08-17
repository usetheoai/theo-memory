/**
 * THE GOAL TEST — explainable-recall-read S2 (plan § Final Phase).
 *
 * End-to-end over the REST edge against real pgvector: a POST /v1/recall that
 * drops ≥1 candidate returns a `recall_id`, and GET /v1/recall-traces/{recall_id}
 * returns the dropped candidates with their breakdown; a trace under a DIFFERENT
 * workspace, and an unknown id, both return 404 (no cross-tenant read).
 *
 * @see plan explainable-recall-read § Phase 4 / T4.1
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';
import { PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';
import { createServer } from '@usetheo/memory-api';

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
/** Atravessa workspaces de propósito — ver `_helpers/isolated-db.ts`. */
let crossingPool: pg.Pool;
let memory: Memory;
let store: PgRecallTraceStore;
let app: ReturnType<typeof createServer>;

async function post(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  db = await createIsolatedDb({ fresh: true, embeddingDim: DIM });
  crossingPool = db.crossWorkspacePool('a superficie de leitura e comparada contra um workspace vizinho');
  const vectorStore = new PgvectorStore(crossingPool, { embeddingDim: DIM });
  await vectorStore.initialize();
  memory = await createLocalMemory({ vectorStore, embedder, embeddingDim: DIM, llm, recallTrace: {} });
  store = new PgRecallTraceStore(crossingPool);
  app = createServer({ memory, recallTraceStore: store });
  await memory.user('alice').remember('match here');
  await memory.user('alice').remember('far apart');
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
});

test('GOAL — POST /v1/recall returns a recall_id; GET /v1/recall-traces/{id} returns the drops', async () => {
  const recallRes = await post('/v1/recall', { userId: 'alice', query: 'match', threshold: 0.5, topK: 10 });
  expect(recallRes.status).toBe(200);
  const { recallId } = (await recallRes.json()) as { recallId: string };
  expect(recallId).toMatch(/^[0-9a-f-]{36}$/);

  const traceRes = await app.fetch(new Request(`http://localhost/v1/recall-traces/${recallId}`));
  expect(traceRes.status).toBe(200);
  const body = (await traceRes.json()) as {
    recallId: string;
    drops: { memoryId: string; dropReason: string; semantic: number }[];
  };
  expect(body.recallId).toBe(recallId);
  expect(body.drops.length).toBeGreaterThan(0);
  // the `far` memory was dropped at the semantic gate — the breakdown is present.
  expect(body.drops.some((d) => d.dropReason === 'semantic_gate')).toBe(true);
});

test('GOAL — a trace under ANOTHER workspace returns 404 (no cross-tenant read)', async () => {
  await store.record({
    recallId: 'foreign-ws-trace',
    workspaceId: 'other-ws',
    scopeKey: 'user:x',
    rows: [
      { memoryId: 'mx', semantic: 0.1, bm25: 0, entity: 0, composite: 0.1, threshold: 0.5, dropReason: 'sub_threshold' },
    ],
  });
  // the default-workspace caller (no auth) must NOT read the 'other-ws' trace.
  const res = await app.fetch(new Request('http://localhost/v1/recall-traces/foreign-ws-trace'));
  expect(res.status).toBe(404);
});

test('GOAL — an unknown recall_id returns 404', async () => {
  const res = await app.fetch(new Request('http://localhost/v1/recall-traces/does-not-exist'));
  expect(res.status).toBe(404);
});

test('T4.1 — the route is NOT mounted when recallTraceStore is omitted', async () => {
  const bare = createServer({ memory });
  const res = await bare.fetch(new Request('http://localhost/v1/recall-traces/anything'));
  expect(res.status).toBe(404);
});
