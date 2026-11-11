/**
 * M22 / #141 — recall-time most-recent-wins collapse.
 *
 * T1.1 (non-regression guard, THE critical invariant): recall is byte-identical
 * when `recencyCollapse` is ABSENT/OFF. A fixed candidate set — including two
 * near-duplicates that WOULD collapse if the stage ran — must recall in the exact
 * same order as before the feature landed. This test passes today and MUST keep
 * passing after T1.2, proving the score formula (scoring.ts) is untouched and the
 * stage is a pure no-op when off (Drawbacks row 1 / ADR D1).
 *
 * T1.2 unit cases: collapse-to-newest; non-duplicates untouched; equal-createdAt
 * deterministic tiebreak; recency-collapse + rerank/diversify → RerankerConflict.
 */
import { describe, expect, test, vi } from 'vitest';

import type { Embedder } from '../dip/embedder.js';
import type { VectorStore, VectorStoreResult } from '../dip/vector-store.js';
import { RerankerConflict } from '../errors.js';
import type { Filters } from '../scope.js';

import { collapseByRecency, type RecencyCollapseCandidate } from './recency-collapse.js';
import type { DroppedCandidate } from './stages/threshold-filter.js';
import type { RecallTraceStore, RecallTraceBatch } from '../dip/recall-trace-store.js';
import { runRetrievalPipeline } from './pipeline.js';

/** A deterministic embedder whose per-text vector is chosen by a supplied map. */
function makeEmbedder(vectorFor: (text: string) => readonly number[]): Embedder {
  return {
    embed: vi.fn(async (text: string) => vectorFor(text)),
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map((t) => vectorFor(t))),
  };
}

interface FakeRow {
  readonly id: string;
  readonly text: string;
  readonly semanticScore: number;
  readonly createdAt?: string;
}

function makeStore(rows: readonly FakeRow[]): VectorStore {
  const toResult = (r: FakeRow): VectorStoreResult => ({
    id: r.id,
    payload: {
      text: r.text,
      hash: r.id,
      ...(r.createdAt !== undefined ? { created_at: r.createdAt } : {}),
    },
    score: r.semanticScore,
  });
  const search = vi.fn(async (_q: readonly number[], topK: number): Promise<readonly VectorStoreResult[]> =>
    rows
      .map(toResult)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK),
  );
  const keywordSearch = vi.fn(async (): Promise<readonly VectorStoreResult[] | null> => null);
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
    listEpisodes: () => Promise.resolve([]),
    getUserId: () => Promise.resolve(''),
    setUserId: () => Promise.resolve(),
  };
}

const FILTERS: Filters = { user_id: 'u1' };

/** The canonical 3-row fixture: two near-duplicates (stale older, fresh newer) + one distinct row. */
function staleFreshOtherStore(): VectorStore {
  return makeStore([
    { id: 'stale', text: 'stale', semanticScore: 0.9, createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'fresh', text: 'fresh', semanticScore: 0.7, createdAt: '2024-01-01T00:00:00.000Z' },
    { id: 'other', text: 'other', semanticScore: 0.5 },
  ]);
}

// A tiny 2-cluster vector space: 'stale'/'fresh' are near-identical (cosine ≈ 1);
// 'other' is orthogonal. Only the collapse stage reads these vectors — the fake
// store ranks purely by its declared semanticScore, so the OFF path never sees them.
const VEC: Record<string, readonly number[]> = {
  stale: [1, 0, 0.0001],
  fresh: [1, 0, -0.0001],
  other: [0, 1, 0],
  query: [1, 0, 0],
};
const vectorFor = (text: string): readonly number[] => VEC[text] ?? [0, 0, 1];

describe('recency-collapse — T1.1 non-regression (OFF ⇒ byte-identical)', () => {
  test('test_recall_byte_identical_when_recency_collapse_off', async () => {
    // Arrange — two near-duplicates (stale outranks fresh on relevance) + one distinct row.
    const deps = { vectorStore: staleFreshOtherStore(), embedder: makeEmbedder(vectorFor) };

    // Act — recall with NO options (the option absent).
    const out = await runRetrievalPipeline('query', FILTERS, deps);

    // Assert — GOLDEN default order: pure score sort, every row present (no collapse).
    expect(out.map((m) => m.id)).toEqual(['stale', 'fresh', 'other']);
  });
});

