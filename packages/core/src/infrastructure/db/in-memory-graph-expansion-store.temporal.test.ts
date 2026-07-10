/**
 * M0 — graph-aware recall temporal correctness. The in-memory GraphExpansionStore
 * MUST mirror the pg store: never return a `t_invalid` (superseded/evicted) memory
 * through expansion (T1.4), and honor `asOf` point-in-time (T1.3). LSP: unit tests
 * that pass here must reflect the real pg behavior.
 */
import { describe, expect, test } from 'vitest';

import type { VectorStoreResult } from '../../domain/dip/vector-store.js';

import {
  InMemoryGraphExpansionStore,
  type InMemoryGraphNode,
} from './in-memory-graph-expansion-store.js';

function row(id: string): VectorStoreResult {
  return { id, payload: { text: id, hash: id }, score: 0 };
}

function seed(): InMemoryGraphNode {
  return { memoryId: 'seed', entityIds: ['e1'], result: row('seed'), filters: { workspace_id: 'w1', user_id: 'alice' } };
}

const FILTERS = { workspace_id: 'w1', user_id: 'alice' };

describe('InMemoryGraphExpansionStore — temporal correctness (M0)', () => {
  test('T1.4: a t_invalid (superseded) memory is NOT resurfaced through expansion', async () => {
    const store = new InMemoryGraphExpansionStore([
      seed(),
      {
        memoryId: 'superseded',
        entityIds: ['e1'],
        result: row('superseded'),
        filters: { workspace_id: 'w1', user_id: 'alice' },
        tInvalid: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const out = await store.expandByEntities({ seedMemoryIds: ['seed'], filters: FILTERS, hops: 1, limit: 10 });
    expect(out.map((r) => r.result.id)).not.toContain('superseded');
  });

  test('a currently-valid memory (t_invalid null) IS still returned', async () => {
    const store = new InMemoryGraphExpansionStore([
      seed(),
      { memoryId: 'valid', entityIds: ['e1'], result: row('valid'), filters: { workspace_id: 'w1', user_id: 'alice' } },
    ]);
    const out = await store.expandByEntities({ seedMemoryIds: ['seed'], filters: FILTERS, hops: 1, limit: 10 });
    expect(out.map((r) => r.result.id)).toContain('valid');
  });

  test('T1.3: asOf returns the state valid at the instant', async () => {
    const store = new InMemoryGraphExpansionStore([
      seed(),
      {
        memoryId: 'm',
        entityIds: ['e1'],
        result: row('m'),
        filters: { workspace_id: 'w1', user_id: 'alice' },
        tValid: new Date('2026-01-01T00:00:00.000Z'),
        tInvalid: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
    const at = (iso: string) =>
      store.expandByEntities({ seedMemoryIds: ['seed'], filters: { ...FILTERS, asOf: new Date(iso) }, hops: 1, limit: 10 });

    // valid at 2026-02-01 (between t_valid and t_invalid)
    expect((await at('2026-02-01T00:00:00.000Z')).map((r) => r.result.id)).toContain('m');
    // invalidated by 2026-04-01 (after t_invalid)
    expect((await at('2026-04-01T00:00:00.000Z')).map((r) => r.result.id)).not.toContain('m');
  });
});
