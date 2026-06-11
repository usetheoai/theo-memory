/**
 * T2.3 RED — stub-embedder loud warning at createLocalMemory() time when
 * `recallCache` is also enabled. Cycle-1 T2.2 (run-server) precedent.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T2.3
 */
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import type { Scope } from '../../domain/scope.js';
import { InMemoryVectorStore } from './in-memory-store.js';
import { createLocalMemory } from './index.js';

const validVector = (): readonly number[] =>
  new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 0.1 : 0));

class StubEmbedder implements Embedder {
  async embed(): Promise<readonly number[]> {
    return validVector();
  }
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map(() => validVector());
  }
}

class DeterministicStubEmbedder implements Embedder {
  async embed(): Promise<readonly number[]> {
    return validVector();
  }
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map(() => validVector());
  }
}

class OpenAIEmbedder implements Embedder {
  async embed(): Promise<readonly number[]> {
    return validVector();
  }
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map(() => validVector());
  }
}

const fakeCache = (): RecallCacheStore => ({
  async get() {
    return undefined;
  },
  async set() {
    /* no-op */
  },
  async invalidateScope(_scope: Scope) {
    return 0;
  },
  async clearExpired() {
    return 0;
  },
});

const makeLlm = (): LLM => ({
  generateResponse: vi.fn(async () => ({ memory: [] })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

describe('T2.3 — stub-embedder + cache warning', () => {
  let stderrSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    // EC-14 absorption: install stderr spy to prevent log pollution + capture writes.
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((): true => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  test('T2.3-RED-1 — StubEmbedder + recallCache → 3-line stderr warning emitted', async () => {
    await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: new StubEmbedder(),
      llm: makeLlm(),
      recallCache: fakeCache(),
    });
    const writes = stderrSpy.mock.calls.map((c) => String(c[0]));
    const cacheLines = writes.filter((w) => w.startsWith('themory cache:'));
    expect(cacheLines).toHaveLength(3);
    expect(cacheLines[0]).toMatch(/WARNING/);
    expect(cacheLines[0]).toMatch(/StubEmbedder/);
    expect(cacheLines[1]).toMatch(/COINCIDENTAL/i);
    expect(cacheLines[2]).toMatch(/Wiring real providers/i);
  });

  test('T2.3-RED-1b — DeterministicStubEmbedder + recallCache → warning emitted', async () => {
    await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: new DeterministicStubEmbedder(),
      llm: makeLlm(),
      recallCache: fakeCache(),
    });
    const cacheLines = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((w) => w.startsWith('themory cache:'));
    expect(cacheLines).toHaveLength(3);
    expect(cacheLines[0]).toMatch(/DeterministicStubEmbedder/);
  });

  test('T2.3-RED-2 — StubEmbedder WITHOUT recallCache → NO cache warning', async () => {
    await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: new StubEmbedder(),
      llm: makeLlm(),
    });
    const cacheLines = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((w) => w.startsWith('themory cache:'));
    expect(cacheLines).toHaveLength(0);
  });

  test('T2.3-RED-3 — OpenAIEmbedder + recallCache → NO warning (real embedder)', async () => {
    await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: new OpenAIEmbedder(),
      llm: makeLlm(),
      recallCache: fakeCache(),
    });
    const cacheLines = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((w) => w.startsWith('themory cache:'));
    expect(cacheLines).toHaveLength(0);
  });
});
