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

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type { CachedResult, RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import { InvalidCacheConfig } from '../../domain/errors.js';
import type { MemoryItemWithScore } from '../../domain/memory-item.js';
import type { Scope } from '../../domain/scope.js';
import { InMemoryVectorStore } from './in-memory-store.js';
import { createLocalMemory } from './index.js';

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
    const seeded = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        text: 'cached fact',
        payload: { source: 'cache' },
        createdAt: new Date(),
        updatedAt: new Date(),
        score: 0.99,
      },
    ] as unknown as MemoryItemWithScore[];
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

  /**
   * fixes-cycle-1 T2.1 / F-merge-5 absorption.
   *
   * Plan T2.2-RED-1 asserts the invalidateScope CALL but NOT the AWAIT ORDER.
   * A fire-and-forget regression (dropping `await` in
   * `LocalScopedMemory.remember()` post-success block) would still PASS the
   * existing T2.2-RED-1 because the call IS issued (just not awaited).
   *
   * This test defends against that regression by gating invalidateScope on a
   * deferred Promise that resolves on the NEXT MICROTASK (EC-3 absorption:
   * NEVER use setTimeout — vitest fake timers freeze setTimeout callbacks,
   * causing the deferred Promise to never resolve → remember() hangs the
   * 5s vitest test-timeout per run).
   *
   * If the implementation drops the `await`, remember() resolves BEFORE
   * the deferred completes → the post-remember inspection observes the
   * call NOT-YET-completed → assertion fails.
   */
  test('fixes-cycle-1 T2.1 — remember() AWAITS invalidateScope before returning (EC-11 sequential-await ORDER)', async () => {
    vi.useRealTimers(); // EC-3 defense-in-depth — sibling suites may use fake timers
    const cache = makeFakeCache();
    let invalidateCompleted = false;
    let rememberCompleted = false;
    // Gating Promise: the test resolves this when it wants invalidateScope to complete.
    // Captures the resolver via a "ready" Promise so the test can know exactly when
    // invalidateScope was called by the pipeline — without that, calling release()
    // BEFORE the pipeline reached invalidateScope would no-op the gate.
    let releaseInvalidate: (() => void) | undefined;
    const invalidateInvoked = new Promise<void>((readyResolve) => {
      cache.invalidateScope = vi.fn(
        () =>
          new Promise<number>((resolve) => {
            releaseInvalidate = () => {
              invalidateCompleted = true;
              resolve(0);
            };
            readyResolve();
          }),
      );
    });

    const memory = await createLocalMemory(baseConfig(cache));
    const rememberPromise = memory.user('alice').remember('I like dark mode').then(() => {
      rememberCompleted = true;
    });

    // Wait until the pipeline has reached invalidateScope (Promise resolves once the
    // FakeCache.invalidateScope is invoked). Now releaseInvalidate is set.
    await invalidateInvoked;
    // remember() must NOT have completed yet — the invalidateScope Promise is gated.
    // If the implementation drops await on invalidateScope, rememberCompleted would
    // ALREADY be true here (fire-and-forget regression detection).
    expect(rememberCompleted).toBe(false);
    expect(invalidateCompleted).toBe(false);

    // Release the gate — remember() must now complete on its next microtask.
    if (releaseInvalidate === undefined) throw new Error('releaseInvalidate not captured');
    releaseInvalidate();
    await rememberPromise;
    expect(invalidateCompleted).toBe(true);
    expect(rememberCompleted).toBe(true);
    // (cache.invalidateCalls is NOT populated here because we replaced
    // invalidateScope with a gated Promise — the existing T2.2-RED-1 test
    // covers the CALL assertion; this test covers the AWAIT ORDER.)
    expect(cache.invalidateScope).toHaveBeenCalledWith({ kind: 'user', userId: 'alice' });
  });

  /**
   * fixes-cycle-1 T2.1 EC-6 sibling — remember() awaits invalidateScope EVEN when
   * the cache backend throws. Verifies the loud-but-degrade policy is intact
   * under the EC-11 sequential-await regime: failure is caught + logged,
   * remember() still returns successfully (NOT poisoned), AND the await
   * discipline is preserved (the throw cannot escape the catch silently).
   */
  test('fixes-cycle-1 T2.1 EC-6 — remember() awaits invalidateScope even when it rejects', async () => {
    vi.useRealTimers();
    const cache = makeFakeCache();
    cache.invalidateScope = vi.fn(async () => {
      throw new Error('cache backend down');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const memory = await createLocalMemory(baseConfig(cache));
      // Existing T2.2-RED-5 contract: remember() resolves despite the throw.
      await expect(memory.user('alice').remember('I like dark mode')).resolves.toBeDefined();
      // Loud-but-degrade: console.error was invoked with the captured backend-down throw.
      expect(errorSpy).toHaveBeenCalled();
      const errorArgs = errorSpy.mock.calls.flat();
      expect(errorArgs.some((a) => String(a).includes('cache backend down') || (a instanceof Error && a.message.includes('cache backend down')))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
