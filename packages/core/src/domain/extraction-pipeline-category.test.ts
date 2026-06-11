/**
 * T3.3 of themory-category-filter-server-side plan v1.2 —
 * runExtractionPipeline routes RememberOptions.category into payload['category']
 * via both write paths (`infer:false` verbatim + LLM-extraction) AND enforces
 * the EC-2 SDK-layer length cap (1-64 chars) at the pipeline entry boundary.
 *
 * Tests:
 *  - infer:false propagation — single message + options.category lands in payload
 *  - LLM-extraction propagation — N extracted facts ALL receive the SAME
 *    operator-supplied options.category (ADR D1: category is operator-supplied,
 *    not per-fact LLM-inferred)
 *  - EC-2 boundary: throws InvalidScope when category.length === 0
 *  - EC-2 boundary: throws InvalidScope when category.length === 65
 *  - EC-2 boundary: accepts exactly 64 chars (does NOT throw)
 *
 * @see .claude/knowledge-base/plans/themory-category-filter-server-side-plan.md § T3.3 + EC-2 + ADR D1
 */
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { LLM } from './dip/llm.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from './dip/vector-store.js';
import { InvalidScope } from './errors.js';
import { runExtractionPipeline } from './extraction/pipeline.js';
import type { Filters } from './scope.js';

type Payload = Record<string, string | number | boolean | null>;

class StubVectorStore implements VectorStore {
  readonly inserted: Payload[] = [];
  private rows = new Map<string, { vector: readonly number[]; payload: Payload }>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }
  async insert(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
  ): Promise<readonly InsertOutcome[]> {
    const outcomes: InsertOutcome[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i] as string;
      const payload = payloads[i] as Payload;
      this.rows.set(id, { vector: vectors[i] as readonly number[], payload });
      this.inserted.push(payload);
      outcomes.push({ id, confirmationCount: 1, rejectedAsDuplicate: false });
    }
    await Promise.resolve();
    return outcomes;
  }
  async search(): Promise<readonly VectorStoreResult[]> {
    await Promise.resolve();
    return [];
  }
  keywordSearch(): Promise<readonly VectorStoreResult[] | null> {
    return Promise.resolve(null);
  }
  async get(): Promise<VectorStoreResult | null> {
    await Promise.resolve();
    return null;
  }
  update(): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
  deleteCol(): Promise<void> {
    return Promise.resolve();
  }
  async list(
    _filters?: Filters,
    _topK = 100,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    await Promise.resolve();
    return [[], 0];
  }
  getUserId(): Promise<string> {
    return Promise.resolve('');
  }
  setUserId(): Promise<void> {
    return Promise.resolve();
  }
}

const mockEmbedding = (): readonly number[] => {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[0] = 0.1;
  return v;
};

const makeEmbedder = (): Embedder => ({
  embed: vi.fn(async () => mockEmbedding()),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => mockEmbedding())),
});

const makeLlm = (response: unknown): LLM => ({
  generateResponse: vi.fn(async () => response),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

describe('runExtractionPipeline — T3.3 category propagation + EC-2 boundary', () => {
  test('infer:false propagates options.category into payload[category]', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(
      [{ role: 'user', content: 'I prefer aeropress' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm: makeLlm({ memory: [] }) },
      { infer: false, category: 'preferences' },
    );

    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]?.['category']).toBe('preferences');
  });

  test('LLM extraction path propagates options.category to ALL extracted facts (ADR D1)', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({
      memory: [
        { id: '1', text: 'Fact A' },
        { id: '2', text: 'Fact B' },
        { id: '3', text: 'Fact C' },
      ],
    });
    await runExtractionPipeline(
      [{ role: 'user', content: 'multi-fact input' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
      { category: 'travel' },
    );

    expect(store.inserted).toHaveLength(3);
    // Same operator-supplied category attached to every fact (NOT per-fact LLM-inferred).
    expect(store.inserted.every((p) => p['category'] === 'travel')).toBe(true);
  });

  test('omitting options.category leaves payload[category] absent (backward-compat)', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(
      [{ role: 'user', content: 'no-category write' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm: makeLlm({ memory: [] }) },
      { infer: false },
    );

    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]?.['category']).toBeUndefined();
  });

  test('EC-2 — throws InvalidScope when category.length === 0', async () => {
    const store = new StubVectorStore();
    await expect(
      runExtractionPipeline(
        [{ role: 'user', content: 'irrelevant' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm: makeLlm({ memory: [] }) },
        { category: '' },
      ),
    ).rejects.toThrow(InvalidScope);
    // Nothing inserted — throw fires BEFORE branch dispatch.
    expect(store.inserted).toHaveLength(0);
  });

  test('EC-2 — throws InvalidScope when category.length > 64', async () => {
    const store = new StubVectorStore();
    const tooLong = 'x'.repeat(65);
    await expect(
      runExtractionPipeline(
        [{ role: 'user', content: 'irrelevant' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm: makeLlm({ memory: [] }) },
        { category: tooLong },
      ),
    ).rejects.toThrow(InvalidScope);
    expect(store.inserted).toHaveLength(0);
  });

  test('EC-2 — accepts exactly 64 chars (boundary inclusive)', async () => {
    const store = new StubVectorStore();
    const exact64 = 'a'.repeat(64);
    await runExtractionPipeline(
      [{ role: 'user', content: 'boundary' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm: makeLlm({ memory: [] }) },
      { infer: false, category: exact64 },
    );
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]?.['category']).toBe(exact64);
  });
});
