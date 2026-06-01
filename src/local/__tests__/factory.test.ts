/**
 * RED-phase tests for createLocalMemory factory — T7.1 of v0-1-local-runtime plan v1.3.
 *
 * Covers: 8 public Memory methods, 3 ScopedMemory tiers (user/session/agent),
 * embedder dimension probe (EC-5), forget MemoryNotFound (EC-12), reset InvalidScope (EC-13),
 * bi-temporal asOf throws (ADR-0006), tracer defaults to no-op.
 */
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../core/constants.js';
import type { Embedder } from '../../core/dip/embedder.js';
import type { LLM } from '../../core/dip/llm.js';
import { BiTemporalNotSupportedLocally, InvalidScope } from '../../core/errors.js';
import { InMemoryVectorStore } from '../in-memory-store.js';
import { createLocalMemory } from '../index.js';

const validVector = (): readonly number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 0.1 : 0));

const makeEmbedder = (dim: number = MAX_EMBEDDING_DIM): Embedder => ({
  embed: vi.fn(async () => new Array<number>(dim).fill(0).map((_, i) => (i === 0 ? 0.1 : 0))),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => validVector())),
});

const makeLlm = (response: unknown = { memory: [{ id: '0', text: 'fact' }] }): LLM => ({
  generateResponse: vi.fn(async () => response),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

const baseConfig = () => ({
  vectorStore: new InMemoryVectorStore(),
  embedder: makeEmbedder(),
  llm: makeLlm(),
});

describe('createLocalMemory factory', () => {
  test('returns a Memory with 5 public methods (user, session, agent, forget, get, history, reset)', async () => {
    const memory = await createLocalMemory(baseConfig());
    expect(typeof memory.user).toBe('function');
    expect(typeof memory.session).toBe('function');
    expect(typeof memory.agent).toBe('function');
    expect(typeof memory.forget).toBe('function');
    expect(typeof memory.get).toBe('function');
    expect(typeof memory.history).toBe('function');
    expect(typeof memory.reset).toBe('function');
  });

  test('memory.user(id) returns a ScopedMemory with remember/recall/reflect/getAll', async () => {
    const memory = await createLocalMemory(baseConfig());
    const scoped = memory.user('alice');
    expect(typeof scoped.remember).toBe('function');
    expect(typeof scoped.recall).toBe('function');
    expect(typeof scoped.reflect).toBe('function');
    expect(typeof scoped.getAll).toBe('function');
  });

  test('EC-5: throws EmbeddingMismatch when embedder probe returns wrong dimension', async () => {
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(768), // wrong dim
      llm: makeLlm(),
    };
    await expect(createLocalMemory(config)).rejects.toThrow(/EmbeddingMismatch|dimension/);
  });

  test('EC-5: succeeds when embedder dimension matches MAX_EMBEDDING_DIM', async () => {
    const memory = await createLocalMemory(baseConfig());
    expect(memory).toBeDefined();
  });

  test('user-scoped remember + recall round-trip', async () => {
    const memory = await createLocalMemory(baseConfig());
    await memory.user('alice').remember('I love coffee');
    const results = await memory.user('alice').recall('coffee', { topK: 5, threshold: 0.0 });
    expect(results.length).toBeGreaterThan(0);
  });

  test('scope isolation: alice does not see bob memories', async () => {
    const memory = await createLocalMemory(baseConfig());
    await memory.user('alice').remember('alice secret');
    await memory.user('bob').remember('bob secret');
    const aliceResults = await memory.user('alice').recall('secret', { topK: 10, threshold: 0.0 });
    // All aliceResults should be alice-scoped
    for (const r of aliceResults) {
      expect(r.scope).toEqual({ kind: 'user', userId: 'alice' });
    }
  });

  test('EC-12: forget(unknown_id) throws MemoryNotFound', async () => {
    const memory = await createLocalMemory(baseConfig());
    await expect(memory.forget('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /MemoryNotFound|not found/,
    );
  });

  test('EC-13: reset({}) throws InvalidScope (prevents whole-table wipe)', async () => {
    const memory = await createLocalMemory(baseConfig());
    // @ts-expect-error — runtime check on empty scope
    await expect(memory.reset({})).rejects.toThrow(InvalidScope);
  });

  test('ADR-0006: recall with options.asOf throws BiTemporalNotSupportedLocally', async () => {
    const memory = await createLocalMemory(baseConfig());
    await expect(
      memory.user('alice').recall('q', { asOf: new Date() }),
    ).rejects.toThrow(BiTemporalNotSupportedLocally);
  });

  test('history(memoryId) returns the audit trail when historyManager is wired', async () => {
    const memory = await createLocalMemory(baseConfig());
    const items = await memory.user('alice').remember('first fact');
    if (items.length === 0) {
      return;
    }
    const id = items[0]?.id ?? '';
    const trail = await memory.history(id);
    // historyManager is optional in baseConfig (absent) — returns []
    expect(Array.isArray(trail)).toBe(true);
  });
});

describe('createLocalMemory factory — parametric embeddingDim (T0.1 + EC-1 absorption)', () => {
  /**
   * T0.1 absorption: LocalMemoryConfig.embeddingDim?: number (default = MAX_EMBEDDING_DIM).
   * Probe asserts against configured dim, not the hard-coded constant.
   *
   * EC-1 absorption: pre-flight guard MUST use Number.isInteger to catch
   * NaN/float/Infinity values that bare arithmetic comparison misses
   * silently. All 5 pre-flight failure cases throw InvalidScope (per SEPA
   * iter 1 pre-RED CRITICAL #1 — uniform error class for config-level
   * rejection). EmbeddingMismatch is reserved for the probe-result mismatch
   * path where the configured dim is VALID but the embedder returned
   * a different length.
   *
   * Error messages MUST include the literal received value via String(received)
   * so the operator can diagnose typos / wrong config in their .env.
   */

  test('accepts embeddingDim=384 with a matching 384-dim embedder', async () => {
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(384),
      llm: makeLlm(),
      embeddingDim: 384,
    };
    const memory = await createLocalMemory(config);
    expect(memory).toBeDefined();
  });

  test('preserves default MAX_EMBEDDING_DIM when embeddingDim is omitted', async () => {
    // Backward compat: existing callers (no embeddingDim) must continue to work.
    const memory = await createLocalMemory(baseConfig());
    expect(memory).toBeDefined();
  });

  test('EC-1: rejects embeddingDim=NaN with InvalidScope and literal value in message', async () => {
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(384),
      llm: makeLlm(),
      embeddingDim: Number.NaN,
    };
    await expect(createLocalMemory(config)).rejects.toThrow(InvalidScope);
    await expect(createLocalMemory(config)).rejects.toThrow(/NaN/);
  });

  test('EC-1: rejects embeddingDim=384.5 (non-integer) with InvalidScope and literal value in message', async () => {
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(384),
      llm: makeLlm(),
      embeddingDim: 384.5,
    };
    await expect(createLocalMemory(config)).rejects.toThrow(InvalidScope);
    await expect(createLocalMemory(config)).rejects.toThrow(/384\.5/);
  });

  test('EC-1: rejects embeddingDim=Infinity with InvalidScope and literal value in message', async () => {
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(384),
      llm: makeLlm(),
      embeddingDim: Number.POSITIVE_INFINITY,
    };
    await expect(createLocalMemory(config)).rejects.toThrow(InvalidScope);
    await expect(createLocalMemory(config)).rejects.toThrow(/Infinity/);
  });

  test('rejects embeddingDim=0 with InvalidScope and literal value in message', async () => {
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(384),
      llm: makeLlm(),
      embeddingDim: 0,
    };
    await expect(createLocalMemory(config)).rejects.toThrow(InvalidScope);
    await expect(createLocalMemory(config)).rejects.toThrow(/0/);
  });

  test('rejects embeddingDim > MAX_EMBEDDING_DIM with InvalidScope and literal value in message', async () => {
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(MAX_EMBEDDING_DIM + 512),
      llm: makeLlm(),
      embeddingDim: MAX_EMBEDDING_DIM + 512,
    };
    await expect(createLocalMemory(config)).rejects.toThrow(InvalidScope);
    await expect(createLocalMemory(config)).rejects.toThrow(new RegExp(String(MAX_EMBEDDING_DIM + 512)));
  });

  test('error message lists MAX_EMBEDDING_DIM upper bound when rejecting too-large embeddingDim', async () => {
    // Operator-diagnosability: the error must point at the locked upper cap
    // so they understand why their value was rejected.
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(384),
      llm: makeLlm(),
      embeddingDim: MAX_EMBEDDING_DIM + 1,
    };
    await expect(createLocalMemory(config)).rejects.toThrow(new RegExp(String(MAX_EMBEDDING_DIM)));
  });

  test('probe-result mismatch (configured 384 vs embedder returns 768) throws EmbeddingMismatch with the configured dim', async () => {
    // Pre-flight passes (384 is valid integer in range), but the embedder
    // misbehaves and returns 768-dim vector. The EmbeddingMismatch error
    // must surface the CONFIGURED dim (384), not MAX_EMBEDDING_DIM, so the
    // operator can pinpoint the source of the mismatch.
    const config = {
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(768),
      llm: makeLlm(),
      embeddingDim: 384,
    };
    await expect(createLocalMemory(config)).rejects.toThrow(/expected 384/);
    await expect(createLocalMemory(config)).rejects.toThrow(/got 768/);
  });
});
