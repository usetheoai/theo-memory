/**
 * RED-phase tests for src/core/retrieval/pipeline.ts — T5.1 of v0-1-local-runtime plan v1.3.
 *
 * 9-step search per blueprint D2: preprocess -> embed -> semantic over-fetch ->
 * BM25 -> sigmoid normalization -> entity boost -> combined score -> threshold ->
 * format.
 */
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { VectorStore, VectorStoreResult } from './dip/vector-store.js';
import { runRetrievalPipeline } from './retrieval/pipeline.js';

const mockEmbedding = (): readonly number[] => {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[0] = 0.1;
  return v;
};

const makeEmbedder = (): Embedder => ({
  embed: vi.fn(async () => mockEmbedding()),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => mockEmbedding())),
});

interface FakeRow {
  readonly id: string;
  readonly text: string;
  readonly semanticScore: number;
  readonly bm25Raw?: number;
}

function makeStore(rows: readonly FakeRow[], bm25Mode: 'pass' | 'null' = 'pass'): VectorStore {
  const search = vi.fn(async (_q: readonly number[], topK: number): Promise<readonly VectorStoreResult[]> => {
    return rows
      .map((r) => ({ id: r.id, payload: { text: r.text, hash: r.id }, score: r.semanticScore }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);
  });
  const keywordSearch = vi.fn(async (_query: string, topK: number): Promise<readonly VectorStoreResult[] | null> => {
    if (bm25Mode === 'null') {
      return null;
    }
    const out: VectorStoreResult[] = [];
    for (const r of rows) {
      if (r.bm25Raw !== undefined && r.bm25Raw > 0) {
        out.push({ id: r.id, payload: { text: r.text, hash: r.id }, score: r.bm25Raw });
      }
    }
    return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
  });
  return {
    initialize: () => Promise.resolve(),
    insert: () => Promise.resolve([] as const),
    search,
    keywordSearch,
    get: () => Promise.resolve(null),
    update: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    deleteInScope: () => Promise.resolve(false),
    deleteCol: () => Promise.resolve(),
    list: () => Promise.resolve([[], 0]),
    getUserId: () => Promise.resolve(''),
    setUserId: () => Promise.resolve(),
  };
}

const setupTracer = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
};

