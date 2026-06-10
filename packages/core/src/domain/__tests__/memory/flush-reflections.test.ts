/**
 * T6.1 unit-tier coverage: flushReflections + auto-fire wiring.
 *
 * Validates that:
 *   - flushReflections is on the Memory interface
 *   - A non-manual ReflectionPolicy with shouldReflect=true auto-fires reflect()
 *     after remember() completes
 *   - flushReflections() waits for the in-flight reflection to settle
 *
 * Integration test against real pgvector is in
 * tests/integration/reflection/threshold-policy.test.ts (env-gated).
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T6.1 + T4.3 EC-7
 */
import { describe, expect, test } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../constants.js';
import type { Embedder } from '../../dip/embedder.js';
import type { LLM } from '../../dip/llm.js';
import type { LLMResponse, Message } from '../../message.js';
import type { ReflectionPolicy } from '../../dip/reflection-policy.js';
import { createLocalMemory } from '../../../infrastructure/db/index.js';
import { InMemoryVectorStore } from '../../../infrastructure/db/in-memory-store.js';

function stubEmbedder(): Embedder {
  const probeVec = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);
  return {
    async embed() {
      return Promise.resolve(probeVec);
    },
    async embedBatch(texts: readonly string[]) {
      return Promise.resolve(texts.map(() => probeVec));
    },
  };
}

function stubLLM(reflectResponseDrafts: string): LLM {
  return {
    async generateResponse() {
      return Promise.resolve('unused');
    },
    async generateChat(messages: readonly Message[]): Promise<LLMResponse> {
      const last = messages[0];
      const content = (last?.content ?? '').toLowerCase();
      if (content.includes('reflection helper')) {
        return Promise.resolve({ content: reflectResponseDrafts, role: 'assistant' });
      }
      return Promise.resolve({ content: '{"facts": []}', role: 'assistant' });
    },
  };
}

describe('flushReflections + auto-fire wiring (T6.1 unit)', () => {
  test('Memory.flushReflections exists and is callable', async () => {
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: stubEmbedder(),
      llm: stubLLM('[]'),
    });
    expect(typeof memory.flushReflections).toBe('function');
    await expect(memory.flushReflections()).resolves.toBeUndefined();
  });

  test('manual policy does NOT auto-fire on remember()', async () => {
    const store = new InMemoryVectorStore();
    let shouldReflectCalls = 0;
    const policy: ReflectionPolicy = {
      kind: 'manual',
      async shouldReflect() {
        shouldReflectCalls++;
        return Promise.resolve(true);
      },
    };
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM('[]'),
      reflectionPolicy: policy,
    });
    await memory.user('alice').remember('hello');
    await memory.flushReflections();
    expect(shouldReflectCalls).toBe(0);
  });

  test('threshold policy auto-fires reflect() when shouldReflect returns true', async () => {
    const store = new InMemoryVectorStore();
    // Pre-seed 1 source memory so reflect has something to consolidate
    await store.insert(
      [Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1)],
      ['src-1'],
      [{ text: 'Alice runs', hash: 'h1', user_id: 'alice' }],
    );

    let shouldReflectCalls = 0;
    let onReflectionEndCalls = 0;
    const policy: ReflectionPolicy = {
      kind: 'threshold',
      async shouldReflect() {
        shouldReflectCalls++;
        return Promise.resolve(true);
      },
      async onReflectionEnd() {
        onReflectionEndCalls++;
        return Promise.resolve();
      },
    };

    const draftJson = JSON.stringify([
      { text: 'Alice values fitness', derived_from: ['src-1'] },
    ]);
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: stubEmbedder(),
      llm: stubLLM(draftJson),
      reflectionPolicy: policy,
    });

    await memory.user('alice').remember('Alice meditates');
    // Auto-fire is fire-and-forget; flush waits for it
    await memory.flushReflections();

    expect(shouldReflectCalls).toBe(1);
    expect(onReflectionEndCalls).toBeGreaterThanOrEqual(1);
  });
});
