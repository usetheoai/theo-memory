/**
 * Importance scoring on write over real Postgres (#238): with `importanceScoring`, a new fact's
 * row holds its [0, 1] importance, the eviction candidate loader reads it, a repeated fact is
 * not rated again, and another user's row with the same text is never touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createLocalMemory, MAX_EMBEDDING_DIM, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, Memory, Message } from '@usetheo/memory';

import { loadCandidates } from '../../packages/core/src/infrastructure/db/eviction/scope-candidate.js';
import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const vector = (): number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };
let ratings = 0;
const llm: LLM = {
  generateResponse: () => Promise.resolve({ memory: [{ id: '0', text: 'user is allergic to peanuts' }] }),
  generateChat: (messages: readonly Message[]) => {
    const rating = /importance rater/.test(messages[0]?.content ?? '');
    if (rating) ratings += 1;
    return Promise.resolve({ role: 'assistant', content: rating ? '10' : '' });
  },
};

describe.skipIf(PG_URI === undefined || PG_URI === '')('importance scoring on write over Postgres', () => {
  let db: IsolatedDb;
  let scoring: Memory;
  let plain: Memory;

  beforeAll(async () => {
    vi.stubEnv('THEMEMORY_API_KEY', undefined);
    db = await createIsolatedDb();
    const pool = db.poolPinnedTo('default');
    const base = { vectorStore: new PgvectorStore(pool), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM };
    scoring = await createLocalMemory({ ...base, importanceScoring: true });
    plain = await createLocalMemory(base);
  }, 30_000);
  afterAll(async () => { vi.unstubAllEnvs(); await db.dropDb(); });
  beforeEach(async () => {
    ratings = 0;
    await db.setupPool.query('TRUNCATE memory_messages, memories, history RESTART IDENTITY CASCADE');
  });

  test('a new fact is stored with its importance and the eviction loader reads it', async () => {
    const [item] = await scoring.user('anna').remember('I am allergic to peanuts');
    expect(item?.llmImportanceScore).toBe(1);
    expect(ratings).toBe(1);
    const client = await db.setupPool.connect();
    try {
      const candidates = await loadCandidates(client, { kind: 'user', userId: 'anna' });
      expect(candidates.map((m) => m.llmImportanceScore)).toEqual([1]);
    } finally {
      client.release();
    }
  });

  test('a repeated fact is not stored or rated again', async () => {
    await scoring.user('anna').remember('I am allergic to peanuts');
    await scoring.user('anna').remember('I am allergic to peanuts');
    const { rows } = await db.setupPool.query<{ n: string }>("SELECT count(*) AS n FROM memories WHERE user_id = 'anna'");
    expect(rows[0]?.n).toBe('1');
    expect(ratings).toBe(1);
  });

  test('scoring one user never writes the same text stored for another user', async () => {
    await plain.user('bruno').remember('I am allergic to peanuts');
    await scoring.user('anna').remember('I am allergic to peanuts');
    const { rows } = await db.setupPool.query<{ user_id: string; llm_importance_score: number | null }>(
      'SELECT user_id, llm_importance_score FROM memories ORDER BY user_id');
    expect(rows).toEqual([
      { user_id: 'anna', llm_importance_score: 1 },
      { user_id: 'bruno', llm_importance_score: null },
    ]);
  });

  test('off by default: no rating and no importance', async () => {
    const [item] = await plain.user('anna').remember('I am allergic to peanuts');
    expect(ratings).toBe(0);
    expect(item?.llmImportanceScore ?? null).toBeNull();
  });
});