describe('collapseByRecency — T1.2 pure stage', () => {
  const NEAR_A = [1, 0, 0.0001] as const;
  const NEAR_B = [1, 0, -0.0001] as const;
  const ORTHO = [0, 1, 0] as const;
  // Shared helper — all pure-stage cases collapse at the default τ=0.9.
  const dropped = (cands: readonly RecencyCollapseCandidate[]): readonly string[] =>
    collapseByRecency(cands, 0.9).droppedIds;

  test('test_recency_collapse_keeps_newest_and_drops_older', () => {
    // stale (higher relevance, OLDER) + fresh (lower relevance, NEWER), near-duplicates.
    // The OLDER row is dropped regardless of its higher relevance (most-recent-wins).
    expect(
      dropped([
        { id: 'stale', score: 0.9, embedding: NEAR_A, createdAtMs: 1000 },
        { id: 'fresh', score: 0.7, embedding: NEAR_B, createdAtMs: 5000 },
      ]),
    ).toEqual(['stale']);
  });

  test('non-duplicates are untouched (no collapse below threshold)', () => {
    expect(
      dropped([
        { id: 'a', score: 0.9, embedding: NEAR_A, createdAtMs: 1000 },
        { id: 'b', score: 0.7, embedding: ORTHO, createdAtMs: 5000 },
      ]),
    ).toEqual([]);
  });

  test('keeps a time-specific fact when a near-paraphrase drops its date', () => {
    expect(
      collapseByRecency([
        { id: 'dated', score: 0.9, embedding: NEAR_A, createdAtMs: 1000, text: 'user fixed the fence three weeks ago' },
        { id: 'summary', score: 0.8, embedding: NEAR_B, createdAtMs: 5000, text: 'the fence repair made the goats safe' },
      ], 0.9).droppedIds,
    ).toEqual([]);
  });

  test('a new value of the same statement is an update: the newer fact survives (#249)', () => {
    expect(
      collapseByRecency([
        { id: 'three', score: 0.9, embedding: NEAR_A, createdAtMs: 1000, text: 'user tried three Korean restaurants' },
        { id: 'four', score: 0.8, embedding: NEAR_B, createdAtMs: 5000, text: 'user tried four Korean restaurants' },
      ], 0.9).droppedIds,
    ).toEqual(['three']);
    expect(
      collapseByRecency([
        { id: 'stale', score: 0.9, embedding: NEAR_A, createdAtMs: 1000, text: 'My charity 5K personal best is 27:12.' },
        { id: 'fresh', score: 0.8, embedding: NEAR_B, createdAtMs: 5000, text: 'My charity 5K personal best is now 25:50.' },
      ], 0.9).droppedIds,
    ).toEqual(['stale']);
  });

  test('keeps facts whose explicit dates differ: they can be distinct events', () => {
    expect(
      collapseByRecency([
        { id: 'date-a', score: 0.9, embedding: NEAR_A, createdAtMs: 1000, text: 'user attended the workshop on June 3rd' },
        { id: 'date-b', score: 0.8, embedding: NEAR_B, createdAtMs: 5000, text: 'user attended the workshop on June 10th' },
      ], 0.9).droppedIds,
    ).toEqual([]);
  });

  test('keeps facts whose years differ: they can be distinct events', () => {
    expect(
      collapseByRecency([
        { id: 'y2019', score: 0.9, embedding: NEAR_A, createdAtMs: 1000, text: 'User visited Lisbon in 2019.' },
        { id: 'y2022', score: 0.8, embedding: NEAR_B, createdAtMs: 5000, text: 'User visited Lisbon in 2022.' },
      ], 0.9).droppedIds,
    ).toEqual([]);
  });

  test('keeps facts whose polarity differs', () => {
    expect(
      collapseByRecency([
        { id: 'likes', score: 0.9, embedding: NEAR_A, createdAtMs: 1000, text: 'user likes coffee' },
        { id: 'not', score: 0.8, embedding: NEAR_B, createdAtMs: 5000, text: 'user does not like coffee' },
      ], 0.9).droppedIds,
    ).toEqual([]);
  });

  test('still collapses near-duplicates when their material values match', () => {
    expect(
      collapseByRecency([
        { id: 'old', score: 0.9, embedding: NEAR_A, createdAtMs: 1000, text: 'user fixed the fence three weeks ago' },
        { id: 'new', score: 0.8, embedding: NEAR_B, createdAtMs: 5000, text: 'user repaired the fence three weeks ago' },
      ], 0.9).droppedIds,
    ).toEqual(['old']);
  });

  test('equal createdAt → deterministic tiebreak (higher score kept)', () => {
    // Same timestamp → keep the higher-scored 'b', drop 'a'.
    expect(
      dropped([
        { id: 'a', score: 0.5, embedding: NEAR_A, createdAtMs: 1000 },
        { id: 'b', score: 0.9, embedding: NEAR_B, createdAtMs: 1000 },
      ]),
    ).toEqual(['a']);
  });

  test('equal createdAt AND equal score → lower id kept (deterministic)', () => {
    expect(
      dropped([
        { id: 'a', score: 0.5, embedding: NEAR_A, createdAtMs: 1000 },
        { id: 'b', score: 0.5, embedding: NEAR_B, createdAtMs: 1000 },
      ]),
    ).toEqual(['b']);
  });

  test('F-1: stable-seed clustering does not transitively drop a non-duplicate (A~B, B~C, A≁C)', () => {
    // A·B = cos25° ≈ 0.906 ≥ τ; B·C = cos25° ≈ 0.906 ≥ τ; A·C = cos50° ≈ 0.643 < τ.
    // A mutable-representative walk would drop BOTH a and b (survivor drifts to c);
    // stable-seed keeps {a,b} in one cluster (survivor b) and c in its own — so c,
    // which is NOT a near-duplicate of the seed a, is NEVER dropped.
    const A = [1, 0, 0] as const;
    const B = [0.9063, 0.4226, 0] as const;
    const C = [0.6428, 0.766, 0] as const;
    expect(
      dropped([
        { id: 'a', score: 0.9, embedding: A, createdAtMs: 1000 },
        { id: 'b', score: 0.8, embedding: B, createdAtMs: 2000 },
        { id: 'c', score: 0.7, embedding: C, createdAtMs: 3000 },
      ]),
    ).toEqual(['a']);
  });
});

