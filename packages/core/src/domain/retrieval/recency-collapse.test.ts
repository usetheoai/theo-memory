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
    const store = makeStore([
      { id: 'stale', text: 'stale', semanticScore: 0.9, createdAt: '2020-01-01T00:00:00.000Z' },
      { id: 'fresh', text: 'fresh', semanticScore: 0.7, createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'other', text: 'other', semanticScore: 0.5 },
    ]);
    const deps = { vectorStore: store, embedder: makeEmbedder(vectorFor) };

    // Act — recall with NO options (the option absent).
    const out = await runRetrievalPipeline('query', FILTERS, deps);

    // Assert — GOLDEN default order: pure score sort, every row present (no collapse).
    expect(out.map((m) => m.id)).toEqual(['stale', 'fresh', 'other']);
  });
});
