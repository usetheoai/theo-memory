/**
 * T3.1 + T4.1 of auto-categorization-write-pipeline — runExtractionPipeline auto-assigns
 * a model-derived category (LLM-emitted `category`) into payload['category'] when the
 * caller supplied none and auto-categorization is enabled, with operator precedence,
 * fail-soft, and the EC-1/EC-2/EC-5 trim+bound guards.
 *
 * @see .claude/knowledge-base/plans/auto-categorization-write-pipeline-plan.md § Phase 3 / T3.1 + Phase 4 / T4.1
 */
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { LLM } from './dip/llm.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from './dip/vector-store.js';
import { runExtractionPipeline } from './extraction/pipeline.js';
import type { Filters } from './scope.js';

type Payload = Record<string, string | number | boolean | null>;

class StubVectorStore implements VectorStore {
  readonly inserted: Payload[] = [];
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  async insert(
    _vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
  ): Promise<readonly InsertOutcome[]> {
    const outcomes: InsertOutcome[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      this.inserted.push(payloads[i] as Payload);
      outcomes.push({ id: ids[i] as string, confirmationCount: 1, rejectedAsDuplicate: false });
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
  deleteInScope(): Promise<boolean> {
    return Promise.resolve(false);
  }
  deleteCol(): Promise<void> {
    return Promise.resolve();
  }
  async list(): Promise<readonly [readonly VectorStoreResult[], number]> {
    await Promise.resolve();
    return [[], 0];
  }
  async listEpisodes(): Promise<readonly VectorStoreResult[]> {
    await Promise.resolve();
    return [];
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
const filters: Filters = { user_id: 'alice' };
const msg = [{ role: 'user' as const, content: 'a message' }];

describe('runExtractionPipeline — auto-categorization (T3.1)', () => {
  test('test_autocategory_populates_when_no_operator_category', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'Bob enjoys hiking', category: 'preferences' }] }),
      autoCategorize: { enabled: true },
    });
    expect(store.inserted[0]?.['category']).toBe('preferences');
  });

  test('test_operator_category_overrides_llm', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: 'preferences' }] }),
      autoCategorize: { enabled: true },
    }, { category: 'work' });
    expect(store.inserted[0]?.['category']).toBe('work');
  });

  test('test_disabled_flag_restores_operator_only', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: 'preferences' }] }),
      autoCategorize: { enabled: false },
    });
    expect(store.inserted[0]?.['category']).toBeUndefined();
  });

  test('test_failsoft_when_llm_omits_category', async () => {
    const store = new StubVectorStore();
    await expect(
      runExtractionPipeline(msg, filters, {
        vectorStore: store,
        embedder: makeEmbedder(),
        llm: makeLlm({ memory: [{ id: '1', text: 'a fact' }] }),
        autoCategorize: { enabled: true },
      }),
    ).resolves.toBeDefined();
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]?.['category']).toBeUndefined();
  });

  test('test_emits_category_auto_assigned_event_with_source', async () => {
    const store = new StubVectorStore();
    const setAttribute = vi.fn();
    const startActiveSpan = vi.fn((_n: string, fn: (s: { setAttribute: typeof setAttribute; end: () => void }) => void) => {
      fn({ setAttribute, end: () => undefined });
    });
    const tracer = { startActiveSpan } as unknown as Parameters<typeof runExtractionPipeline>[2]['tracer'];
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: 'work' }] }),
      autoCategorize: { enabled: true },
      tracer,
    });
    expect(startActiveSpan).toHaveBeenCalledWith('category_auto_assigned', expect.any(Function));
    expect(setAttribute).toHaveBeenCalledWith('source', 'taxonomy');
  });

  test('test_autocategory_drops_oversized_label', async () => {
    const store = new StubVectorStore();
    const oversized = 'x'.repeat(70);
    await expect(
      runExtractionPipeline(msg, filters, {
        vectorStore: store,
        embedder: makeEmbedder(),
        llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: oversized }] }),
        autoCategorize: { enabled: true },
      }),
    ).resolves.toBeDefined();
    expect(store.inserted[0]?.['category']).toBeUndefined();
  });

  test('test_autocategory_trims_and_stores', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: '  work ' }] }),
      autoCategorize: { enabled: true },
    });
    expect(store.inserted[0]?.['category']).toBe('work');
  });

  test('test_autocategory_drops_non_string', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: 123 }] }),
      autoCategorize: { enabled: true },
    });
    expect(store.inserted[0]?.['category']).toBeUndefined();
  });

  test('test_autocategory_drops_whitespace_only', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: '   ' }] }),
      autoCategorize: { enabled: true },
    });
    expect(store.inserted[0]?.['category']).toBeUndefined();
  });
});

describe('auto-categorization integration (T4.1)', () => {
  test('auto-categorization pipeline populates payload.category from the LLM draft when no operator category is supplied', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'Bob works at Meta', category: 'work' }] }),
      autoCategorize: { enabled: true },
    });
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]?.['category']).toBe('work');
  });

  test('integration_operator_override — operator category wins through the full pipeline', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact', category: 'preferences' }] }),
      autoCategorize: { enabled: true },
    }, { category: 'financial' });
    expect(store.inserted[0]?.['category']).toBe('financial');
  });

  test('integration_failsoft_persists_uncategorized — LLM omits category, row persists', async () => {
    const store = new StubVectorStore();
    await runExtractionPipeline(msg, filters, {
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm({ memory: [{ id: '1', text: 'a fact' }] }),
      autoCategorize: { enabled: true },
    });
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]?.['category']).toBeUndefined();
  });
});
