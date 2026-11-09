/**
 * recall({ includeSources }) returns, with each memory, the raw messages that produced it
 * (ADR-0027). Off by default; a scope whose log is disabled returns no sources.
 */
import { describe, expect, test } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';

import { InMemoryMessageLog } from './in-memory-message-log.js';
import { InMemoryVectorStore } from './in-memory-store.js';
import { createLocalMemory } from './index.js';

const vector = (): readonly number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };
const factLlm = (text: string): LLM => ({
  generateResponse: () => Promise.resolve({ memory: [{ id: '0', text }] }),
  generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
});

describe('recall includeSources', () => {
  test('returns each memory with the raw messages that produced it', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: factLlm('user took their sister Anna to pottery'), embeddingDim: MAX_EMBEDDING_DIM });
    const observedAt = new Date('2023-07-23T18:46:00Z');
    await memory.user('anna').remember('Last Friday I took my sister Anna to the pottery class', { observedAt });
    const [hit] = await memory.user('anna').recall('pottery', { threshold: 0, includeSources: true });
    expect(hit?.sources?.map((s) => [s.role, s.content])).toEqual([['user', 'Last Friday I took my sister Anna to the pottery class']]);
    expect(hit?.sources?.[0]?.observedAt).toEqual(observedAt);
  });

  test('omits sources unless asked', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: factLlm('user likes tea'), embeddingDim: MAX_EMBEDDING_DIM });
    await memory.user('anna').remember('I like tea');
    const [hit] = await memory.user('anna').recall('tea', { threshold: 0 });
    expect(hit).toBeDefined();
    expect(hit?.sources).toBeUndefined();
  });

  test('a memory without logged sources comes back with an empty list, not missing', async () => {
    const messageLog = new InMemoryMessageLog();
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: factLlm('user likes tea'), embeddingDim: MAX_EMBEDDING_DIM, messageLog: false });
    await memory.user('anna').remember('I like tea');
    const [hit] = await memory.user('anna').recall('tea', { threshold: 0, includeSources: true });
    expect(hit?.sources).toEqual([]);
    expect(await messageLog.recent({ user_id: 'anna' }, 10)).toEqual([]);
  });

  test('after a hard forget of one memory, a sibling from the same message has no sources left', async () => {
    const llm: LLM = {
      generateResponse: () => Promise.resolve({ memory: [{ id: '0', text: 'user has a card ending 4111' }, { id: '1', text: 'user shops online' }] }),
      generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
    };
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM });
    const items = await memory.user('anna').remember('My card ends 4111 and I shop online');
    const card = items.find((i) => i.text.includes('4111'))!;
    const before = await memory.user('anna').recall('online', { threshold: 0, includeSources: true });
    expect(before.flatMap((h) => h.sources ?? []).some((s) => s.content.includes('4111'))).toBe(true);
    await memory.user('anna').forget(card.id, { hard: true });
    const hits = await memory.user('anna').recall('online', { threshold: 0, includeSources: true });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.flatMap((h) => h.sources ?? []).some((s) => s.content.includes('4111'))).toBe(false);
  });
});
