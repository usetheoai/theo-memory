/**
 * T2.0 — MemoryGraphStore DIP shape contract (slice2).
 *
 * The edges port owns the `entity_edges` aggregate (ADR D2). ISP-clean: EXACTLY
 * 3 methods (`upsertEdges`, `invalidateEdgesByMemory`, `listEdges`) per ADR-0008
 * (amended 2026-07-10, M1 — the invalidate is a cohesive write on the SAME edges
 * aggregate, not a cross-cutting concern). `MemoryEntityStore` is NOT widened.
 *
 */
import { describe, expect, test } from 'vitest';

import type { MemoryGraphStore } from './memory-graph-store.js';

describe('MemoryGraphStore DIP (T2.0)', () => {
  test('memory_graph_store_shape — a stub implementing the port type-checks (3 methods)', () => {
    const stub: MemoryGraphStore = {
      upsertEdges: async () => undefined,
      invalidateEdgesByMemory: async () => undefined,
      listEdges: async () => [],
    };
    expect(typeof stub.upsertEdges).toBe('function');
    expect(typeof stub.invalidateEdgesByMemory).toBe('function');
    expect(typeof stub.listEdges).toBe('function');
    const methodCount = Object.keys(stub).length;
    expect(methodCount).toBe(3); // ISP — ADR-0008 amended (M1): cohesive edges-aggregate write
  });
});
