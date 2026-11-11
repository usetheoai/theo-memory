/**
 * `ScopedMemory.searchMessages`: lexical search over the scope's raw message log, separate
 * from `recall`. It reaches what was said even when extraction kept no fact of it.
 */
import { describe, expect, test, vi } from 'vitest';

import { MessageLogNotConfigured } from '../../domain/errors.js';

import { createLocalMemory } from './factory.js';
import { InMemoryMessageLog } from './in-memory-message-log.js';
import { InMemoryVectorStore } from './in-memory-store.js';

const embedder = {
  embed: async (text: string) => [text.length, 1, 0],
  embedBatch: async (texts: readonly string[]) => texts.map((text) => [text.length, 1, 0]),
};
const noFacts = {
  generateResponse: vi.fn(async () => ({ memory: [] })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
};

async function build(messageLog: InMemoryMessageLog | false = new InMemoryMessageLog()) {
  return createLocalMemory({ vectorStore: new InMemoryVectorStore(), llm: noFacts, embedder, embeddingDim: 3, entityBoost: false, messageLog });
}

describe('ScopedMemory.searchMessages', () => {
  test('finds a turn that produced no memory', async () => {
    const memory = await build();
    await memory.user('ana').remember('If the insomnia continues, try chamomile tea before bed.');
    await memory.user('ana').remember('The weather was lovely today.');

    const found = await memory.user('ana').searchMessages('chamomile tea');

    expect(await memory.user('ana').getAll()).toEqual([]);
    // With embeddings, neighbours by meaning also rank, so the word match is asserted first, not alone.
    expect(found[0]?.content).toBe('If the insomnia continues, try chamomile tea before bed.');
  });

  test('returns at most `limit` messages, best score first', async () => {
    const memory = await build();
    for (const text of ['tea once', 'tea tea twice', 'tea', 'tea again', 'more tea', 'tea time']) {
      await memory.user('ana').remember(text);
    }

    const found = await memory.user('ana').searchMessages('tea', { limit: 2 });

    expect(found).toHaveLength(2);
    expect(found[0]!.score).toBeGreaterThanOrEqual(found[1]!.score);
  });

  test('defaults to five messages', async () => {
    const memory = await build();
    for (let i = 0; i < 7; i += 1) await memory.user('ana').remember(`tea note ${String(i)}`);

    expect(await memory.user('ana').searchMessages('tea')).toHaveLength(5);
  });

  test("a user-bound session sees its own turns and the user's global turns", async () => {
    const memory = await build();
    await memory.user('ana').remember('global tea');
    await memory.session('s1', 'ana').remember('session tea');
    await memory.session('s2', 'ana').remember('other session tea');

    const found = await memory.session('s1', 'ana').searchMessages('tea');

    expect(found.map((m) => m.content).sort()).toEqual(['global tea', 'session tea']);
  });

  test('never reaches another workspace', async () => {
    const memory = await build();
    await memory.withWorkspace!('w2').user('ana').remember('tea in w2');

    expect(await memory.withWorkspace!('w1').user('ana').searchMessages('tea')).toEqual([]);
  });

  test('rejects a limit outside 1..100', async () => {
    const memory = await build();
    await expect(memory.user('ana').searchMessages('tea', { limit: 0 })).rejects.toThrow(RangeError);
    await expect(memory.user('ana').searchMessages('tea', { limit: 101 })).rejects.toThrow(RangeError);
  });

  test('fails loudly when the message log is turned off', async () => {
    const memory = await build(false);
    await expect(memory.user('ana').searchMessages('tea')).rejects.toThrow(MessageLogNotConfigured);
  });
});

describe('ScopedMemory.searchMessages by meaning', () => {
  /** Words of one concept share an axis, so similarity stands in for meaning. */
  const CONCEPTS: readonly (readonly string[])[] = [['knee', 'joint', 'pain', 'hurts'], ['weather', 'sunny', 'lovely']];
  function conceptVector(text: string): number[] {
    const words = text.toLowerCase().split(/\W+/);
    return [...CONCEPTS.map((c) => (c.some((w) => words.includes(w)) ? 1 : 0)), 0.01];
  }
  const conceptEmbedder = {
    embed: async (text: string) => conceptVector(text),
    embedBatch: async (texts: readonly string[]) => texts.map(conceptVector),
  };

  test('finds a turn that shares no word with the query', async () => {
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(), llm: noFacts, embedder: conceptEmbedder, embeddingDim: 3, entityBoost: false,
      messageLog: new InMemoryMessageLog(),
    });
    await memory.user('omar').remember('My knee is killing me after cycling.');
    await memory.user('omar').remember('It was sunny all afternoon.');

    const found = await memory.user('omar').searchMessages('joint ache', { limit: 1 });

    expect(found.map((m) => m.content)).toEqual(['My knee is killing me after cycling.']);
  });

  test('a message whose embedding failed is kept and found by its words', async () => {
    const failingBatch = { ...conceptEmbedder, embedBatch: async () => { throw new Error('embedding provider down'); } };
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(), llm: noFacts, embedder: failingBatch, embeddingDim: 3, entityBoost: false,
      messageLog: new InMemoryMessageLog(),
    });

    await memory.user('omar').remember('I lent my drill to the neighbour.');

    expect((await memory.user('omar').searchMessages('drill')).map((m) => m.content)).toEqual(['I lent my drill to the neighbour.']);
  });
});
