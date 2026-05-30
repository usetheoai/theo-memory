/**
 * T2.2 RED tests for the v0.6 recall / getAll filters:
 *   - `onlySkills`         — when true, only `kind='skill'` rows are returned
 *   - `includeSuperseded`  — when false (default), rows whose `supersededBy IS NOT NULL` are excluded
 *
 * These filters are honored at the STORE layer via the v0.6 extension of
 * the `Filters` shape (`kind` + `excludeSuperseded`). The pipeline translates
 * the public option flags into the store-layer Filters at the boundary.
 *
 * EC-3 absorption (plan v1.1): the same 2 fields land on BOTH `RecallOptions`
 * AND `GetAllOptions`, so T3.1's Orient phase can call
 * `scope.getAll({onlySkills: true, includeSuperseded: false})` consistently.
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T2.2 + EC-3
 */
import { describe, expect, test } from 'vitest';

import { InMemoryVectorStore } from '../in-memory-store.js';

import { VEC_A, VEC_B } from './fixtures/deterministic-vectors.js';

interface SeedRow {
  readonly id: string;
  readonly kind: 'extracted' | 'skill';
  readonly supersededBy?: string;
}

/**
 * Build a populated store with a mix of `kind='extracted'` facts and
 * `kind='skill'` rows (one current head + one superseded).
 */
async function seedStore(): Promise<{ store: InMemoryVectorStore; seeded: readonly SeedRow[] }> {
  const store = new InMemoryVectorStore();
  await store.initialize();

  // Two regular memories — kind='extracted' (default v0.4a)
  const extractedIds = ['mem-a', 'mem-b'];
  await store.insert(
    [VEC_A, VEC_B],
    extractedIds,
    [
      { text: 'extracted A', hash: 'h-ea', user_id: 'alice', kind: 'extracted' },
      { text: 'extracted B', hash: 'h-eb', user_id: 'alice', kind: 'extracted' },
    ],
  );

  // One skill — current head
  const headSkillId = await store.insertSkill({
    embedding: VEC_A,
    hash: 'h-head',
    code: 'head impl',
    description: 'current head skill',
    codeLanguage: 'typescript',
    scope: { userId: 'alice' },
  });

  // Another skill — superseded by the head. In-memory store stores supersededBy in payload.
  const superSkillId = await store.insertSkill({
    embedding: VEC_B,
    hash: 'h-sup',
    code: 'older impl',
    description: 'older superseded skill',
    codeLanguage: 'typescript',
    scope: { userId: 'alice' },
  });
  // Mark the older skill as superseded by the head.
  const stored = (store as unknown as {
    rows: Map<string, { vector: readonly number[]; payload: Record<string, string | number | boolean | null> }>;
  }).rows;
  const row = stored.get(superSkillId);
  if (row !== undefined) {
    row.payload['superseded_by'] = headSkillId;
  }

  return {
    store,
    seeded: [
      { id: extractedIds[0] as string, kind: 'extracted' },
      { id: extractedIds[1] as string, kind: 'extracted' },
      { id: headSkillId, kind: 'skill' },
      { id: superSkillId, kind: 'skill', supersededBy: headSkillId },
    ],
  };
}

describe('Filters honor onlySkills (T2.2)', () => {
  test('list() with kind=\'skill\' returns ONLY skill rows', async () => {
    const { store } = await seedStore();
    const [results] = await store.list({ user_id: 'alice', kind: 'skill' }, 100);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.payload['kind']).toBe('skill');
    }
  });

  test('list() WITHOUT kind filter returns all kinds (default behavior unchanged)', async () => {
    const { store } = await seedStore();
    const [results] = await store.list({ user_id: 'alice' }, 100);
    expect(results.length).toBe(4);
  });
});

describe('Filters honor excludeSuperseded (T2.2)', () => {
  test('list() with excludeSuperseded=true skips rows whose superseded_by is non-null', async () => {
    const { store, seeded } = await seedStore();
    const [results] = await store.list(
      { user_id: 'alice', kind: 'skill', excludeSuperseded: true },
      100,
    );
    expect(results.length).toBe(1);
    const head = seeded.find((s) => s.kind === 'skill' && s.supersededBy === undefined);
    expect(results[0]?.id).toBe(head?.id);
  });

  test('list() WITHOUT excludeSuperseded returns BOTH the head and the superseded skill', async () => {
    const { store } = await seedStore();
    const [results] = await store.list({ user_id: 'alice', kind: 'skill' }, 100);
    expect(results.length).toBe(2);
  });

  test('search() with kind=\'skill\' + excludeSuperseded=true returns only the current head', async () => {
    const { store, seeded } = await seedStore();
    const results = await store.search(
      VEC_A,
      10,
      { user_id: 'alice', kind: 'skill', excludeSuperseded: true },
    );
    expect(results.length).toBe(1);
    const head = seeded.find((s) => s.kind === 'skill' && s.supersededBy === undefined);
    expect(results[0]?.id).toBe(head?.id);
  });
});
