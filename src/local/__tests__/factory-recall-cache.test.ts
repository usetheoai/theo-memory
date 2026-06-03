/**
 * T2.1/T2.2 RED-phase contract tests — `LocalMemoryConfig.recallCache` extension.
 *
 * Covers the DIP-instance shape (escape hatch — no Postgres required). The POJO
 * config shape requires a real `PgvectorStore` (constructor branch throws when
 * paired with `InMemoryVectorStore`) so its happy-path lives in the integration
 * suite at `tests/integration/cache/factory-wiring.test.ts`.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T2.1 + T2.2
 */
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../core/constants.js';
import type { Embedder } from '../../core/dip/embedder.js';
import type { LLM } from '../../core/dip/llm.js';
import type { CachedResult, RecallCacheStore } from '../../core/dip/recall-cache-store.js';
import { InvalidCacheConfig } from '../../core/errors.js';
import type { MemoryItemWithScore } from '../../core/memory-item.js';
import type { Scope } from '../../core/scope.js';
import { InMemoryVectorStore } from '../in-memory-store.js';
import { createLocalMemory } from '../index.js';

const validVector = (): readonly number[] =>
  new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 0.1 : 0));

const makeEmbedder = (): Embedder => ({
  embed: vi.fn(async () => validVector()),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => validVector())),
});

const makeLlm = (): LLM => ({
  generateResponse: vi.fn(async () => ({ memory: [{ id: '0', text: 'fact' }] })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

interface FakeCache extends RecallCacheStore {
  getCalls: { embedding: readonly number[]; scope: Scope }[];
  setCalls: { embedding: readonly number[]; scope: Scope; results: readonly MemoryItemWithScore[]; ttlSeconds: number }[];
  invalidateCalls: Scope[];
  clearExpiredCalls: number;
}

function makeFakeCache(seed?: CachedResult): FakeCache {
  const cache: FakeCache = {
    getCalls: [],
    setCalls: [],
    invalidateCalls: [],
    clearExpiredCalls: 0,
    async get(embedding, scope) {
      cache.getCalls.push({ embedding, scope });
      return seed;
    },
    async set(embedding, scope, results, ttlSeconds) {
      cache.setCalls.push({ embedding, scope, results, ttlSeconds });
    },
    async invalidateScope(scope) {
      cache.invalidateCalls.push(scope);
      return 1;
    },
    async clearExpired() {
      cache.clearExpiredCalls += 1;
      return 0;
    },
  };
  return cache;
}

const baseConfig = (cache?: RecallCacheStore) => ({
  vectorStore: new InMemoryVectorStore(),
  embedder: makeEmbedder(),
  llm: makeLlm(),
  ...(cache !== undefined ? { recallCache: cache } : {}),
});

describe('T2.1 — createLocalMemory({ recallCache })', () => {
  test('T2.1-RED-1 — recallCache undefined → no cache wiring (existing behavior unchanged)', async () => {
    const memory = await createLocalMemory(baseConfig());
    // Smoke: factory returns a Memory with the 8 verbs intact.
    expect(typeof memory.user).toBe('function');
    expect(typeof memory.session).toBe('function');
    expect(typeof memory.agent).toBe('function');
  });

  test('T2.1-RED-3 — recallCache: DIP instance passed verbatim and consulted on recall', async () => {
    const cache = makeFakeCache();
    const memory = await createLocalMemory(baseConfig(cache));
    const alice = memory.user('alice');
    await alice.recall('coffee');
    // get() must be invoked exactly once with the embedded query + alice scope.
    expect(cache.getCalls).toHaveLength(1);
    expect(cache.getCalls[0]?.scope).toEqual({ kind: 'user', userId: 'alice' });
    // Cache MISS path → factory falls through to retrieval pipeline → set() populated.
    expect(cache.setCalls).toHaveLength(1);
    expect(cache.setCalls[0]?.scope).toEqual({ kind: 'user', userId: 'alice' });
  });

  test('T2.1-RED-4 — second recall() with same query short-circuits on cache HIT', async () => {
    const seeded: MemoryItemWithScore[] = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        text: 'cached fact',
        payload: { source: 'cache' },
        createdAt: new Date(),
        updatedAt: new Date(),
        score: 0.99,
      },
    ];
    const cache = makeFakeCache({ results: seeded, cachedAt: new Date(), similarity: 0.99 });
    const memory = await createLocalMemory(baseConfig(cache));
    const result = await memory.user('alice').recall('coffee');
    expect(result.map((r) => r.id)).toEqual(['00000000-0000-0000-0000-000000000001']);
    // No set() on hit (T2.1 contract: only populate on miss).
    expect(cache.setCalls).toHaveLength(0);
  });

  test('T2.1-RED-8 (EC-4) — recall({ asOf }) BYPASSES cache (no get, no set)', async () => {
    const cache = makeFakeCache();
    const memory = await createLocalMemory(baseConfig(cache));
    await memory.user('alice').recall('coffee', { asOf: new Date('2026-01-01') });
    expect(cache.getCalls).toHaveLength(0);
    expect(cache.setCalls).toHaveLength(0);
  });

  test('T2.1-RED-9 (EC-5) — recall({ attributedTo }) BYPASSES cache', async () => {
    const cache = makeFakeCache();
    const memory = await createLocalMemory(baseConfig(cache));
    await memory.user('alice').recall('coffee', { attributedTo: 'system' });
    expect(cache.getCalls).toHaveLength(0);
    expect(cache.setCalls).toHaveLength(0);
  });

  test('T2.1-RED-10 (EC-4+EC-5 combined) — both options set → BYPASS', async () => {
    const cache = makeFakeCache();
    const memory = await createLocalMemory(baseConfig(cache));
    await memory.user('alice').recall('coffee', {
      asOf: new Date('2026-01-01'),
      attributedTo: 'user',
    });
    expect(cache.getCalls).toHaveLength(0);
    expect(cache.setCalls).toHaveLength(0);
  });

  test('T2.1-RED-2/5 (POJO config) — POJO with invalid threshold throws InvalidCacheConfig at factory time', async () => {
    await expect(
      createLocalMemory({
        vectorStore: new InMemoryVectorStore(),
        embedder: makeEmbedder(),
        llm: makeLlm(),
        recallCache: { threshold: 1.5 },
      }),
    ).rejects.toThrow(InvalidCacheConfig);
  });

  test('T2.1 (POJO + non-Pg store) — POJO recallCache config with InMemoryVectorStore throws InvalidCacheConfig', async () => {
    await expect(
      createLocalMemory({
        vectorStore: new InMemoryVectorStore(),
        embedder: makeEmbedder(),
        llm: makeLlm(),
        recallCache: { threshold: 0.8 },
      }),
    ).rejects.toThrow(/PgvectorStore/);
  });
});

describe('T2.2 — write-trigger cache invalidation hooks', () => {
  test('T2.2-RED-1 — remember() success invokes invalidateScope(scope)', async () => {
    const cache = makeFakeCache();
    const memory = await createLocalMemory(baseConfig(cache));
    await memory.user('alice').remember('I like dark mode');
    expect(cache.invalidateCalls).toContainEqual({ kind: 'user', userId: 'alice' });
  });

  test('T2.2-RED-5 — invalidateScope failure does NOT propagate; remember() still succeeds', async () => {
    const cache = makeFakeCache();
    cache.invalidateScope = vi.fn(async () => {
      throw new Error('cache backend down');
    });
    const memory = await createLocalMemory(baseConfig(cache));
    await expect(memory.user('alice').remember('I like dark mode')).resolves.toBeDefined();
  });
});
