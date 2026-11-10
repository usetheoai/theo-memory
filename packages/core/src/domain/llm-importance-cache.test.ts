/**
 * T5.2 tests for scoreAndCacheImportance per plan v0-4a-reflection-pipeline.
 *
 * Validates CLAUDE.md Item 5 acceptance verbatim:
 *   "LLM-importance score persisted on first write; second-write same content
 *    does NOT re-invoke LLM."
 *
 * Pure-unit test using a fake cache store. Real DB integration is exercised
 * by the store's own tests (PgvectorStore.getImportanceByHash via integration
 * env-gated suite).
 *
 */
import { describe, expect, test } from 'vitest';

import type { LLM } from './dip/llm.js';
import type { LLMResponse, Message } from './message.js';
import {
  scoreAndCacheImportance,
  type ImportanceCacheStore,
} from './reflection/importance.js';

class FakeStore implements ImportanceCacheStore {
  private cache = new Map<string, number>();
  public getCalls = 0;
  public setCalls = 0;

  async getImportanceByHash(hash: string): Promise<number | null> {
    this.getCalls++;
    await Promise.resolve();
    return this.cache.get(hash) ?? null;
  }

  async setImportanceByHash(hash: string, score: number): Promise<void> {
    this.setCalls++;
    this.cache.set(hash, score);
    await Promise.resolve();
  }
}

function mockLLM(content: string): { llm: LLM; callCount: () => number } {
  let calls = 0;
  const llm: LLM = {
    async generateResponse() {
      return Promise.resolve('unused');
    },
    async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
      calls++;
      return Promise.resolve({ content, role: 'assistant' });
    },
  };
  return { llm, callCount: () => calls };
}

describe('scoreAndCacheImportance (T5.2)', () => {
  test('first call: cache miss → LLM invoked + score persisted', async () => {
    const store = new FakeStore();
    const { llm, callCount } = mockLLM('7');
    const score = await scoreAndCacheImportance('Alice likes coffee', 'hash-1', store, llm);
    expect(score).toBeCloseTo(6 / 9);
    expect(callCount()).toBe(1);
    expect(store.setCalls).toBe(1);
  });

  test('CLAUDE.md Item 5: second call same hash → LLM NOT invoked', async () => {
    const store = new FakeStore();
    const { llm, callCount } = mockLLM('7');
    await scoreAndCacheImportance('Alice likes coffee', 'hash-1', store, llm);
    expect(callCount()).toBe(1);
    // Second call with same hash
    const score2 = await scoreAndCacheImportance('Alice likes coffee', 'hash-1', store, llm);
    expect(score2).toBeCloseTo(6 / 9);
    expect(callCount()).toBe(1); // STILL 1 — cache hit
  });

  test('different content (different hash) → LLM invoked again', async () => {
    const store = new FakeStore();
    const { llm, callCount } = mockLLM('5');
    await scoreAndCacheImportance('text A', 'hash-a', store, llm);
    await scoreAndCacheImportance('text B', 'hash-b', store, llm);
    expect(callCount()).toBe(2);
  });

  test('cached score is REUSED verbatim (no re-clamping)', async () => {
    const store = new FakeStore();
    // Pre-seed cache directly
    await store.setImportanceByHash('hash-x', 0.42);
    const { llm, callCount } = mockLLM('99');
    const score = await scoreAndCacheImportance('text', 'hash-x', store, llm);
    expect(score).toBe(0.42);
    expect(callCount()).toBe(0);
  });

  // #239: the policy reads the stored value as a [0, 1] importance; the 1-10 rating is mapped onto it.
  test.each([
    ['1', 0],
    ['10', 1],
    ['5.5', 0.5],
    ['99', 1],
  ])('rating %s is stored as %s', async (reply, stored) => {
    const store = new FakeStore();
    const { llm } = mockLLM(reply);
    const score = await scoreAndCacheImportance('text', 'hash-n', store, llm);
    expect(score).toBeCloseTo(stored);
    expect(await store.getImportanceByHash('hash-n')).toBeCloseTo(stored);
  });
});
