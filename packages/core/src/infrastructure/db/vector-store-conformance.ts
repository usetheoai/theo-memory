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
 * @see ADR D1.2 (this plan) + ADR-0008 (DIP method counts)
 */
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { VectorStore } from '../../domain/dip/vector-store.js';
import { InvalidSkillError } from '../../domain/errors.js';
import type { Filters } from '../../domain/scope.js';

import { VEC_A, VEC_B, VEC_C } from './fixtures/deterministic-vectors.js';
import type { VectorStoreWithSkillInsert } from './skill-store-args.js';


/** UUID v4 generator — matches the production schema (memories.id is uuid). */
function uuid(): string {
  return randomUUID();
}

/**
 * Local-tier conformance context. `store` is intersected with
 * `VectorStoreWithSkillInsert` because both PgvectorStore + InMemoryVectorStore
 * implement the v0.6 skill insertion methods as duck-typed extensions
 * (mirroring the v0.4a `insertDerivedMemory` pattern — not on the DIP).
 */
export interface ConformanceContext {
  readonly store: VectorStore & VectorStoreWithSkillInsert;
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
      const id = uuid();
      await ctx.store.insert([VEC_A], [id], [payload('A', { user_id: 'alice' })]);
      const result = await ctx.store.get(id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(id);
      expect(result?.payload['text']).toBe('A');
    });

    test('get returns null for unknown id', async () => {
      const result = await ctx.store.get(uuid());
      expect(result).toBeNull();
    });

    test('insert N vectors persists each', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        [uuid(), uuid(), uuid()],
        [payload('A'), payload('B'), payload('C')],
      );
      const [results, total] = await ctx.store.list({}, 100);
      expect(total).toBe(3);
      expect(results).toHaveLength(3);
    });

    test('search returns top-K ordered by similarity (A nearest A; C between)', async () => {
      const idA = uuid();
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        [idA, uuid(), uuid()],
        [payload('A'), payload('B'), payload('C')],
      );
      const hits = await ctx.store.search(VEC_A, 3);
      expect(hits.length).toBe(3);
      expect(hits[0]?.id).toBe(idA);
    });

    test('search respects topK limit', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        [uuid(), uuid(), uuid()],
        [payload('A'), payload('B'), payload('C')],
      );
      const hits = await ctx.store.search(VEC_A, 2);
      expect(hits.length).toBe(2);
    });

    test('filter isolation by user_id (ADR-0002): scope A returns only scope A', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B],
        [uuid(), uuid()],
        [payload('alice', { user_id: 'alice' }), payload('bob', { user_id: 'bob' })],
      );
      const aliceHits = await ctx.store.search(VEC_A, 10, { user_id: 'alice' });
      expect(aliceHits.every((h) => h.payload['user_id'] === 'alice')).toBe(true);
      expect(aliceHits.length).toBeGreaterThanOrEqual(1);
    });

    test('filter isolation by session_id', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B],
        [uuid(), uuid()],
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
        [uuid(), uuid()],
        [
          payload('a1', { agent_id: 'helper' }),
          payload('a2', { agent_id: 'critic' }),
        ],
      );
      const agentHits = await ctx.store.search(VEC_A, 10, { agent_id: 'helper' });
      expect(agentHits.every((h) => h.payload['agent_id'] === 'helper')).toBe(true);
    });

    test('keywordSearch returns results OR null (opt-out per DIP)', async () => {
      await ctx.store.insert([VEC_A], [uuid()], [payload('Paulo likes coffee')]);
      const result = await ctx.store.keywordSearch('coffee', 5);
      // Adapters may return either real results or null (opt-out)
      expect(result === null || Array.isArray(result)).toBe(true);
    });

    test('keywordSearch matches a row that contains only some of the query terms', async () => {
      // A natural-language question rarely has every one of its words in the stored fact.
      // BM25 is disjunctive: a row matching any term is a candidate, ranked by how well it matches.
      const id = uuid();
      await ctx.store.insert([VEC_A], [id], [payload('Melanie painted a sunrise over the lake')]);
      // "beach" is not in the row: a conjunctive (all-terms) match would return nothing.
      const result = await ctx.store.keywordSearch('When did Melanie paint the sunrise at the beach?', 5);
      if (result === null) return; // adapter opted out of BM25 (allowed by the DIP)
      expect(result.map((r) => r.id)).toContain(id);
    });

    test('keywordSearch ranks a row matching more query terms above one matching fewer', async () => {
      const both = uuid();
      const one = uuid();
      await ctx.store.insert(
        [VEC_A, VEC_B],
        [both, one],
        [payload('Melanie painted a sunrise'), payload('Melanie went running')],
      );
      const result = await ctx.store.keywordSearch('Melanie sunrise', 5);
      if (result === null) return;
      expect(result.map((r) => r.id)).toEqual([both, one]);
    });

    test('keywordSearch weighs a rare query term above a term most rows contain (IDF)', async () => {
      const rare = uuid();
      await ctx.store.insert(
        [VEC_A, VEC_A, VEC_A, VEC_A],
        [uuid(), uuid(), uuid(), rare],
        [
          payload('Melanie went running'),
          payload('Melanie likes tea'),
          payload('Melanie read a book'),
          payload('a sunrise over the lake'),
        ],
      );
      const result = await ctx.store.keywordSearch('Melanie sunrise', 5);
      if (result === null) return;
      expect(result[0]?.id).toBe(rare);
    });

    test('keywordSearch scores on the BM25 scale the recall normalization expects', async () => {
      // A row matching every term of a two-term query scores well above 1 with standard
      // BM25 (k1 = 1.2, b = 0.75); a cosine-like or ts_rank-like score stays below 1.
      await ctx.store.insert(
        [VEC_A, VEC_A, VEC_A],
        [uuid(), uuid(), uuid()],
        [payload('Melanie painted a sunrise'), payload('Caroline went hiking'), payload('Caroline likes tea')],
      );
      const result = await ctx.store.keywordSearch('Melanie sunrise', 5);
      if (result === null) return;
      expect(result[0]?.score ?? 0).toBeGreaterThan(1);
    });

    test('keywordSearch reports the cosine similarity to the query vector when one is given', async () => {
      const id = uuid();
      await ctx.store.insert([VEC_C], [id], [payload('Paulo likes coffee')]);
      const result = await ctx.store.keywordSearch('coffee', 5, undefined, VEC_A);
      if (result === null) return;
      expect(result[0]?.similarity).toBeCloseTo(0.7, 2);
    });

    test('keywordSearch leaves similarity undefined when no query vector is given', async () => {
      await ctx.store.insert([VEC_C], [uuid()], [payload('Paulo likes coffee')]);
      const result = await ctx.store.keywordSearch('coffee', 5);
      if (result === null) return;
      expect(result[0]?.similarity).toBeUndefined();
    });

    test('a row written with a past valid-from instant reports that instant', async () => {
      const id = uuid();
      await ctx.store.insert([VEC_A], [id], [{ ...payload('Ana moved to Lisbon'), t_valid: '2023-05-08T13:56:00.000Z' }]);
      const row = await ctx.store.get(id);
      expect(row?.payload['t_valid']).toBe('2023-05-08T13:56:00.000Z');
    });

    test('asOf before a row valid-from instant does not see the row; asOf after it does', async () => {
      const id = uuid();
      await ctx.store.insert([VEC_A], [id], [{ ...payload('Ana moved to Lisbon'), t_valid: '2023-05-08T13:56:00.000Z' }]);
      const before = await ctx.store.search(VEC_A, 5, { asOf: new Date('2023-05-01T00:00:00Z') });
      const after = await ctx.store.search(VEC_A, 5, { asOf: new Date('2023-06-01T00:00:00Z') });
      expect(before.map((r) => r.id)).not.toContain(id);
      expect(after.map((r) => r.id)).toContain(id);
    });

    test('update refreshes vector + payload in place', async () => {
      const id = uuid();
      await ctx.store.insert([VEC_A], [id], [payload('original')]);
      await ctx.store.update(id, VEC_B, payload('updated'));
      const result = await ctx.store.get(id);
      expect(result?.payload['text']).toBe('updated');
    });

    test('delete removes a single vector', async () => {
      const id = uuid();
      await ctx.store.insert([VEC_A], [id], [payload('to delete')]);
      await ctx.store.delete(id);
      const result = await ctx.store.get(id);
      expect(result).toBeNull();
    });

    test('list returns paginated results with total count', async () => {
      await ctx.store.insert(
        [VEC_A, VEC_B, VEC_C],
        [uuid(), uuid(), uuid()],
        [payload('1'), payload('2'), payload('3')],
      );
      const [page, total] = await ctx.store.list({}, 2);
      expect(total).toBe(3);
      expect(page.length).toBe(2);
    });

    test('getUserId works regardless of scope (upstream-pipeline parity; not auth-gating)', async () => {
      // No-op return; assertion is "does not throw" (ADR-0002: scoping uses Filters)
      const result = await ctx.store.getUserId();
      expect(typeof result).toBe('string');
    });

    test('setUserId is observability only, does NOT gate access (ADR-0002)', async () => {
      await ctx.store.setUserId('alice');
      await ctx.store.insert(
        [VEC_A, VEC_B],
        [uuid(), uuid()],
        [payload('x1', { user_id: 'alice' }), payload('x2', { user_id: 'bob' })],
      );
      // search with no filter MUST return all tenants (setUserId is observability metadata)
      const [all] = await ctx.store.list({}, 100);
      expect(all.length).toBe(2);
    });

    describe('supersede (ADR-0029)', () => {
      const at = new Date('2024-03-01T00:00:00Z');
      const alice: Filters = { workspace_id: 'default', user_id: 'alice' };
      const ids = async (filters: Filters): Promise<string[]> => (await ctx.store.list(filters, 100))[0].map((r) => r.id).sort();

      test('invalidates a live memory of the scope from the given instant, keeping it for earlier reads', async () => {
        const oldId = uuid();
        const newId = uuid();
        await ctx.store.insert([VEC_A, VEC_B], [oldId, newId], [
          payload('user lives in Porto', { ...alice, t_valid: '2023-01-01T00:00:00.000Z' } as Filters),
          payload('user lives in Lisbon', alice),
        ]);
        const superseded = await ctx.store.supersede!(alice, [oldId], { memoryId: newId, at });
        expect(superseded).toEqual([oldId]);
        expect(await ids(alice)).toEqual([newId]);
        expect((await ctx.store.search(VEC_A, 10, alice)).map((r) => r.id)).not.toContain(oldId);
        expect(await ids({ ...alice, asOf: new Date('2024-02-01T00:00:00Z') })).toContain(oldId);
      });

      test('returns only what it invalidated: other scopes, the superseding memory and already invalid rows are left alone', async () => {
        const bobRow = uuid();
        const self = uuid();
        const oldId = uuid();
        await ctx.store.insert([VEC_A, VEC_B, VEC_C], [bobRow, self, oldId], [
          payload('bob fact', { workspace_id: 'default', user_id: 'bob' }),
          payload('new fact', alice),
          payload('old fact', alice),
        ]);
        const now = new Date();
        expect(await ctx.store.supersede!(alice, [bobRow, self], { memoryId: self, at: now })).toEqual([]);
        expect(await ctx.store.supersede!(alice, [oldId], { memoryId: self, at: now })).toEqual([oldId]);
        expect(await ctx.store.supersede!(alice, [oldId], { memoryId: self, at: now })).toEqual([]);
        expect(await ids({ workspace_id: 'default', user_id: 'bob' })).toEqual([bobRow]);
      });

      test('a memory stored without a valid time is valid from when it was stored', async () => {
        const stored = uuid();
        await ctx.store.insert([VEC_A], [stored], [payload('user lives in Faro', alice)]);
        expect(await ctx.store.supersede!(alice, [stored], { memoryId: uuid(), at: new Date('2000-01-01T00:00:00Z') })).toEqual([]);
      });

      test('does not invalidate a memory that became valid after the superseding instant', async () => {
        const newer = uuid();
        await ctx.store.insert([VEC_A], [newer], [payload('user lives in Faro', { ...alice, t_valid: '2024-06-01T00:00:00.000Z' } as Filters)]);
        expect(await ctx.store.supersede!(alice, [newer], { memoryId: uuid(), at })).toEqual([]);
        expect(await ids(alice)).toEqual([newer]);
      });
    });

    test('truncate isolates state between tests (EC-3)', async () => {
      const id = uuid();
      await ctx.store.insert([VEC_A], [id], [payload('seeded')]);
      await ctx.truncate();
      const result = await ctx.store.get(id);
      expect(result).toBeNull();
    });

    // v0.6 — code-as-skill insertion (T2.1)
    describe('insertSkill (v0.6 T2.1)', () => {
      test('writes a kind=\'skill\' row and returns a UUID id', async () => {
        const id = await ctx.store.insertSkill({
          embedding: VEC_A,
          hash: 'h-skill-1',
          code: 'export const retry = async () => {/* impl */};',
          description: 'retry helper with exponential backoff',
          codeLanguage: 'typescript',
          scope: { userId: 'alice' },
        });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        const result = await ctx.store.get(id);
        expect(result).not.toBeNull();
        expect(result?.payload['kind']).toBe('skill');
        expect(result?.payload['code']).toContain('retry');
        expect(result?.payload['description']).toContain('exponential backoff');
        expect(result?.payload['code_language']).toBe('typescript');
      });

      test('rejects empty description with InvalidSkillError (embedding target cannot be empty)', async () => {
        await expect(
          ctx.store.insertSkill({
            embedding: VEC_A,
            hash: 'h-skill-empty-desc',
            code: 'noop',
            description: '   ',
            codeLanguage: 'typescript',
            scope: { userId: 'alice' },
          }),
        ).rejects.toBeInstanceOf(InvalidSkillError);
      });
    });

    describe('insertDerivedSkill (v0.6 T2.1)', () => {
      test('writes a derived skill row whose derived_from carries both source ids', async () => {
        const srcA = await ctx.store.insertSkill({
          embedding: VEC_A,
          hash: 'h-src-a',
          code: 'srcA',
          description: 'source skill A',
          codeLanguage: 'typescript',
          scope: { userId: 'alice' },
        });
        const srcB = await ctx.store.insertSkill({
          embedding: VEC_B,
          hash: 'h-src-b',
          code: 'srcB',
          description: 'source skill B',
          codeLanguage: 'typescript',
          scope: { userId: 'alice' },
        });
        const derivedId = await ctx.store.insertDerivedSkill({
          embedding: VEC_C,
          hash: 'h-derived',
          code: 'merged impl',
          description: 'consolidated retry helper',
          codeLanguage: 'typescript',
          derivedFrom: [srcA, srcB],
          scope: { userId: 'alice' },
        });
        const result = await ctx.store.get(derivedId);
        expect(result).not.toBeNull();
        expect(result?.payload['kind']).toBe('skill');
        const derivedFromRaw = result?.payload['derived_from'];
        const parsed: unknown =
          typeof derivedFromRaw === 'string' ? JSON.parse(derivedFromRaw) : derivedFromRaw;
        expect(parsed).toEqual([srcA, srcB]);
      });

      test('rejects empty derivedFrom with InvalidSkillError (a derived skill must cite at least one source)', async () => {
        await expect(
          ctx.store.insertDerivedSkill({
            embedding: VEC_A,
            hash: 'h-derived-empty',
            code: 'noop',
            description: 'consolidated retry helper',
            codeLanguage: 'typescript',
            derivedFrom: [],
            scope: { userId: 'alice' },
          }),
        ).rejects.toBeInstanceOf(InvalidSkillError);
      });
    });

    // Run LAST: deleteCol exercise. After this test, the schema is gone;
    // the test runner re-applies migrations between files for pgvector,
    // and in-memory adapter reconstructs the Map on next factory call.
    test('deleteCol drops the entire collection (FINAL — runs once at suite end)', async () => {
      await ctx.store.insert([VEC_A], [uuid()], [payload('to drop')]);
      await ctx.store.deleteCol();
      // After deleteCol, behavior is implementation-specific; we just assert no throw.
      expect(true).toBe(true);
    });
  });
}
