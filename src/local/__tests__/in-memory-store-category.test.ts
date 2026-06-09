/**
 * T3.1 of themory-category-filter-server-side plan v1.2 — InMemoryVectorStore
 * category persist + filter semantics, mirroring pgvector adapter T3.2.
 *
 * Covers:
 *  - exact-match filter (3 rows [a,a,b]; cat=a returns 2)
 *  - NULL exclusion (filter for 'a' excludes rows without category)
 *  - no-filter returns all rows
 *  - category persists from payload['category'] into projected VectorStoreResult.category
 *  - EC-3: empty-string filter normalizes to undefined (no-filter)
 *  - EC-4: byte-equality / case-sensitivity preserved (Preferences ≠ preferences)
 *
 * @see .claude/knowledge-base/plans/themory-category-filter-server-side-plan.md § T3.1
 * @see .claude/knowledge-base/reviews/themory-category-filter-server-side-edge-cases-2026-06-09.md § EC-3 + EC-4
 */
import { describe, expect, test } from 'vitest';

import type { Filters } from '../../core/scope.js';
import { InMemoryVectorStore } from '../in-memory-store.js';

const DIM = 8;
const vec = (n: number): readonly number[] => Array.from({ length: DIM }, (_, i) => (i + n) / 10);

async function seed(
  store: InMemoryVectorStore,
  rows: readonly { id: string; user: string; cat?: string | null }[],
): Promise<void> {
  const vectors: (readonly number[])[] = [];
  const ids: string[] = [];
  const payloads: Record<string, string | number | boolean | null>[] = [];
  for (const row of rows) {
    const payload: Record<string, string | number | boolean | null> = {
      text: `fact-${row.id}`,
      hash: `hash-${row.id}`,
      user_id: row.user,
    };
    if (row.cat !== undefined) {
      payload['category'] = row.cat;
    }
    vectors.push(vec(ids.length));
    ids.push(row.id);
    payloads.push(payload);
  }
  await store.insert(vectors, ids, payloads);
}

describe('InMemoryVectorStore.list — T3.1 category persist + filter', () => {
  test('filters by exact-match category — 3 rows [a, a, b]; filter=a returns 2', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, [
      { id: 'r1', user: 'alice', cat: 'a' },
      { id: 'r2', user: 'alice', cat: 'a' },
      { id: 'r3', user: 'alice', cat: 'b' },
    ]);

    const filters: Filters = { user_id: 'alice', category: 'a' };
    const [results, total] = await store.list(filters, 100);

    expect(total).toBe(2);
    expect(results.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  test('filter excludes rows where category is NULL (undefined in payload)', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, [
      { id: 'with-cat', user: 'alice', cat: 'a' },
      { id: 'no-cat', user: 'alice' }, // payload has no category key
    ]);

    const filters: Filters = { user_id: 'alice', category: 'a' };
    const [results, total] = await store.list(filters, 100);

    expect(total).toBe(1);
    expect(results[0]?.id).toBe('with-cat');
  });

  test('no category filter returns all rows (backward-compat)', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, [
      { id: 'r1', user: 'alice', cat: 'a' },
      { id: 'r2', user: 'alice', cat: 'b' },
      { id: 'r3', user: 'alice' }, // no category
    ]);

    const filters: Filters = { user_id: 'alice' };
    const [results, total] = await store.list(filters, 100);

    expect(total).toBe(3);
  });

  test('category is projected into VectorStoreResult.category from payload', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, [{ id: 'r1', user: 'alice', cat: 'preferences' }]);

    const [results] = await store.list({ user_id: 'alice' }, 100);

    expect(results[0]?.category).toBe('preferences');
  });

  test('EC-3 — empty-string filter normalizes to undefined (returns all rows including NULL category)', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, [
      { id: 'r1', user: 'alice', cat: 'a' },
      { id: 'r2', user: 'alice', cat: 'b' },
      { id: 'r3', user: 'alice' }, // NULL category
    ]);

    const filtersEmpty: Filters = { user_id: 'alice', category: '' };
    const [resultsEmpty, totalEmpty] = await store.list(filtersEmpty, 100);

    // Empty string MUST be normalized to no-filter → all 3 rows returned.
    expect(totalEmpty).toBe(3);

    // Sanity: undefined-filter behaves identically.
    const filtersUndef: Filters = { user_id: 'alice' };
    const [, totalUndef] = await store.list(filtersUndef, 100);
    expect(totalUndef).toBe(3);
  });

  test('EC-4 — case-sensitive byte equality: filter=preferences returns only lowercase row', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, [
      { id: 'upper', user: 'alice', cat: 'Preferences' },
      { id: 'lower', user: 'alice', cat: 'preferences' },
    ]);

    const filters: Filters = { user_id: 'alice', category: 'preferences' };
    const [results, total] = await store.list(filters, 100);

    expect(total).toBe(1);
    expect(results[0]?.id).toBe('lower');
  });
});
