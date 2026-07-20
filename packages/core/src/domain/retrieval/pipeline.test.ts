/**
 * Unit tests for the recall-trace write side-effect in runRetrievalPipeline
 * (explainable-recall T3.1). Stubs the vector store + embedder so candidates
 * drop below the threshold, and a stub RecallTraceStore captures record().
 *
 * Asserts: dropped candidates are traced with breakdown + drop-reason; the
 * kept/returned set is IDENTICAL whether tracing is on or off (D1 invariant);
 * the write is fail-soft (D3); 0 drops → no write; truncation caps at maxRows
 * (EC-4); the write requires BOTH recallTrace AND recallTraceContext (EC-5).
 *
 * @see plan explainable-recall § Phase 3 / T3.1
 */
import { describe, expect, test, vi } from 'vitest';

import type { RecallTraceBatch, RecallTraceStore } from '../dip/recall-trace-store.js';
import type { VectorStore, VectorStoreResult } from '../dip/vector-store.js';
import type { Embedder } from '../dip/embedder.js';
import type { Filters } from '../scope.js';

import { runRetrievalPipeline, type RetrievalDeps } from './pipeline.js';

const embedder: Embedder = {
  embed: async () => [0.1, 0.2, 0.3],
  embedBatch: async (texts: readonly string[]) => texts.map(() => [0.1, 0.2, 0.3]),
};

function vectorStoreReturning(results: VectorStoreResult[]): VectorStore {
  return {
    search: async () => results,
    keywordSearch: async () => [],
  } as unknown as VectorStore;
}

const FILTERS: Filters = { user_id: 'u1' };

function ctx(maxRows = 200) {
  return { recallId: 'r1', workspaceId: 'ws1', scopeKey: 'user:u1', maxRows };
}

/** A stub store that records the batches it receives. */
function stubStore(): { store: RecallTraceStore; batches: RecallTraceBatch[] } {
  const batches: RecallTraceBatch[] = [];
  const store: RecallTraceStore = {
    record: async (b) => {
      batches.push(b);
    },
    getByRecallId: async () => [],
  };
  return { store, batches };
}

