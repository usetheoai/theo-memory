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
import { InvalidScope, RerankerConflict } from '../errors.js';

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

/**
 * M10 T3.1 — the opt-in scope-aware reweight stage. With `options.scopes`, the post-threshold
 * pool is re-ordered by scope-of-origin (session recency-boost) before top-K; without it the
 * order is byte-identical to today. `scopes` + `rerank`/`diversify` throws the mutual-exclusion
 * guard; an out-of-[0,1] weight throws InvalidScope at the boundary.
 * @see plan m10-scope-aware-recall § Phase 3 / T3.1
 */
describe('runRetrievalPipeline M10 scope-aware reweight', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const oldIso = new Date(Date.now() - 60 * DAY).toISOString();
  const newIso = new Date(Date.now() - 0 * DAY).toISOString();
  // Two session-origin candidates; base order is [old(0.75), new(0.70)] by raw score.
  const twoSession: VectorStoreResult[] = [
    { id: 'old', score: 0.75, payload: { text: 'old', session_id: 's', created_at: oldIso } },
    { id: 'new', score: 0.7, payload: { text: 'new', session_id: 's', created_at: newIso } },
  ];

  test('test_pipeline_applies_scope_reweight_when_scopes_set — newer session row surfaces above older', async () => {
    const deps: RetrievalDeps = { vectorStore: vectorStoreReturning(twoSession), embedder };
    const out = await runRetrievalPipeline('q', FILTERS, deps, {
      threshold: 0.1,
      topK: 10,
      scopes: { sessionRecencyWeight: 1, globalStabilityWeight: 0.3 },
    });
    // Recency boost flips the base [old, new] order to [new, old].
    expect(out.map((r) => r.id)).toEqual(['new', 'old']);
  });

  test('without scopes the order is byte-identical to today (base score order)', async () => {
    const deps: RetrievalDeps = { vectorStore: vectorStoreReturning(twoSession), embedder };
    const out = await runRetrievalPipeline('q', FILTERS, deps, { threshold: 0.1, topK: 10 });
    expect(out.map((r) => r.id)).toEqual(['old', 'new']);
  });

  test('scopes + rerank throws the mutual-exclusion guard (RerankerConflict)', async () => {
    const deps: RetrievalDeps = { vectorStore: vectorStoreReturning(twoSession), embedder };
    await expect(
      runRetrievalPipeline('q', FILTERS, deps, {
        threshold: 0.1,
        topK: 10,
        scopes: { sessionRecencyWeight: 0.3 },
        rerank: { pool: 3 },
      }),
    ).rejects.toThrow(RerankerConflict);
  });

  test('out-of-[0,1] weight throws InvalidScope at the boundary', async () => {
    const deps: RetrievalDeps = { vectorStore: vectorStoreReturning(twoSession), embedder };
    await expect(
      runRetrievalPipeline('q', FILTERS, deps, {
        threshold: 0.1,
        topK: 10,
        scopes: { sessionRecencyWeight: 1.5 },
      }),
    ).rejects.toThrow(InvalidScope);
  });

  // T3.2 — the reweight is a `{...item, score}` spread, so every orthogonal field (attributed_to)
  // survives it. ROADMAP M10 DoD: attribution (user/agent) surfaced on each result.
  test('test_attribution_survives_scope_reweight — attributedTo is carried through the reweight', async () => {
    const withAttr: VectorStoreResult[] = [
      { id: 'a', score: 0.8, payload: { text: 'a', session_id: 's', created_at: newIso, attributed_to: 'agent' } },
    ];
    const deps: RetrievalDeps = { vectorStore: vectorStoreReturning(withAttr), embedder };
    const out = await runRetrievalPipeline('q', FILTERS, deps, {
      threshold: 0.1,
      topK: 10,
      scopes: { sessionRecencyWeight: 0.5 },
    });
    expect(out[0]?.attributedTo).toBe('agent');
  });
});

