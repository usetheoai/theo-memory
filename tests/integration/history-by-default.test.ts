/**
 * #236 — a Postgres-backed createLocalMemory records the audit trail without being asked:
 * remember and forget write `history` rows by default, and an explicit
 * `historyManager: undefined` turns it off.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type pg from 'pg';

import { createLocalMemory, MAX_EMBEDDING_DIM, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';

import { withWorkspaceScope } from '../../packages/core/src/infrastructure/db/workspace-scope.js';
import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const vector = (): number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };
const llm: LLM = {
  generateResponse: () => Promise.resolve({ memory: [{ id: '0', text: 'user likes tea' }] }),
  generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
};

describe.skipIf(PG_URI === undefined || PG_URI === '')('history by default over Postgres', () => {
  let db: IsolatedDb;
  let pool: pg.Pool;

  beforeAll(async () => {
    vi.stubEnv('THEMEMORY_API_KEY', undefined);
    db = await createIsolatedDb();
    pool = db.poolPinnedTo('default');
  }, 30_000);
  afterAll(async () => { vi.unstubAllEnvs(); await db.dropDb(); });
  beforeEach(async () => { await db.setupPool.query('TRUNCATE memory_messages, memories, history RESTART IDENTITY CASCADE'); });

  test('remember and forget are recorded without configuring a history manager', async () => {
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM });
    const [item] = await memory.user('anna').remember('I like tea');
    await memory.user('anna').forget(item!.id);
    const actions = (await withWorkspaceScope('default', () => memory.history(item!.id))).map((entry) => entry.action);
    expect(actions).toEqual(['forget', 'remember']); // newest first (EC-18)
  });

  test('historyManager: undefined, given explicitly, records nothing', async () => {
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM, historyManager: undefined });
    await memory.user('anna').remember('I like tea');
    const { rows } = await db.setupPool.query<{ n: string }>('SELECT count(*) AS n FROM history');
    expect(rows[0]?.n).toBe('0');
  });
});
