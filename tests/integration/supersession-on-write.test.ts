/**
 * Supersession on write through createLocalMemory over real Postgres (ADR-0029): the replaced
 * memory leaves current recall, `asOf` before the change still finds it, its row keeps
 * `t_invalid` at the new observation time, and `history` records the replacement.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { drizzle } from 'drizzle-orm/node-postgres';

import { createLocalMemory, DrizzleHistoryManager, MAX_EMBEDDING_DIM, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';

import { withWorkspaceScope } from '../../packages/core/src/infrastructure/db/workspace-scope.js';
import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const vector = (): number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };
const residenceLlm: LLM = {
  generateResponse: (messages) => {
    const system = messages[0]?.content ?? '';
    // The update judge (ADR-0036) is asked about each pair; two residence notes are an update.
    if (system.startsWith('You compare two notes')) {
      const residences = ((messages[1]?.content ?? '').match(/lives in/g) ?? []).length;
      return Promise.resolve({ reasoning: 'test', verdict: residences === 2 ? 'replaces' : 'both' });
    }
    const lisbon = system.slice(system.lastIndexOf('## New Messages')).includes('Lisbon');
    return Promise.resolve({ memory: [{ id: '0', text: lisbon ? 'user lives in Lisbon' : 'user lives in Porto' }] });
  },
  generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
};

describe.skipIf(PG_URI === undefined || PG_URI === '')('supersession on write over Postgres', () => {
  let db: IsolatedDb;
  let memory: Memory;

  beforeAll(async () => {
    vi.stubEnv('THEMEMORY_API_KEY', undefined);
    db = await createIsolatedDb();
    const pool = db.poolPinnedTo('default');
    memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm: residenceLlm, embeddingDim: MAX_EMBEDDING_DIM,
      historyManager: new DrizzleHistoryManager(drizzle(pool)) });
  }, 30_000);
  afterAll(async () => { vi.unstubAllEnvs(); await db.dropDb(); });
  beforeEach(async () => { await db.setupPool.query('TRUNCATE memory_messages, memories, history RESTART IDENTITY CASCADE'); });

  test('the replaced memory leaves current recall and is kept, audited, for earlier reads', async () => {
    const [porto] = await memory.user('anna').remember('I live in Porto', { observedAt: new Date('2023-01-01T00:00:00Z') });
    const [lisbon] = await memory.user('anna').remember('I moved to Lisbon', { observedAt: new Date('2024-03-01T00:00:00Z') });
    expect(lisbon?.supersedes).toEqual([porto!.id]);

    const current = await memory.user('anna').recall('where does the user live', { threshold: 0 });
    expect(current.map((m) => m.text)).toEqual(['user lives in Lisbon']);
    const before = await memory.user('anna').recall('where does the user live', { threshold: 0, asOf: new Date('2023-06-01T00:00:00Z') });
    expect(before.map((m) => m.text)).toEqual(['user lives in Porto']);

    const { rows } = await db.setupPool.query<{ t_invalid: Date }>('SELECT t_invalid FROM memories WHERE id = $1', [porto!.id]);
    expect(rows[0]?.t_invalid.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    const history = await withWorkspaceScope('default', () => memory.history(porto!.id));
    expect(history).toContainEqual(expect.objectContaining({ action: 'supersede', previousValue: 'user lives in Porto', newValue: 'user lives in Lisbon' }));
  });
});
