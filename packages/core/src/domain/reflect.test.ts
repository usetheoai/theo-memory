/**
 * T4.3 unit tests for Memory.reflect() pipeline.
 *
 * Uses InMemoryVectorStore + mocked LLM + mocked Embedder for end-to-end
 * pipeline coverage WITHOUT a real Postgres container.
 *
 */
import { describe, expect, test } from 'vitest';

import { InMemoryVectorStore } from './../infrastructure/db/in-memory-store.js';
import { createLocalMemory } from './../infrastructure/db/index.js';
import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { LLM } from './dip/llm.js';
import { ReflectionNotConfigured } from './errors.js';
import type { LLMResponse, Message } from './message.js';

function stubEmbedder(): Embedder {
  const probeVec = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);
  return {
    async embed(_text: string): Promise<readonly number[]> {
      return Promise.resolve(probeVec);
    },
    async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      return Promise.resolve(texts.map(() => probeVec));
    },
  };
}

function stubLLM(reflectResponse: string): LLM {
  return {
    async generateResponse() {
      return Promise.resolve('unused');
    },
    async generateChat(messages: readonly Message[]): Promise<LLMResponse> {
      const last = messages[messages.length - 1];
      // If this is an extraction prompt, return empty (no facts)
      const content = last?.content ?? '';
      if (content.toLowerCase().includes('reflection helper')) {
        return Promise.resolve({ content: reflectResponse, role: 'assistant' });
      }
      // Extraction or other: return empty JSON
      return Promise.resolve({ content: '{"facts": []}', role: 'assistant' });
    },
  };
}

