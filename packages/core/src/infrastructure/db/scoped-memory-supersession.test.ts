/**
 * Supersession on write through createLocalMemory (ADR-0029): on by default, a new fact that
 * replaces an old one makes the old one leave current recall while `asOf` still finds it;
 * `supersedeOnWrite: false` keeps both current.
 */
import { describe, expect, test } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';

import { InMemoryVectorStore } from './in-memory-store.js';
import { createLocalMemory } from './index.js';

const vector = (): readonly number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };

/** States the residence in the new message and replaces whichever shown memory mentions Porto. */
const residenceLlm: LLM = {
  generateResponse: (messages) => {
    const system = messages[0]?.content ?? '';
    const city = /Lisbon/.test(system.slice(system.lastIndexOf('## New Messages'))) ? 'Lisbon' : 'Porto';
    const porto = system.split('\n').find((line) => /^\d+\. /.test(line) && line.includes('Porto'))?.split('.')[0];
    return Promise.resolve({ memory: [{ id: '0', text: `user lives in ${city}`, ...(city === 'Lisbon' && porto !== undefined ? { supersedes_memory_ids: [porto] } : {}) }] });
  },
  generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
};

describe('supersession on write through createLocalMemory', () => {
  test('is on by default: the replaced memory leaves current recall and stays readable as of before', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: residenceLlm, embeddingDim: MAX_EMBEDDING_DIM });
    const [porto] = await memory.user('anna').remember('I live in Porto', { observedAt: new Date('2023-01-01T00:00:00Z') });
    const [lisbon] = await memory.user('anna').remember('I moved to Lisbon', { observedAt: new Date('2024-03-01T00:00:00Z') });
    expect(lisbon?.supersedes).toEqual([porto!.id]);
    const current = await memory.user('anna').recall('where does the user live', { threshold: 0 });
    expect(current.map((m) => m.text)).toEqual(['user lives in Lisbon']);
    const before = await memory.user('anna').recall('where does the user live', { threshold: 0, asOf: new Date('2023-06-01T00:00:00Z') });
    expect(before.map((m) => m.text)).toContain('user lives in Porto');
  });

  test('supersedeOnWrite: false keeps both memories current', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: residenceLlm, embeddingDim: MAX_EMBEDDING_DIM, supersedeOnWrite: false });
    await memory.user('anna').remember('I live in Porto', { observedAt: new Date('2023-01-01T00:00:00Z') });
    const [lisbon] = await memory.user('anna').remember('I moved to Lisbon', { observedAt: new Date('2024-03-01T00:00:00Z') });
    expect(lisbon?.supersedes).toBeUndefined();
    const current = await memory.user('anna').recall('where does the user live', { threshold: 0 });
    expect(current.map((m) => m.text).sort()).toEqual(['user lives in Lisbon', 'user lives in Porto']);
  });

});
