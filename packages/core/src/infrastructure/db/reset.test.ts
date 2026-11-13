/**
 * `Memory.reset(scope)`: the administrative wipe deletes exactly the scope it names (its
 * memories, its logged messages and its cached recalls) and nothing outside it.
 * Regressions for #246 (logged messages survived), #247 (a session reset deleted the user's
 * global memories) and #248 (an in-memory reset ignored the bound workspace).
 */
import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import type { Filters } from '../../domain/scope.js';

import { createLocalMemory } from './factory.js';
import { InMemoryMessageLog } from './in-memory-message-log.js';
import { InMemoryVectorStore } from './in-memory-store.js';

const embedder = {
  embed: async (text: string) => [text.length, 1, 0],
  embedBatch: async (texts: readonly string[]) => texts.map((text) => [text.length, 1, 0]),
};

function llmReturning(facts: readonly string[]) {
  return {
    generateResponse: vi.fn(async () => ({ memory: facts.map((text, i) => ({ id: String(i + 1), text })) })),
    generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
  };
}

async function build(options: { vectorStore?: InMemoryVectorStore; messageLog?: InMemoryMessageLog; recallCache?: RecallCacheStore } = {}) {
  return createLocalMemory({
    vectorStore: options.vectorStore ?? new InMemoryVectorStore(),
    llm: llmReturning([]),
    embedder,
    embeddingDim: 3,
    entityBoost: false,
    messageLog: options.messageLog ?? false,
    ...(options.recallCache === undefined ? {} : { recallCache: options.recallCache }),
  });
}

/** Lists at most two rows per call, so a reset has to page through a larger scope. */
class TwoRowPages extends InMemoryVectorStore {
  override list(filters?: Filters, topK = 100, includeSoftDeleted = false, offset = 0) {
    return super.list(filters, Math.min(topK, 2), includeSoftDeleted, offset);
  }
}

describe('Memory.reset', () => {
  test('erases every logged message of the scope, including turns that produced no memory', async () => {
    const messageLog = new InMemoryMessageLog();
    const llm = llmReturning([]);
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), llm, embedder, embeddingDim: 3, entityBoost: false, messageLog });
    await memory.user('alice').remember('Hey, good to hear from you!');
    llm.generateResponse.mockResolvedValueOnce({ memory: [{ id: '1', text: 'user lives in Lisbon' }] });
    await memory.user('alice').remember('I live in Lisbon.');

    await memory.reset({ kind: 'user', userId: 'alice' });

    expect(await messageLog.recent({ user_id: 'alice' }, 10)).toEqual([]);
  });

  test("a user-bound session reset keeps the user's global memories", async () => {
    const memory = await build();
    await memory.user('alice').remember('global fact about alice', { infer: false });
    await memory.session('s1', 'alice').remember('session fact', { infer: false });

    await memory.reset({ kind: 'session', sessionId: 's1', userId: 'alice' });

    expect((await memory.session('s1', 'alice').getAll()).map((m) => m.text)).toEqual(['global fact about alice']);
  });

  test("a user-bound session reset keeps the user's global logged messages", async () => {
    const messageLog = new InMemoryMessageLog();
    const memory = await build({ messageLog });
    await memory.user('alice').remember('I live in Lisbon.');
    await memory.session('s1', 'alice').remember('Just checking in.');

    await memory.reset({ kind: 'session', sessionId: 's1', userId: 'alice' });

    expect((await messageLog.recent({ user_id: 'alice' }, 10)).map((m) => m.content)).toEqual(['I live in Lisbon.']);
  });

  test('a workspace-bound reset keeps the same user in another workspace', async () => {
    const memory = await build();
    await memory.withWorkspace!('w1').user('alice').remember('w1 fact', { infer: false });
    await memory.withWorkspace!('w2').user('alice').remember('w2 fact', { infer: false });

    await memory.withWorkspace!('w1').reset({ kind: 'user', userId: 'alice' });

    expect((await memory.withWorkspace!('w2').user('alice').getAll()).map((m) => m.text)).toEqual(['w2 fact']);
  });

  test('wipes a scope larger than one listing page', async () => {
    const memory = await build({ vectorStore: new TwoRowPages() });
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      await memory.user('alice').remember(`fact ${text}`, { infer: false });
    }

    await memory.reset({ kind: 'user', userId: 'alice' });

    expect(await memory.user('alice').getAll()).toEqual([]);
  });

  test('invalidates the cached recalls of the scope', async () => {
    const recallCache = mock<RecallCacheStore>();
    const memory = await build({ recallCache });

    await memory.withWorkspace!('w1').reset({ kind: 'session', sessionId: 's1', userId: 'alice' });

    expect(recallCache.invalidateScope).toHaveBeenCalledWith({ kind: 'session', sessionId: 's1', userId: 'alice' }, 'w1');
  });
});
