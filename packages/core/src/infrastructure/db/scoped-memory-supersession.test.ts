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

const isJudgeCall = (system: string): boolean => system.startsWith('You compare two notes');

/** An update judge that says the later note replaces the earlier one when both state a residence. */
const residenceJudge = (pair: string): { reasoning: string; verdict: 'replaces' | 'both' } =>
  ({ reasoning: 'test', verdict: (pair.match(/lives in/g) ?? []).length === 2 ? 'replaces' : 'both' });

/** States the residence in the new message; the judge decides on residence pairs. */
const residenceLlm: LLM = {
  generateResponse: (messages) => {
    const system = messages[0]?.content ?? '';
    if (isJudgeCall(system)) return Promise.resolve(residenceJudge(messages[1]?.content ?? ''));
    const city = /Lisbon/.test(system.slice(system.lastIndexOf('## New Messages'))) ? 'Lisbon' : 'Porto';
    return Promise.resolve({ memory: [{ id: '0', text: `user lives in ${city}` }] });
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

/**
 * Writes the fact of the new message. Its judge would call any pair of counts or of managers a
 * replacement, so a count for another year survives only because the pair never reaches it.
 */
let judgeCallsForCounts = 0;
const yearlyCountLlm: LLM = {
  generateResponse: (messages) => {
    const system = messages[0]?.content ?? '';
    if (isJudgeCall(system)) {
      judgeCallsForCounts += 1;
      return Promise.resolve({ reasoning: 'test', verdict: 'replaces' });
    }
    const input = system.slice(system.lastIndexOf('## New Messages'));
    const text = /2023/.test(input) ? 'Oskar planted 65 apple trees in 2023'
      : /2022/.test(input) ? 'Oskar planted 40 apple trees in 2022'
      : /Ruth/.test(input) ? "Oskar's farm manager is now Ruth Albers" : "Oskar's farm manager is Petra Vogel";
    return Promise.resolve({ memory: [{ id: '0', text }] });
  },
  generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
};

describe('supersession refuses a fact about another period (#252)', () => {
  test('a count for 2023 does not replace the count for 2022, and the pair is never judged', async () => {
    judgeCallsForCounts = 0;
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: yearlyCountLlm, embeddingDim: MAX_EMBEDDING_DIM });
    await memory.user('oskar').remember('I planted 40 apple trees in 2022', { observedAt: new Date('2022-12-30T00:00:00Z') });
    const [later] = await memory.user('oskar').remember('I planted 65 apple trees in 2023', { observedAt: new Date('2023-12-29T00:00:00Z') });
    expect(later?.supersedes).toBeUndefined();
    expect(judgeCallsForCounts).toBe(0);
    const current = await memory.user('oskar').recall('how many apple trees did Oskar plant', { threshold: 0 });
    expect(current.map((m) => m.text).sort()).toEqual(['Oskar planted 40 apple trees in 2022', 'Oskar planted 65 apple trees in 2023']);
  });

  test('a change without a period still replaces the old value', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: yearlyCountLlm, embeddingDim: MAX_EMBEDDING_DIM });
    const [petra] = await memory.user('oskar').remember('My farm manager is Petra', { observedAt: new Date('2022-03-10T00:00:00Z') });
    const [ruth] = await memory.user('oskar').remember('My farm manager is now Ruth', { observedAt: new Date('2024-02-01T00:00:00Z') });
    expect(ruth?.supersedes).toEqual([petra!.id]);
  });
});

/** Same as `residenceLlm`: the judge names the pair, and valid time decides which side ends. */
const eitherDirectionLlm: LLM = residenceLlm;

describe('an older value that arrives after the newer one (#253)', () => {
  const said2023 = new Date('2023-01-01T00:00:00Z');
  const said2024 = new Date('2024-03-01T00:00:00Z');

  test('is stored as already ended, so current recall keeps only the newer value', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: eitherDirectionLlm, embeddingDim: MAX_EMBEDDING_DIM });
    await memory.user('anna').remember('I live in Lisbon', { observedAt: said2024 });

    const [porto] = await memory.user('anna').remember('I live in Porto', { observedAt: said2023 });

    expect(porto?.tInvalid).toEqual(said2024);
    const current = await memory.user('anna').recall('where does the user live', { threshold: 0 });
    expect(current.map((m) => m.text)).toEqual(['user lives in Lisbon']);
  });

  test('stays readable as of a date before the newer value began', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: eitherDirectionLlm, embeddingDim: MAX_EMBEDDING_DIM });
    await memory.user('anna').remember('I live in Lisbon', { observedAt: said2024 });
    await memory.user('anna').remember('I live in Porto', { observedAt: said2023 });

    const before = await memory.user('anna').recall('where does the user live', { threshold: 0, asOf: new Date('2023-06-01T00:00:00Z') });

    expect(before.map((m) => m.text)).toEqual(['user lives in Porto']);
  });

  test('does not report the older value as replacing the newer one', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: eitherDirectionLlm, embeddingDim: MAX_EMBEDDING_DIM });
    await memory.user('anna').remember('I live in Lisbon', { observedAt: said2024 });

    const [porto] = await memory.user('anna').remember('I live in Porto', { observedAt: said2023 });

    expect(porto?.supersedes).toBeUndefined();
  });

  test('leaves a count for an earlier year alone when it arrives after the count for a later year', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: yearlyCountLlm, embeddingDim: MAX_EMBEDDING_DIM });
    await memory.user('oskar').remember('I planted 65 apple trees in 2023', { observedAt: new Date('2023-12-29T00:00:00Z') });

    const [earlier] = await memory.user('oskar').remember('I planted 40 apple trees in 2022', { observedAt: new Date('2022-12-30T00:00:00Z') });

    expect(earlier?.tInvalid).toBeNull();
    const current = await memory.user('oskar').recall('how many apple trees did Oskar plant', { threshold: 0 });
    expect(current.map((m) => m.text).sort()).toEqual(['Oskar planted 40 apple trees in 2022', 'Oskar planted 65 apple trees in 2023']);
  });

  test('with supersedeOnWrite off, both values stay current', async () => {
    const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm: eitherDirectionLlm, embeddingDim: MAX_EMBEDDING_DIM, supersedeOnWrite: false });
    await memory.user('anna').remember('I live in Lisbon', { observedAt: said2024 });
    await memory.user('anna').remember('I live in Porto', { observedAt: said2023 });

    const current = await memory.user('anna').recall('where does the user live', { threshold: 0 });

    expect(current.map((m) => m.text).sort()).toEqual(['user lives in Lisbon', 'user lives in Porto']);
  });
});
