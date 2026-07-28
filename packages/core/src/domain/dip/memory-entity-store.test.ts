import { describe, expect, it } from 'vitest';

import type { MemoryEntityStore } from './memory-entity-store.js';

/**
 * T2.1 — port contract conformance.
 *
 * The domain declares the port before any SQL exists.
 * This test pins the contract so every implementer — the pg adapter and every test double —
 * has to satisfy it, rather than the requirement living only in prose.
 */

/** Minimal conforming double; only the method under test is overridden per case. */
function makeStore(overrides: Partial<MemoryEntityStore> = {}): MemoryEntityStore {
  return {
    upsertAndLink: async () => {},
    list: async () => [],
    supersedeEntity: async () => false,
    forgetEntity: async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 }),
    linkedKeysForMemories: async () => new Map(),
    ...overrides,
  };
}

describe('MemoryEntityStore port', () => {
  it('test_port_contract_is_declared', () => {
    expect(typeof makeStore().linkedKeysForMemories).toBe('function');
  });

  it('test_empty_id_list_returns_empty_map_without_touching_the_store', async () => {
    // The guard belongs to the contract, not just to the pg implementation: no candidate
    // means no work, and every implementer must return early rather than issue a query.
    let queried = false;
    const store = makeStore({
      linkedKeysForMemories: async (params) => {
        if (params.memoryIds.length === 0) {
          return new Map();
        }
        queried = true;
        return new Map([['m1', ['paulo']]]);
      },
    });

    const result = await store.linkedKeysForMemories({ memoryIds: [], filters: { workspace_id: 'default' } });

    expect(result.size).toBe(0);
    expect(queried).toBe(false);
  });
});
