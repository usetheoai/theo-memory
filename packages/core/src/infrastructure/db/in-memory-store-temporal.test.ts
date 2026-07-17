/**
 * T2.2 — InMemoryVectorStore tracks per-row createdAt + deterministic same-ms order.
 *
 * Two RED tests:
 *   1. list() returns createdAt per row, matching insert-time stamps (uses
 *      fake timers to advance the clock between inserts).
 *   2. EC-6 absorption — two inserts at the IDENTICAL millisecond produce
 *      deterministic pagination order across 5 consecutive list() calls.
 *      Pre-fix: Map insertion order is V8-implementation-defined and could
 *      shift across vacuum / pageReuse-equivalent scenarios. SEPA pre-RED
 *      recommended explicit `.sort((a,b) => a.id.localeCompare(b.id))` in
 *      list() for id-order stability — this test pins that contract.
 *
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { InMemoryVectorStore } from './in-memory-store.js';

describe('InMemoryVectorStore.list — T2.2 + EC-6 temporal contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('list() returns createdAt per row matching insert-time wall-clock', async () => {
    const store = new InMemoryVectorStore();

    // Insert row 1 at t=0
    await store.insert([[1, 0, 0]], ['id-1'], [{ text: 'first' }]);
    const t1 = new Date('2026-06-09T00:00:00Z');

    // Advance clock 1 hour, insert row 2
    vi.advanceTimersByTime(60 * 60 * 1000);
    await store.insert([[0, 1, 0]], ['id-2'], [{ text: 'second' }]);
    const t2 = new Date('2026-06-09T01:00:00Z');

    const [results] = await store.list();

    expect(results).toHaveLength(2);
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get('id-1')?.createdAt?.toISOString()).toBe(t1.toISOString());
    expect(byId.get('id-2')?.createdAt?.toISOString()).toBe(t2.toISOString());
  });

  test('two inserts at same millisecond produce deterministic pagination order by id (EC-6)', async () => {
    const store = new InMemoryVectorStore();

    // Clock FROZEN — both inserts get identical createdAt.
    // SEPA pre-RED: insertion order is V8-Map-impl-defined; the contract is
    // ID ASCending lexicographic (matches PgvectorStore.list T2.1 ORDER BY tiebreak).
    await store.insert([[1, 0, 0]], ['id-b'], [{ text: 'b' }]);
    await store.insert([[0, 1, 0]], ['id-a'], [{ text: 'a' }]);

    // Run list() 5 times; assert identical ordering each time AND it is id ASC.
    const observedOrders: string[][] = [];
    for (let i = 0; i < 5; i += 1) {
      const [results] = await store.list();
      observedOrders.push(results.map((r) => r.id));
    }

    for (const order of observedOrders) {
      // EC-6 contract: id ASC (matches T2.1 production SQL `ORDER BY created_at DESC, id ASC`).
      expect(order).toEqual(['id-a', 'id-b']);
    }
  });
});
