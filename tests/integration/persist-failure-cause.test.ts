/**
 * #231 — a write the database rejects must say why. Writing to a workspace that does not exist
 * violates the workspaces foreign key; the error the caller gets has to carry that cause.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { createLocalMemory, MAX_EMBEDDING_DIM, MemoryStoreError, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';

import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const vector = (): number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };
const llm: LLM = {
  generateResponse: () => Promise.resolve({ memory: [{ id: '0', text: 'user adopted a dog named Biscuit' }] }),
  generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
};

describe.skipIf(PG_URI === undefined || PG_URI === '')('persist failure cause over Postgres', () => {
  let db: IsolatedDb;

  beforeAll(async () => {
    vi.stubEnv('THEMEMORY_API_KEY', undefined);
    db = await createIsolatedDb();
  }, 30_000);
  afterAll(async () => { vi.unstubAllEnvs(); await db.dropDb(); });

  test('a strict write to an unprovisioned workspace fails with the foreign-key violation as its cause', async () => {
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(db.poolPinnedTo('unprovisioned')), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM });
    const write = memory.withWorkspace!('unprovisioned').user('dbg').remember('I adopted a dog named Biscuit.', {
      strictExtraction: true, idempotencyKey: 'dbg-1',
    });
    const error = await write.then(() => null, (err: unknown) => err);
    expect(error).toBeInstanceOf(MemoryStoreError);
    expect((error as Error).cause).toMatchObject({ code: '23503' });
  });

  test('a verbatim write (infer: false) that saves nothing fails with the database cause instead of returning items', async () => {
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(db.poolPinnedTo('unprovisioned')), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM });
    const error = await memory.withWorkspace!('unprovisioned').user('dbg').remember('I adopted a dog named Biscuit.', {
      infer: false, idempotencyKey: 'dbg-2',
    }).then(() => null, (err: unknown) => err);
    expect(error).toBeInstanceOf(MemoryStoreError);
    expect((error as Error).cause).toMatchObject({ code: '23503' });
  });
});