describe('runRetrievalPipeline (9-step search)', () => {
  test('returns top-K candidates above threshold ordered by combined score', async () => {
    const store = makeStore([
      { id: 'a', text: 'first', semanticScore: 0.9 },
      { id: 'b', text: 'second', semanticScore: 0.7 },
      { id: 'c', text: 'third', semanticScore: 0.5 },
    ]);
    const results = await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 2, threshold: 0.1 },
    );
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results[0]?.id).toBe('a');
  });

  test('semantic threshold gates BEFORE combining (results below threshold dropped)', async () => {
    const store = makeStore([
      { id: 'high', text: 'high', semanticScore: 0.8 },
      { id: 'low', text: 'low', semanticScore: 0.05 },
    ]);
    const results = await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 10, threshold: 0.1 },
    );
    expect(results.map((r) => r.id)).toContain('high');
    expect(results.map((r) => r.id)).not.toContain('low');
  });

  test('empty result set when nothing exceeds threshold', async () => {
    const store = makeStore([
      { id: 'a', text: 't', semanticScore: 0.01 },
    ]);
    const results = await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 10, threshold: 0.5 },
    );
    expect(results).toEqual([]);
  });

  test('handles null keywordSearch (DIP opt-out): pipeline does NOT throw', async () => {
    const store = makeStore(
      [{ id: 'a', text: 't', semanticScore: 0.9 }],
      'null',
    );
    const results = await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 10, threshold: 0.1 },
    );
    expect(results).toHaveLength(1);
  });

  test('over-fetches with max(topK*4, 60) (upstream reference)', async () => {
    const store = makeStore([{ id: 'a', text: 't', semanticScore: 0.9 }]);
    await runRetrievalPipeline(
      'q',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 5, threshold: 0.1 },
    );
    const searchCalls = (store.search as ReturnType<typeof vi.fn>).mock.calls;
    const firstCall = searchCalls[0] as [readonly number[], number, ...unknown[]];
    expect(firstCall[1]).toBe(Math.max(5 * 4, 60));
  });

  test('returns MemoryItemWithScore shape (includes score field)', async () => {
    const store = makeStore([{ id: 'a', text: 't', semanticScore: 0.9 }]);
    const results = await runRetrievalPipeline(
      'q',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 1, threshold: 0.1 },
    );
    expect(results[0]?.score).toBeGreaterThan(0);
    expect(results[0]?.score).toBeLessThanOrEqual(1);
  });

  test('handles empty query string (EC-11): does NOT throw; returns semantic-only', async () => {
    const store = makeStore([{ id: 'a', text: 't', semanticScore: 0.9 }]);
    const results = await runRetrievalPipeline(
      '',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 1, threshold: 0.1 },
    );
    expect(results.length).toBeGreaterThan(0);
  });

  test('emits search-step events when tracer provided', async () => {
    const { tracer, exporter } = setupTracer();
    const store = makeStore([{ id: 'a', text: 't', semanticScore: 0.9 }]);
    await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), tracer },
      { topK: 1, threshold: 0.1 },
    );
    const spanNames = new Set(exporter.getFinishedSpans().map((s) => s.name));
    // Plan: at least the formal step events should be observable
    expect(spanNames.size).toBeGreaterThan(0);
  });

  test('principles-alignment-hardening T4.1 — emits recall_threshold_filtered when sub-threshold rows are dropped (ADR D2 Princípio 3)', async () => {
    const { tracer, exporter } = setupTracer();
    // 5 candidates with semantic scores; threshold=0.5 will drop the 3 sub-threshold ones.
    const store = makeStore([
      { id: 'a', text: 'kept-1', semanticScore: 0.9 },
      { id: 'b', text: 'kept-2', semanticScore: 0.7 },
      { id: 'c', text: 'dropped-1', semanticScore: 0.3 },
      { id: 'd', text: 'dropped-2', semanticScore: 0.2 },
      { id: 'e', text: 'dropped-3', semanticScore: 0.1 },
    ]);
    await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), tracer },
      { topK: 10, threshold: 0.5 },
    );
    const filteredSpan = exporter.getFinishedSpans().find((s) => s.name === 'recall_threshold_filtered');
    expect(filteredSpan).toBeDefined();
    expect(filteredSpan!.attributes['filtered_count']).toBe(3);
    expect(filteredSpan!.attributes['pre_threshold_count']).toBe(5);
    expect(filteredSpan!.attributes['post_threshold_count']).toBe(2);
  });

  test('principles-alignment-hardening T4.1 — NO event emission when filtered_count === 0 (no-op observability discipline)', async () => {
    const { tracer, exporter } = setupTracer();
    // All candidates clear the threshold — no sub-threshold rows dropped.
    const store = makeStore([
      { id: 'a', text: 'kept-1', semanticScore: 0.9 },
      { id: 'b', text: 'kept-2', semanticScore: 0.8 },
    ]);
    await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), tracer },
      { topK: 10, threshold: 0.5 },
    );
    const filteredSpan = exporter.getFinishedSpans().find((s) => s.name === 'recall_threshold_filtered');
    expect(filteredSpan).toBeUndefined();
  });

  test('principles-alignment-hardening T4.1 EC-5 — recall_threshold_filtered no-op when tracer === undefined', async () => {
    const store = makeStore([
      { id: 'a', text: 'kept', semanticScore: 0.9 },
      { id: 'b', text: 'dropped', semanticScore: 0.2 },
    ]);
    // No tracer in deps — pipeline must not throw + must return results normally.
    const results = await runRetrievalPipeline(
      'query',
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder() },
      { topK: 10, threshold: 0.5 },
    );
    expect(results).toHaveLength(1);
  });
});