/**
 * M15 T3.1 (#122) — Step 6 populates `entityBoostById`.
 *
 * This is the line the issue points at: the map was created empty and never filled, so
 * `combineScores` had always summed a component that was always zero.
 */
describe('runRetrievalPipeline entity boost', () => {
  const boostCandidates: VectorStoreResult[] = [
    { id: 'm-linked', score: 0.8, payload: { text: 'sobre são paulo' } },
    { id: 'm-plain', score: 0.8, payload: { text: 'sem entidade' } },
  ];

  function boostStore(linked: Record<string, string[]>) {
    return {
      linkedKeysForMemories: async () =>
        new Map(Object.entries(linked)) as ReadonlyMap<string, readonly string[]>,
    };
  }

  test('test_entity_boost_map_is_populated_when_query_mentions_linked_entity', async () => {
    const deps: RetrievalDeps = {
      vectorStore: vectorStoreReturning(boostCandidates),
      embedder,
      entityBoostStore: boostStore({ 'm-linked': ['são_paulo'] }),
    };

    const results = await runRetrievalPipeline('moro em São Paulo', FILTERS, deps, {
      threshold: 0.1,
      topK: 10,
    });

    const linked = results.find((r) => r.id === 'm-linked');
    const plain = results.find((r) => r.id === 'm-plain');
    expect(linked).toBeDefined();
    expect(plain).toBeDefined();
    // Same semantic score; only the entity link separates them.
    expect((linked as { score: number }).score).toBeGreaterThan((plain as { score: number }).score);
  });

  test('test_pipeline_without_entity_store_behaves_identically', async () => {
    const base: RetrievalDeps = { vectorStore: vectorStoreReturning(boostCandidates), embedder };

    const baseline = await runRetrievalPipeline('moro em São Paulo', FILTERS, base, {
      threshold: 0.1,
      topK: 10,
    });

    expect(baseline.map((r) => r.id)).toEqual(['m-linked', 'm-plain']);
  });

  test('test_query_with_no_entity_match_leaves_signal_off', async () => {
    const deps: RetrievalDeps = {
      vectorStore: vectorStoreReturning(boostCandidates),
      embedder,
      entityBoostStore: boostStore({ 'm-linked': ['berlim'] }),
    };

    const results = await runRetrievalPipeline('moro em São Paulo', FILTERS, deps, {
      threshold: 0.1,
      topK: 10,
    });

    // No key matched, so no candidate is boosted and both keep the same score.
    const linked = results.find((r) => r.id === 'm-linked') as { score: number };
    const plain = results.find((r) => r.id === 'm-plain') as { score: number };
    expect(linked.score).toBe(plain.score);
  });

  test('test_bm25_only_candidate_also_receives_boost', async () => {
    const store = {
      search: async () => [{ id: 'm-sem', score: 0.8, payload: { text: 'semantico' } }],
      keywordSearch: async () => [{ id: 'm-kw', score: 9, payload: { text: 'são paulo' } }],
    } as unknown as VectorStore;
    let asked: readonly string[] = [];
    const deps: RetrievalDeps = {
      vectorStore: store,
      embedder,
      entityBoostStore: {
        linkedKeysForMemories: async (p) => {
          asked = p.memoryIds;
          return new Map([['m-kw', ['são_paulo']]]);
        },
      },
    };

    await runRetrievalPipeline('moro em São Paulo', FILTERS, deps, { threshold: 0.05, topK: 10 });

    // The union must be built BEFORE the lookup, otherwise a BM25-only candidate could
    // never be boosted.
    expect(asked).toContain('m-kw');
  });

  test('test_entity_store_failure_degrades_to_empty_boost_and_emits_event', async () => {
    const events: string[] = [];
    const tracer = {
      startActiveSpan: (name: string, fn: (span: unknown) => void) => {
        events.push(name);
        fn({ setAttribute: () => {}, end: () => {} });
      },
    } as unknown as NonNullable<RetrievalDeps['tracer']>;

    const deps: RetrievalDeps = {
      vectorStore: vectorStoreReturning(boostCandidates),
      embedder,
      entityBoostStore: {
        linkedKeysForMemories: async () => {
          throw new Error('connection terminated');
        },
      },
      tracer,
    };

    const results = await runRetrievalPipeline('moro em São Paulo', FILTERS, deps, {
      threshold: 0.1,
      topK: 10,
    });

    // Recall is a read path: losing the third signal beats returning an error.
    expect(results.map((r) => r.id)).toEqual(['m-linked', 'm-plain']);
    // But the degradation is never silent (Princípio 3).
    expect(events).toContain('entity_boost_degraded');
  });
});

