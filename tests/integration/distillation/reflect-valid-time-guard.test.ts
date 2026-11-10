/**
 * #237 over real Postgres: `LlmJudgedMergeConflictPolicy` judges which memory is older by when
 * it became true (`t_valid`, set by `observedAt`), not by when it was imported. The two memories
 * are imported in the opposite order of their valid times, so a guard reading `created_at` would
 * give the opposite outcome.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createLocalMemory, LlmJudgedMergeConflictPolicy, MAX_EMBEDDING_DIM, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, LLMResponse, Memory } from '@usetheo/memory';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const vector = (): number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };
/** Reflection drafts nothing, so only the conflict policy acts. */
const noDrafts: LLM = {
  generateResponse: () => Promise.resolve('[]'),
  generateChat: (): Promise<LLMResponse> => Promise.resolve({ role: 'assistant', content: '[]' }),
};
const judge = (keep: () => string, reject: () => string): LLM => ({
  generateResponse: () => Promise.resolve({ kept_id: keep(), rejected_ids: [reject()], reason: 'the rejected one is an older version' }),
  generateChat: (): Promise<LLMResponse> => Promise.resolve({ role: 'assistant', content: '' }),
});

describe.skipIf(PG_URI === undefined || PG_URI === '')('reflect conflict resolution valid-time guard over Postgres', () => {
  let db: IsolatedDb;
  let memory: Memory;
  let july = '';
  let january = '';

  beforeAll(async () => {
    vi.stubEnv('THEMEMORY_API_KEY', undefined);
    db = await createIsolatedDb();
    memory = await createLocalMemory({ vectorStore: new PgvectorStore(db.poolPinnedTo('default')), embedder, llm: noDrafts,
      embeddingDim: MAX_EMBEDDING_DIM, reflectionPolicy: { kind: 'manual' } });
  }, 30_000);
  afterAll(async () => { vi.unstubAllEnvs(); await db.dropDb(); });
  beforeEach(async () => {
    await db.setupPool.query('TRUNCATE memory_messages, memories, history, consolidation_history RESTART IDENTITY CASCADE');
    // Imported first, true later; imported second, true earlier.
    [july] = (await memory.user('anna').remember('team has 6 women', { infer: false, observedAt: new Date('2023-07-20T00:00:00Z') })).map((m) => m.id);
    [january] = (await memory.user('anna').remember('team has 5 women', { infer: false, observedAt: new Date('2023-01-18T00:00:00Z') })).map((m) => m.id);
  });

  const invalid = async (id: string): Promise<boolean> =>
    (await db.setupPool.query<{ t_invalid: Date | null }>('SELECT t_invalid FROM memories WHERE id = $1', [id])).rows[0]?.t_invalid !== null;

  test('a judge keeping the earlier-valid memory cannot invalidate the later-valid one', async () => {
    await memory.user('anna').reflect({ conflictResolution: new LlmJudgedMergeConflictPolicy({ llm: judge(() => january, () => july) }) });
    expect(await invalid(july)).toBe(false);
    expect(await invalid(january)).toBe(false);
  });

  test('a judge keeping the later-valid memory invalidates the earlier-valid one', async () => {
    await memory.user('anna').reflect({ conflictResolution: new LlmJudgedMergeConflictPolicy({ llm: judge(() => july, () => january) }) });
    expect(await invalid(january)).toBe(true);
    expect(await invalid(july)).toBe(false);
  });
});
