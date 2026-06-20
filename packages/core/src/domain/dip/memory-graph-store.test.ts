/**
 * T2.0 — MemoryGraphStore DIP shape contract (slice2).
 *
 * The edges port owns the `entity_edges` aggregate (ADR D2). ISP-clean: EXACTLY
 * 2 methods (`upsertEdges`, `listEdges`) per ADR-0008 — `MemoryEntityStore` is
 * NOT widened.
 *
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md § T2.0
 */
import { describe, expect, test } from 'vitest';

import type { MemoryGraphStore } from './memory-graph-store.js';

describe('MemoryGraphStore DIP (T2.0)', () => {
  test('memory_graph_store_shape — a stub implementing the port type-checks (2 methods)', () => {
    const stub: MemoryGraphStore = {
      upsertEdges: async () => undefined,
      listEdges: async () => [],
    };
    expect(typeof stub.upsertEdges).toBe('function');
    expect(typeof stub.listEdges).toBe('function');
    const methodCount = Object.keys(stub).length;
    expect(methodCount).toBe(2); // ISP — ADR-0008 ≤2
  });
});