describe('runRetrievalPipeline recall trace', () => {
  const candidates: VectorStoreResult[] = [
    { id: 'm0', score: 0.8, payload: { text: 'kept' } },
    { id: 'm1', score: 0.2, payload: { text: 'drop-a' } },
    { id: 'm2', score: 0.3, payload: { text: 'drop-b' } },
  ];

  test('test_pipeline_traces_threshold_drops — drops recorded with breakdown; kept set unchanged', async () => {
    const { store, batches } = stubStore();
    const deps: RetrievalDeps = {
      vectorStore: vectorStoreReturning(candidates),
      embedder,
      recallTrace: store,
      recallTraceContext: ctx(),
    };
    const kept = await runRetrievalPipeline('q', FILTERS, deps, { threshold: 0.5, topK: 10 });

    // D1 invariant: only the above-threshold candidate survives.
    expect(kept.map((k) => k.id)).toEqual(['m0']);

    // The two sub-threshold candidates are traced.
    expect(batches).toHaveLength(1);
    expect(batches[0]?.recallId).toBe('r1');
    expect(batches[0]?.workspaceId).toBe('ws1');
    const byId = new Map(batches[0]?.rows.map((r) => [r.memoryId, r]));
    expect(new Set(byId.keys())).toEqual(new Set(['m1', 'm2']));
    expect(byId.get('m1')?.dropReason).toBe('semantic_gate');
    expect(byId.get('m1')?.composite).toBeNull(); // semantic_gate → not computed (EC-6)
    expect(byId.get('m1')?.semantic).toBeCloseTo(0.2, 5);
    expect(byId.get('m1')?.threshold).toBe(0.5);
  });

  test('kept set is byte-identical whether tracing is on or off (D1)', async () => {
    const base: RetrievalDeps = { vectorStore: vectorStoreReturning(candidates), embedder };
    const off = await runRetrievalPipeline('q', FILTERS, base, { threshold: 0.5, topK: 10 });
    const { store } = stubStore();
    const on = await runRetrievalPipeline(
      'q',
      FILTERS,
      { ...base, recallTrace: store, recallTraceContext: ctx() },
      { threshold: 0.5, topK: 10 },
    );
    expect(on.map((r) => r.id)).toEqual(off.map((r) => r.id));
  });

  test('test_pipeline_failsoft_and_zero_drops — record throws → recall still returns; 0 drops → no write', async () => {
    // fail-soft: record rejects, recall must still return the kept set.
    const throwing: RecallTraceStore = {
      record: async () => {
        throw new Error('boom');
      },
      getByRecallId: async () => [],
    };
    const kept = await runRetrievalPipeline(
      'q',
      FILTERS,
      { vectorStore: vectorStoreReturning(candidates), embedder, recallTrace: throwing, recallTraceContext: ctx() },
      { threshold: 0.5, topK: 10 },
    );
    expect(kept.map((k) => k.id)).toEqual(['m0']);

    // 0 drops: every candidate above threshold → no record() call.
    const { store, batches } = stubStore();
    const spy = vi.spyOn(store, 'record');
    await runRetrievalPipeline(
      'q',
      FILTERS,
      { vectorStore: vectorStoreReturning([{ id: 'a', score: 0.9, payload: { text: 't' } }]), embedder, recallTrace: store, recallTraceContext: ctx() },
      { threshold: 0.1, topK: 10 },
    );
    // Either not called, or called with empty rows (no persisted drop).
    const persisted = batches.reduce((n, b) => n + b.rows.length, 0);
    expect(persisted).toBe(0);
    spy.mockRestore();
  });

  test('test_pipeline_marks_trace_truncated — drops > maxRows persist only maxRows (EC-4)', async () => {
    const { store, batches } = stubStore();
    await runRetrievalPipeline(
      'q',
      FILTERS,
      { vectorStore: vectorStoreReturning(candidates), embedder, recallTrace: store, recallTraceContext: ctx(1) },
      { threshold: 0.5, topK: 10 },
    );
    // 2 drops, maxRows=1 → exactly 1 persisted.
    expect(batches[0]?.rows).toHaveLength(1);
  });

  test('test_pipeline_traces_sub_threshold_drops — passes semantic gate but composite < threshold (bm25 active)', async () => {
    const { store, batches } = stubStore();
    // Activate the bm25 signal (maxScore = 2) via a keyword hit on `kept`; then
    // `msub` has semantic 0.6 ≥ threshold 0.5 (passes the semantic gate) but
    // bm25 0 → combined 0.6/2 = 0.3 < 0.5 → sub_threshold (composite COMPUTED, not null).
    const vs = {
      search: async () => [
        { id: 'kept', score: 0.95, payload: { text: 'kept' } },
        { id: 'msub', score: 0.6, payload: { text: 'sub' } },
      ],
      keywordSearch: async () => [{ id: 'kept', score: 5.0, payload: { text: 'kept' } }],
    } as unknown as VectorStore;
    await runRetrievalPipeline(
      'hello world',
      FILTERS,
      { vectorStore: vs, embedder, recallTrace: store, recallTraceContext: ctx() },
      { threshold: 0.5, topK: 10 },
    );
    const row = batches[0]?.rows.find((r) => r.memoryId === 'msub');
    expect(row?.dropReason).toBe('sub_threshold');
    expect(row?.composite).toBeCloseTo(0.3, 2); // COMPUTED (distinguishes from semantic_gate's null)
  });

  test('test_pipeline_traces_mmr_drops — MMR-unselected pool candidates traced as mmr_redundant', async () => {
    const { store, batches } = stubStore();
    const all: VectorStoreResult[] = [
      { id: 'a', score: 0.9, payload: { text: 'a' } },
      { id: 'b', score: 0.85, payload: { text: 'b' } },
      { id: 'c', score: 0.8, payload: { text: 'c' } },
    ];
    await runRetrievalPipeline(
      'q',
      FILTERS,
      { vectorStore: vectorStoreReturning(all), embedder, recallTrace: store, recallTraceContext: ctx() },
      { threshold: 0.1, topK: 1, diversify: { lambda: 1, topPool: 3 } },
    );
    // topK=1 selects 1 of the 3-candidate pool → the other 2 are mmr_redundant,
    // breakdown recovered from the candidates Map (composite = the combined score, not null).
    const mmr = (batches[0]?.rows ?? []).filter((r) => r.dropReason === 'mmr_redundant');
    expect(mmr).toHaveLength(2);
    expect(mmr[0]?.composite).not.toBeNull();
    expect(mmr[0]?.semantic).toBeGreaterThan(0);
  });

  // NOTE: the 'nan' drop-reason branch is DEFENSIVE — `combineScores` returns 0
  // (not NaN) when maxScore is 0 and never produces NaN from finite inputs, so
  // 'nan' is unreachable in practice from a real scoring pass. Kept for safety.

  test('test_pipeline_skips_when_context_incomplete — recallTrace without context → no write (EC-5)', async () => {
    const { store, batches } = stubStore();
    const kept = await runRetrievalPipeline(
      'q',
      FILTERS,
      { vectorStore: vectorStoreReturning(candidates), embedder, recallTrace: store },
      { threshold: 0.5, topK: 10 },
    );
    expect(kept.map((k) => k.id)).toEqual(['m0']);
    expect(batches).toHaveLength(0);
  });
});
