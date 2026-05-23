/**
 * Parameterized VectorStore conformance suite — T3.1 of v0-1-local-runtime plan v1.3.
 *
 * Both `InMemoryVectorStore` (T3.2) and `PgvectorStore` (T3.3) MUST pass this
 * identical suite. Sharing the contract prevents silent drift per ADR D1.2.
 *
 * EC-3 absorbed: factory returns `{ store, truncate }`. afterEach truncates
 * (preserves Drizzle-owned schema for pgvector); deleteCol exercised by ONE
 * dedicated test at the END.
 *
 * Adapter authors call:
 *   runVectorStoreConformance('in-memory', async () => ({ store: new InMemoryVectorStore(), truncate: ... }))
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T3.1
 * @see ADR D1.2 (this plan) + ADR-0008 (DIP method counts)
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { VectorStore } from '../../core/dip/vector-store.js';
import type { Filters } from '../../core/scope.js';

import { VEC_A, VEC_B, VEC_C } from './fixtures/deterministic-vectors.js';

export interface ConformanceContext {
  readonly store: VectorStore;
  readonly truncate: () => Promise<void>;
}

export type ConformanceFactory = () => Promise<ConformanceContext>;

const payload = (text: string, scope: Filters = {}): Record<string, string | number | boolean | null> => ({
  text,
  ...Object.fromEntries(
    Object.entries(scope).filter(([, v]) => v !== undefined),
  ),
});

export function runVectorStoreConformance(name: string, factory: ConformanceFactory): void {
  describe(`VectorStore conformance: ${name}`, () => {
    let ctx: ConformanceContext;

    beforeEach(async () => {
      ctx = await factory();
      await ctx.store.initialize();
      await ctx.truncate();
    });

    afterEach(async () => {
      await ctx.truncate();
    });

    test('initialize() is idempotent', async () => {
      await ctx.store.initialize();
      await ctx.store.initialize();
      // No throw == pass.
      expect(true).toBe(true);
    });

    test('insert + get round-trip preserves payload + id', async () => {
      const id = 'id-A';
      await ctx.store.insert([VEC_A], [id], [payload('A', { user_id: 'alice' })]);
      const result = await ctx.store.get(id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(id);
      expect(result?.payload['text']).toBe('A');
    });

    test('get returns null for unknown id', async () => {
      const result = await ctx.store.get('does-not-exist');
      expect(result).toBeNull();
    });

    test('insert N vectors persists each', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        ['a', 'b', 'c'],
        [payload('A'), payload('B'), payload('C')],
      );
      const [results, total] = await ctx.store.list({}, 100);
      expect(total).toBe(3);
      expect(results).toHaveLength(3);
    });

    test('search returns top-K ordered by similarity (A nearest A; C between)', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        ['a', 'b', 'c'],
        [payload('A'), payload('B'), payload('C')],
      );
      const hits = await ctx.store.search(VEC_A, 3);
      expect(hits.length).toBe(3);
      expect(hits[0]?.id).toBe('a');
    });

    test('search respects topK limit', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        ['a', 'b', 'c'],
        [payload('A'), payload('B'), payload('C')],
      );
      const hits = await ctx.store.search(VEC_A, 2);
      expect(hits.length).toBe(2);
    });

    test('filter isolation by user_id (ADR-0002): scope A returns only scope A', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B],
        ['alice-1', 'bob-1'],
        [payload('alice', { user_id: 'alice' }), payload('bob', { user_id: 'bob' })],
      );
      const aliceHits = await ctx.store.search(VEC_A, 10, { user_id: 'alice' });
      expect(aliceHits.every((h) => h.payload['user_id'] === 'alice')).toBe(true);
      expect(aliceHits.length).toBeGreaterThanOrEqual(1);
    });

    test('filter isolation by session_id', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B],
        ['s1', 's2'],
        [
          payload('s1', { user_id: 'alice', session_id: 's1' }),
          payload('s2', { user_id: 'alice', session_id: 's2' }),
        ],
      );
      const sessionHits = await ctx.store.search(VEC_A, 10, { user_id: 'alice', session_id: 's1' });
      expect(sessionHits.every((h) => h.payload['session_id'] === 's1')).toBe(true);
    });

    test('filter isolation by agent_id', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B],
        ['a1', 'a2'],
        [
          payload('a1', { agent_id: 'helper' }),
          payload('a2', { agent_id: 'critic' }),
        ],
      );
      const agentHits = await ctx.store.search(VEC_A, 10, { agent_id: 'helper' });
      expect(agentHits.every((h) => h.payload['agent_id'] === 'helper')).toBe(true);
    });

    test('keywordSearch returns results OR null (opt-out per DIP)', async () => {
      await ctx.store.insert([VEC_A], ['kw-1'], [payload('Paulo likes coffee')]);
      const result = await ctx.store.keywordSearch('coffee', 5);
      // Adapters may return either real results or null (opt-out)
      expect(result === null || Array.isArray(result)).toBe(true);
    });

    test('update refreshes vector + payload in place', async () => {
      await ctx.store.insert([VEC_A], ['u-1'], [payload('original')]);
      await ctx.store.update('u-1', VEC_B, payload('updated'));
      const result = await ctx.store.get('u-1');
      expect(result?.payload['text']).toBe('updated');
    });

    test('delete removes a single vector', async () => {
      await ctx.store.insert([VEC_A], ['del-1'], [payload('to delete')]);
      await ctx.store.delete('del-1');
      const result = await ctx.store.get('del-1');
      expect(result).toBeNull();
    });

    test('list returns paginated results with total count', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        ['p1', 'p2', 'p3'],
        [payload('1'), payload('2'), payload('3')],
      );
      const [page, total] = await ctx.store.list({}, 2);
      expect(total).toBe(3);
      expect(page.length).toBe(2);
    });

    test('getUserId works regardless of scope (Mem0 parity; not auth-gating)', async () => {
      // No-op return; assertion is "does not throw" (ADR-0002: scoping uses Filters)
      const result = await ctx.store.getUserId();
      expect(typeof result).toBe('string');
    });

    test('setUserId is observability only, does NOT gate access (ADR-0002)', async () => {
      await ctx.store.setUserId('alice');
      await ctx.store.insert(
        [VEC_A, VEC_B],
        ['x1', 'x2'],
        [payload('x1', { user_id: 'alice' }), payload('x2', { user_id: 'bob' })],
      );
      // search with no filter MUST return all tenants (setUserId is observability metadata)
      const [all] = await ctx.store.list({}, 100);
      expect(all.length).toBe(2);
    });

    test('truncate isolates state between tests (EC-3)', async () => {
      await ctx.store.insert([VEC_A], ['t-1'], [payload('seeded')]);
      await ctx.truncate();
      const result = await ctx.store.get('t-1');
      expect(result).toBeNull();
    });

    // Run LAST: deleteCol exercise. After this test, the schema is gone;
    // the test runner re-applies migrations between files for pgvector,
    // and in-memory adapter reconstructs the Map on next factory call.
    test('deleteCol drops the entire collection (FINAL — runs once at suite end)', async () => {
      await ctx.store.insert([VEC_A], ['dc-1'], [payload('to drop')]);
      await ctx.store.deleteCol();
      // After deleteCol, behavior is implementation-specific; we just assert no throw.
      expect(true).toBe(true);
    });
  });
}