describe('Memory.reflect() (T4.3)', () => {
  test('throws ReflectionNotConfigured when reflectionPolicy: undefined is EXPLICITLY passed (post-T1.1 default opt-out)', async () => {
    // verbs-as-cli-fixes-cycle-1 T1.1 / ADR D1 + ADR-0005 v1.1 supplementary
    // amendment: createLocalMemory now defaults `reflectionPolicy: manual` when
    // the consumer OMITS the key entirely. Strict no-default behavior is opt-in
    // via explicit `reflectionPolicy: undefined` per the `'in' operator`
    // distinguishing semantics. This test locks the opt-in throw path.
    // verbs-as-cli-fixes-cycle-2 T2.2 / ADR D3: type widened to
    // `ReflectionPolicy | undefined` so explicit `undefined` is typed-
    // reachable under `exactOptionalPropertyTypes: true`. No cast needed.
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: stubEmbedder(),
      llm: stubLLM('[]'),
      reflectionPolicy: undefined,
    });
    await expect(memory.user('alice').reflect()).rejects.toThrow(ReflectionNotConfigured);
  });

  test('EC-5: returns no-source-memories reason when scope is empty', async () => {
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: stubEmbedder(),
      llm: stubLLM('[]'),
      reflectionPolicy: {
        kind: 'manual',
        async shouldReflect() {
          return Promise.resolve(true);
        },
      },
    });
    const result = await memory.user('alice').reflect();
    expect(result.derivedMemoriesCreated).toBe(0);
    expect(result.reason).toBe('no-source-memories');
    expect(result.higherOrderMemories).toEqual([]);
  });

  test('EC-13: LLM returns empty array → no-consolidation reason', async () => {
    const store = new InMemoryVectorStore();
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM('[]'),
      reflectionPolicy: {
        kind: 'manual',
        async shouldReflect() {
          return Promise.resolve(true);
        },
      },
    });
    // Seed 1 source memory directly
    await store.insert(
      [Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1)],
      ['src-1'],
      [{ text: 'A source memory', hash: 'h1', user_id: 'alice' }],
    );
    const result = await memory.user('alice').reflect();
    expect(result.derivedMemoriesCreated).toBe(0);
    expect(result.reason).toBe('no-consolidation');
  });

  test('happy path: LLM returns 1 draft → 1 derived memory persisted', async () => {
    const store = new InMemoryVectorStore();
    await store.insert(
      [Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1)],
      ['src-1'],
      [{ text: 'Alice runs', hash: 'h1', user_id: 'alice' }],
    );
    const draftJson = JSON.stringify([
      { text: 'Alice values fitness', derived_from: ['src-1'] },
    ]);
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM(draftJson),
      reflectionPolicy: {
        kind: 'manual',
        async shouldReflect() {
          return Promise.resolve(true);
        },
      },
    });
    const result = await memory.user('alice').reflect();
    expect(result.derivedMemoriesCreated).toBe(1);
    expect(result.higherOrderMemories).toHaveLength(1);
    expect(result.higherOrderMemories[0]?.text).toBe('Alice values fitness');
    expect(result.sourceIds).toContain('src-1');
  });

  test('derived insights inherit attribution only when every cited source has one speaker', async () => {
    const store = new InMemoryVectorStore();
    await store.insert(
      [
        Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1),
        Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1),
      ],
      ['user-source', 'assistant-source'],
      [
        { text: 'user says their record is 27:12', hash: 'h-user', user_id: 'alice', attributed_to: 'user' },
        { text: 'assistant claims the target is 25:50', hash: 'h-assistant', user_id: 'alice', attributed_to: 'assistant' },
      ],
    );
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM(JSON.stringify([
        { text: 'The user record is 27:12 and the assistant suggested 25:50.', derived_from: ['user-source', 'assistant-source'] },
      ])),
      reflectionPolicy: { kind: 'manual', async shouldReflect() { return true; } },
    });

    const result = await memory.user('alice').reflect();

    expect(result.derivedMemoriesCreated).toBe(1);
    expect(result.higherOrderMemories[0]?.attributedTo).toBeUndefined();
    expect(result.higherOrderMemories[0]?.metadata['attributed_to']).toBeUndefined();
  });

  test('derived insight from user-only sources preserves user attribution', async () => {
    const store = new InMemoryVectorStore();
    await store.insert(
      [
        Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1),
        Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1),
      ],
      ['user-source-1', 'user-source-2'],
      [
        { text: 'user likes simple clothing', hash: 'h1', user_id: 'alice', attributed_to: 'user' },
        { text: 'user prefers dark colors', hash: 'h2', user_id: 'alice', attributed_to: 'user' },
      ],
    );
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM(JSON.stringify([
        { text: 'User prefers simple, dark clothing.', derived_from: ['user-source-1', 'user-source-2'] },
      ])),
      reflectionPolicy: { kind: 'manual', async shouldReflect() { return true; } },
    });

    const result = await memory.user('alice').reflect();

    expect(result.higherOrderMemories[0]?.attributedTo).toBe('user');
    expect(result.higherOrderMemories[0]?.metadata['attributed_to']).toBe('user');
  });

  test('provenance failure: LLM cites unknown id → draft is quarantined, reflect does NOT throw (M24 #145)', async () => {
    const store = new InMemoryVectorStore();
    await store.insert(
      [Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1)],
      ['src-1'],
      [{ text: 'A memory', hash: 'h1', user_id: 'alice' }],
    );
    const draftJson = JSON.stringify([
      { text: 'fabricated', derived_from: ['unknown-id'] },
    ]);
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM(draftJson),
      reflectionPolicy: {
        kind: 'manual',
        async shouldReflect() {
          return Promise.resolve(true);
        },
      },
    });
    // M24 #145: the single provenance-invalid draft is QUARANTINED (skipped), not
    // thrown; with no valid drafts left the result is a clean no-consolidation.
    const result = await memory.user('alice').reflect();
    expect(result.derivedMemoriesCreated).toBe(0);
    expect(result.reason).toBe('no-consolidation');
  });

  test('policy.onReflectionStart + onReflectionEnd are invoked', async () => {
    const store = new InMemoryVectorStore();
    let startCalls = 0;
    let endCalls = 0;
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM('[]'),
      reflectionPolicy: {
        kind: 'manual',
        async shouldReflect() {
          return Promise.resolve(true);
        },
        async onReflectionStart() {
          startCalls++;
          return Promise.resolve();
        },
        async onReflectionEnd() {
          endCalls++;
          return Promise.resolve();
        },
      },
    });
    await memory.user('alice').reflect();
    // No source → onReflectionStart skipped per pipeline ordering; onReflectionEnd called
    expect(endCalls).toBe(1);
    expect(startCalls).toBe(0); // EC-5 short-circuit returns before onReflectionStart
  });
});
