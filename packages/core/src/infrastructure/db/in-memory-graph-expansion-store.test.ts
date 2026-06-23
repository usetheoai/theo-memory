/**
 * Unit tests for InMemoryGraphExpansionStore (graph-aware-recall T4.2).
 * Covers the traversal semantics: shared-entity weight, seed exclusion (EC-1),
 * candidate-side scope confinement (EC-2), and limit bounding.
 */
import { describe, expect, test } from 'vitest';

import type { VectorStoreResult } from '../../domain/dip/vector-store.js';

import { InMemoryGraphExpansionStore, type InMemoryGraphNode } from './in-memory-graph-expansion-store.js';

function row(id: string): VectorStoreResult {
  return { id, payload: { text: id, hash: id }, score: 0 };
}

function node(memoryId: string, entityIds: string[], user_id = 'alice'): InMemoryGraphNode {
  return { memoryId, entityIds, result: row(memoryId), filters: { workspace_id: 'w1', user_id } };
}

const FILTERS = { workspace_id: 'w1', user_id: 'alice' };

describe('InMemoryGraphExpansionStore.expandByEntities', () => {
  test('returns memories sharing an entity with the seeds, weighted by shared count, excluding seeds', async () => {
    const store = new InMemoryGraphExpansionStore([
      node('seed', ['e1', 'e2']),
      node('two', ['e1', 'e2']), // shares 2
      node('one', ['e1', 'e9']), // shares 1
      node('none', ['e8']), // shares 0
    ]);
    const out = await store.expandByEntities({ seedMemoryIds: ['seed'], filters: FILTERS, hops: 1, limit: 10 });
    expect(out.map((r) => r.result.id)).toEqual(['two', 'one']); // sorted by sharedEntities desc; 'none' excluded
    expect(out.map((r) => r.result.id)).not.toContain('seed'); // EC-1 seed excluded
    expect(out[0]?.sharedEntities).toBe(2);
    expect(out[1]?.sharedEntities).toBe(1);
  });

  test('EC-2: a same-entity memory in a DIFFERENT scope is NEVER returned', async () => {
    const store = new InMemoryGraphExpansionStore([
      node('seed', ['e1'], 'alice'),
      node('other-user', ['e1'], 'bob'), // shares e1 but different user scope
    ]);
    const out = await store.expandByEntities({ seedMemoryIds: ['seed'], filters: FILTERS, hops: 1, limit: 10 });
    expect(out).toEqual([]); // cross-scope candidate filtered out
  });

  test('honors the limit (fan-out guard)', async () => {
    const store = new InMemoryGraphExpansionStore([
      node('seed', ['e1']),
      node('a', ['e1']),
      node('b', ['e1']),
      node('c', ['e1']),
    ]);
    const out = await store.expandByEntities({ seedMemoryIds: ['seed'], filters: FILTERS, hops: 1, limit: 2 });
    expect(out).toHaveLength(2);
  });

  test('seeds with no entities ⇒ empty (nothing to traverse)', async () => {
    const store = new InMemoryGraphExpansionStore([node('seed', []), node('a', ['e1'])]);
    const out = await store.expandByEntities({ seedMemoryIds: ['seed'], filters: FILTERS, hops: 1, limit: 10 });
    expect(out).toEqual([]);
  });
});
