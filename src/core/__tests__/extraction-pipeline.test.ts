/**
 * RED-phase tests for src/core/extraction/pipeline.ts — T4.3 of v0-1-local-runtime plan v1.3.
 *
 * 8-phase write pipeline per blueprint D1 + ADR D1.0. Tests use:
 *  - Content-based LLM mock (parses prompt + echoes extracted text)
 *  - Mock embedder (fixed 1536-dim vector)
 *  - Inline minimal VectorStore stub (NOT InMemoryVectorStore — DIP boundary)
 *  - In-memory OTel exporter for span assertions
 *
 * Pattern per blueprint Recommendation 11.
 */
import { describe, expect, test, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { MAX_EMBEDDING_DIM } from '../constants.js';
import type { Embedder } from '../dip/embedder.js';
import type { LLM } from '../dip/llm.js';
import type { VectorStore, VectorStoreResult } from '../dip/vector-store.js';
import type { Filters } from '../scope.js';
import { runExtractionPipeline } from '../extraction/pipeline.js';

type Payload = Record<string, string | number | boolean | null>;

class StubVectorStore implements VectorStore {
  private rows = new Map<string, { vector: readonly number[]; payload: Payload }>();

  initialize(): Promise<void> { return Promise.resolve(); }
  async insert(vectors: readonly (readonly number[])[], ids: readonly string[], payloads: readonly Payload[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 1) {
      this.rows.set(ids[i] as string, { vector: vectors[i] as readonly number[], payload: payloads[i] as Payload });
    }
    await Promise.resolve();
  }
  async search(_q: readonly number[], topK = 10, _filters?: Filters): Promise<readonly VectorStoreResult[]> {
    const out: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      out.push({ id, payload: row.payload });
      if (out.length >= topK) break;
    }
    await Promise.resolve();
    return out;
  }
  keywordSearch(): Promise<readonly VectorStoreResult[] | null> { return Promise.resolve(null); }
  async get(id: string): Promise<VectorStoreResult | null> {
    const row = this.rows.get(id);
    await Promise.resolve();
    return row === undefined ? null : { id, payload: row.payload };
  }
  async update(id: string, vector: readonly number[], payload: Payload): Promise<void> {
    this.rows.set(id, { vector, payload });
    await Promise.resolve();
  }
  async delete(id: string): Promise<void> { this.rows.delete(id); await Promise.resolve(); }
  async deleteCol(): Promise<void> { this.rows.clear(); await Promise.resolve(); }
  async list(filters?: Filters, topK = 100): Promise<readonly [readonly VectorStoreResult[], number]> {
    const matches: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      let ok = true;
      if (filters !== undefined) {
        for (const [k, v] of Object.entries(filters)) {
          if (v !== undefined && row.payload[k] !== v) { ok = false; break; }
        }
      }
      if (ok) matches.push({ id, payload: row.payload });
    }
    await Promise.resolve();
    return [matches.slice(0, topK), matches.length];
  }
  getUserId(): Promise<string> { return Promise.resolve(''); }
  setUserId(): Promise<void> { return Promise.resolve(); }
  get size(): number { return this.rows.size; }
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

const setupTracer = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
};

describe('runExtractionPipeline (8-phase write)', () => {
  test('persists one fact extracted from a 1-message conversation', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'Paulo likes coffee' }] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'I love coffee' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Paulo likes coffee');
    expect(result[0]?.scope).toEqual({ kind: 'user', userId: 'alice' });
  });

  test('EC-9: empty extraction returns [] without persist call', async () => {
    const store = new StubVectorStore();
    const insertSpy = vi.spyOn(store, 'insert');
    const llm = makeLlm({ memory: [] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'silence' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toEqual([]);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test('EC-10: malformed LLM JSON returns [] + emits extraction_failed event', async () => {
    const { tracer, exporter } = setupTracer();
    const store = new StubVectorStore();
    const llm = makeLlm('not json at all');
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
    );
    expect(result).toEqual([]);
    const spanNames = exporter.getFinishedSpans().map((s) => s.name);
    expect(spanNames).toContain('extraction_failed');
  });

  test('skips dedup hit (hash collision against existing memory)', async () => {
    const store = new StubVectorStore();
    const llm1 = makeLlm({ memory: [{ id: '0', text: 'Paulo likes coffee' }] });
    await runExtractionPipeline(
      [{ role: 'user', content: 'first time' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm: llm1 },
    );
    const llm2 = makeLlm({ memory: [{ id: '0', text: 'Paulo likes coffee' }] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'second time' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm: llm2 },
    );
    expect(result).toEqual([]);
  });

  test('per-row fallback on embedBatch failure: still persists via single embed', async () => {
    const store = new StubVectorStore();
    const embedder: Embedder = {
      embed: vi.fn(async () => mockEmbedding()),
      embedBatch: vi.fn(async () => { throw new Error('batch endpoint down'); }),
    };
    const llm = makeLlm({ memory: [{ id: '0', text: 'Paulo likes coffee' }] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder, llm },
    );
    expect(result).toHaveLength(1);
    expect(embedder.embed).toHaveBeenCalled();
  });

  test('emits spans for extraction/embedding/persist completion when tracer provided', async () => {
    const { tracer, exporter } = setupTracer();
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
    );
    const spanNames = new Set(exporter.getFinishedSpans().map((s) => s.name));
    expect(spanNames.has('extraction_completed')).toBe(true);
    expect(spanNames.has('embedding_batch_completed')).toBe(true);
    expect(spanNames.has('persist_completed')).toBe(true);
  });

  test('infer:false fast-path persists message text verbatim (no LLM call)', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'verbatim fact' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
      { infer: false },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('verbatim fact');
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  test('propagates scope into persisted payload', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice', session_id: 's1' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    const [rows] = await store.list({ user_id: 'alice', session_id: 's1' });
    expect(rows.length).toBe(1);
  });

  test('calls historyManager.batchAddHistory when provided (with optional batch method)', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    const batchAddHistory = vi.fn(async () => undefined);
    const historyManager = {
      addHistory: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => []),
      reset: vi.fn(async () => undefined),
      close: vi.fn(() => undefined),
      batchAddHistory,
    };
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, historyManager },
    );
    expect(batchAddHistory).toHaveBeenCalledOnce();
  });

  test('history is skipped when historyManager is absent (no throw)', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toHaveLength(1);
  });
});
