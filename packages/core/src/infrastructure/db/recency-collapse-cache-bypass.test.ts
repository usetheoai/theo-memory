/**
 * M22 / #141 (ADR D3) — recall({ recencyCollapse }) MUST bypass the recall cache.
 *
 * recencyCollapse re-orders/prunes the candidate pool exactly like
 * scopes/rerank/graphExpand: the v1.5 cache key is (scope_key, query_embedding)
 * and does NOT encode it, so a HIT would serve a stale plain (un-collapsed)
 * result and a MISS would store the collapsed order under a collapse-blind key,
 * poisoning a later plain recall. This test wires a spy cache and asserts neither
 * `get` nor `set` is consulted when recencyCollapse is set.
 *
 * Kept in its own file (not folded into factory-recall-cache.test.ts) to avoid
 * that file's pre-existing module-size budget.
 */
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type { CachedResult, RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
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

interface SpyCache extends RecallCacheStore {
  getCalls: number;
  setCalls: number;
}

function makeSpyCache(seed?: CachedResult): SpyCache {
  const cache: SpyCache = {
    getCalls: 0,
    setCalls: 0,
    async get(_embedding: readonly number[], _scope: Scope) {
      cache.getCalls += 1;
      return seed;
    },
    async set(
      _embedding: readonly number[],
      _scope: Scope,
      _results: readonly MemoryItemWithScore[],
      _ttlSeconds: number,
    ) {
      cache.setCalls += 1;
    },
    async invalidateScope() {
      return 1;
    },
    async clearExpired() {
      return 0;
    },
  };
  return cache;
}

describe('T1.3 — recencyCollapse bypasses the recall cache (ADR D3)', () => {
  test('test_recency_collapse_bypasses_recall_cache', async () => {
    const cache = makeSpyCache();
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: makeEmbedder(),
      llm: makeLlm(),
      recallCache: cache,
    });

    await memory.user('alice').recall('coffee', { recencyCollapse: {} });

    expect(cache.getCalls).toBe(0);
    expect(cache.setCalls).toBe(0);
  });
});