/**
 * M15 /review (#122) — the timeout row of the plan's Failure-scenarios table.
 *
 * Only a THROWN error degraded the boost. A hung query has no error to catch, so it would
 * block every recall behind it — the plan promised this degraded and it did not.
 */
describe('runRetrievalPipeline entity boost timeout', () => {
  test('test_hung_entity_lookup_degrades_instead_of_blocking_recall', async () => {
    const events: string[] = [];
    const tracer = {
      startActiveSpan: (name: string, fn: (span: unknown) => void) => {
        events.push(name);
        fn({ setAttribute: () => {}, end: () => {} });
      },
    } as unknown as NonNullable<RetrievalDeps['tracer']>;

    const deps: RetrievalDeps = {
      vectorStore: vectorStoreReturning([
        { id: 'm1', score: 0.8, payload: { text: 'kept' } },
      ]),
      embedder,
      entityBoostStore: {
        // Never settles — the shape of a saturated pool or a wedged connection.
        linkedKeysForMemories: () => new Promise(() => {}),
      },
      timeoutMs: 25,
      tracer,
    };

    const results = await runRetrievalPipeline('moro em São Paulo', FILTERS, deps, {
      threshold: 0.1,
      topK: 10,
    });

    expect(results.map((r) => r.id)).toEqual(['m1']);
    expect(events).toContain('entity_boost_degraded');
  });
});

describe('runRetrievalPipeline lexical-only candidates', () => {
  test('a candidate found only by keyword search is gated on its real cosine similarity', async () => {
    // Arrange: the semantic channel misses the row (an ANN top-k cut, say); the keyword
    // channel finds it and reports a similarity well above the threshold.
    const store = {
      search: async () => [],
      keywordSearch: async () => [{ id: 'm-kw', score: 0.1, similarity: 0.62, payload: { text: 'Gina opened her store' } }],
    } as unknown as VectorStore;

    // Act
    const results = await runRetrievalPipeline('When did Gina open her store?', FILTERS, { vectorStore: store, embedder }, {
      threshold: 0.3,
      topK: 5,
    });

    // Assert
    expect(results.map((r) => r.id)).toEqual(['m-kw']);
  });

  test('a keyword-only candidate below the semantic threshold is still dropped', async () => {
    const store = {
      search: async () => [],
      keywordSearch: async () => [{ id: 'm-kw', score: 0.1, similarity: 0.12, payload: { text: 'Gina likes tea' } }],
    } as unknown as VectorStore;

    const results = await runRetrievalPipeline('When did Gina open her store?', FILTERS, { vectorStore: store, embedder }, {
      threshold: 0.3,
      topK: 5,
    });

    expect(results).toEqual([]);
  });

  test('the query vector is passed to keyword search so it can report similarity', async () => {
    let received: readonly number[] | undefined;
    const store = {
      search: async () => [],
      keywordSearch: async (_q: string, _k?: number, _f?: Filters, v?: readonly number[]) => {
        received = v;
        return [];
      },
    } as unknown as VectorStore;

    await runRetrievalPipeline('Gina store', FILTERS, { vectorStore: store, embedder }, { threshold: 0.3 });

    expect(received).toEqual([0.1, 0.2, 0.3]);
  });
});
