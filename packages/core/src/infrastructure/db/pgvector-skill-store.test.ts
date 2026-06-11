/**
 * Direct unit tests for `PgvectorSkillStore` (v0.6.1 T3.1 / F3 extraction).
 *
 * These tests exercise the boundary assertions (`assertSkillArgs` + non-empty
 * `derivedFrom`) without touching a real Postgres connection. The `Pool` is
 * stubbed with `vi.fn()` that throws if reached, so an assertion failure
 * surfaces as "query was called" rather than as a SQL error.
 *
 * The atomic-write test verifies the composition seam: `insertDerivedSkillAtomic`
 * delegates to the injected `withTransactionFn` exactly once for valid args.
 */
import type { Pool, PoolClient } from 'pg';
import { describe, expect, test, vi } from 'vitest';

import { InvalidSkillError } from '../../domain/errors.js';

import { PgvectorSkillStore } from './pgvector-skill-store.js';

const VEC: readonly number[] = [0.1, 0.2, 0.3];

function buildStore(): {
  store: PgvectorSkillStore;
  poolQuery: ReturnType<typeof vi.fn>;
  withTransactionFn: ReturnType<typeof vi.fn>;
} {
  const poolQuery = vi.fn();
  const pool = { query: poolQuery } as unknown as Pool;
  const withTransactionFn = vi.fn(async <T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'derived-id' }] }),
    } as unknown as PoolClient;
    return fn(client);
  });
  const store = new PgvectorSkillStore(pool, withTransactionFn);
  return { store, poolQuery, withTransactionFn };
}

describe('PgvectorSkillStore (v0.6.1 T3.1 / F3)', () => {
  test('insertSkill rejects empty description with InvalidSkillError BEFORE issuing SQL', async () => {
    const { store, poolQuery } = buildStore();

    await expect(
      store.insertSkill({
        embedding: VEC,
        hash: 'h-empty-desc',
        code: 'noop',
        description: '   ',
        codeLanguage: 'typescript',
        scope: { userId: 'alice' },
      }),
    ).rejects.toBeInstanceOf(InvalidSkillError);

    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('insertSkill rejects invalid codeLanguage with InvalidSkillError BEFORE issuing SQL', async () => {
    const { store, poolQuery } = buildStore();

    await expect(
      store.insertSkill({
        embedding: VEC,
        hash: 'h-bad-lang',
        code: 'noop',
        description: 'valid description',
        codeLanguage: 'rust' as unknown as 'typescript',
        scope: { userId: 'alice' },
      }),
    ).rejects.toBeInstanceOf(InvalidSkillError);

    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('insertDerivedSkill rejects empty derivedFrom with InvalidSkillError BEFORE issuing SQL', async () => {
    const { store, poolQuery } = buildStore();

    await expect(
      store.insertDerivedSkill({
        embedding: VEC,
        hash: 'h-no-provenance',
        code: null,
        description: 'merged narrative',
        codeLanguage: null,
        derivedFrom: [],
        scope: { userId: 'alice' },
      }),
    ).rejects.toBeInstanceOf(InvalidSkillError);

    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('insertDerivedSkillAtomic delegates to withTransactionFn exactly once for valid args', async () => {
    const { store, withTransactionFn } = buildStore();

    const derivedId = await store.insertDerivedSkillAtomic(
      {
        embedding: VEC,
        hash: 'h-atomic',
        code: null,
        description: 'merged narrative',
        codeLanguage: null,
        derivedFrom: ['src-a', 'src-b'],
        scope: { userId: 'alice' },
      },
      ['src-a', 'src-b'],
    );

    expect(derivedId).toBe('derived-id');
    expect(withTransactionFn).toHaveBeenCalledTimes(1);
  });
});