describe('recency-collapse — T1.2 pipeline wiring', () => {
  const collapseVec = (text: string): readonly number[] => VEC[text] ?? [0, 0, 1];
  const collapseDeps = (store: VectorStore, extra: Partial<Record<string, unknown>> = {}) => ({
    vectorStore: store,
    embedder: makeEmbedder(collapseVec),
    ...extra,
  });

  test('collapses near-dups in recall + emits a superseded_recency drop', async () => {
    // Arrange — capture the recall-trace rows the pipeline writes.
    const captured: DroppedCandidate[] = [];
    const trace: RecallTraceStore = {
      record: async (batch: RecallTraceBatch) => {
        captured.push(...(batch.rows as DroppedCandidate[]));
      },
      getByRecallId: async () => [],
    };
    const deps = collapseDeps(staleFreshOtherStore(), {
      recallTrace: trace,
      recallTraceContext: { recallId: 'r1', workspaceId: 'default', scopeKey: 'user:u1', maxRows: 200 },
    });

    // Act
    const out = await runRetrievalPipeline('query', FILTERS, deps, { recencyCollapse: {} });

    // Assert — the stale duplicate is gone; the fresh value survives.
    expect(out.map((m) => m.id)).toEqual(['fresh', 'other']);
    const staleDrop = captured.find((d) => d.memoryId === 'stale');
    expect(staleDrop?.dropReason).toBe('superseded_recency');
  });

  // recencyCollapse is mutually exclusive with the other post-threshold reranks.
  test.each([
    ['diversify', { diversify: { lambda: 0.5 } }],
    ['rerank', { rerank: {} }],
    ['scopes', { scopes: {} }],
  ])('recencyCollapse + %s → RerankerConflict (fail-fast, mutual exclusion)', async (_label, extra) => {
    const deps = collapseDeps(makeStore([{ id: 'a', text: 'stale', semanticScore: 0.9 }]));
    await expect(
      runRetrievalPipeline('query', FILTERS, deps, { recencyCollapse: {}, ...extra }),
    ).rejects.toBeInstanceOf(RerankerConflict);
  });
});
