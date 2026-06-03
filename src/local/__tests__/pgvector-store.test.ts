/**
 * Direct unit tests for `PgvectorStore` constructor + search dimension guard
 * (adapters-openrouter-local-embedder T0.2).
 *
 * The `Pool` is stubbed with `vi.fn()` that throws if reached, so a dimension
 * guard rejection surfaces as a thrown `Error` BEFORE any SQL is issued.
 *
 * Mirrors the stubbed-pool pattern from `pgvector-skill-store.test.ts` (v0.6.1
 * T3.1 / F3 precedent).
 *
 * Scope:
 *   - Constructor signature widened from `(pool, tracer?)` to
 *     `(pool, options?: { embeddingDim?, tracer? })`. Backward-compat:
 *     `new PgvectorStore(pool)` must still work.
 *   - `embeddingDim` default = `MAX_EMBEDDING_DIM` (1536); search guard
 *     uses `this.embeddingDim` instead of the constant literal.
 *   - Search guard error message names the configured dim, NOT the constant.
 *
 * Out-of-scope for T0.2 (deferred):
 *   - EC-2 (constructor-dim vs schema-dim mismatch surfaces as clear error) —
 *     SHOULD TEST checkpoint; defer to T0.3 follow-up.
 *   - Integration tests against real pgvector — covered by existing
 *     `tests/integration/pgvector-store.test.ts`.
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T0.2
 * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-2-pre-red.md
 */
import type { Pool } from 'pg';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../core/constants.js';
import { EmbeddingMismatch } from '../../core/errors.js';
import { PgvectorStore } from '../pgvector-store.js';

function buildPool(): { pool: Pool; poolQuery: ReturnType<typeof vi.fn> } {
  const poolQuery = vi.fn().mockImplementation(() => {
    throw new Error('pool.query should not be reached when the guard rejects');
  });
  const pool = { query: poolQuery } as unknown as Pool;
  return { pool, poolQuery };
}

const dimVector = (n: number): readonly number[] =>
  new Array<number>(n).fill(0).map((_, i) => (i === 0 ? 0.1 : 0));

describe('PgvectorStore constructor — parametric embeddingDim (T0.2)', () => {
  test('accepts new PgvectorStore(pool) — backward compat with single positional arg', () => {
    const { pool } = buildPool();
    const store = new PgvectorStore(pool);
    expect(store).toBeDefined();
  });

  test('accepts new PgvectorStore(pool, { embeddingDim: 384 }) — options-object 2nd arg', () => {
    const { pool } = buildPool();
    const store = new PgvectorStore(pool, { embeddingDim: 384 });
    expect(store).toBeDefined();
  });

  test('defaults to MAX_EMBEDDING_DIM when options omitted (backward compat)', async () => {
    const { pool, poolQuery } = buildPool();
    const store = new PgvectorStore(pool);
    // Search guard fires when query.length != configured dim. Default is
    // MAX_EMBEDDING_DIM so a 384-length query MUST be rejected.
    await expect(
      store.search(dimVector(384), 5),
    ).rejects.toThrow(new RegExp(String(MAX_EMBEDDING_DIM)));
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('defaults to MAX_EMBEDDING_DIM when options is empty object', async () => {
    const { pool, poolQuery } = buildPool();
    const store = new PgvectorStore(pool, {});
    await expect(
      store.search(dimVector(384), 5),
    ).rejects.toThrow(new RegExp(String(MAX_EMBEDDING_DIM)));
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('PgvectorStore.search dimension guard — parametric (T0.2)', () => {
  test('accepts a query vector matching the configured embeddingDim=384 (guard does not fire)', async () => {
    const { pool, poolQuery } = buildPool();
    const store = new PgvectorStore(pool, { embeddingDim: 384 });
    // Guard does NOT fire — the throw is from the stubbed pool.query
    // proving the guard PASSED and execution reached the SQL boundary.
    await expect(
      store.search(dimVector(384), 5),
    ).rejects.toThrow(/pool.query should not be reached/);
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  test('rejects a query vector NOT matching configured embeddingDim=384 with typed EmbeddingMismatch', async () => {
    const { pool, poolQuery } = buildPool();
    const store = new PgvectorStore(pool, { embeddingDim: 384 });
    // 1536-length query against a 384-configured store must reject
    // BEFORE pool.query is called. /review F-Mi6: the error type is
    // `EmbeddingMismatch` (not bare `Error`) for symmetry with the
    // createLocalMemory boot-time probe and the public error taxonomy.
    await expect(
      store.search(dimVector(MAX_EMBEDDING_DIM), 5),
    ).rejects.toBeInstanceOf(EmbeddingMismatch);
    await expect(
      store.search(dimVector(MAX_EMBEDDING_DIM), 5),
    ).rejects.toThrow(/384/);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('error message names the CONFIGURED dim, NOT the MAX_EMBEDDING_DIM constant, when the store is parametric', async () => {
    // Operator-diagnosability: when an operator runs in local-openrouter
    // mode with embeddingDim=384 and somehow gets a 768-length query,
    // the error must say "expected 384" — pointing at THEIR config,
    // not the SDK's upper-bound constant.
    const { pool } = buildPool();
    const store = new PgvectorStore(pool, { embeddingDim: 384 });
    await expect(
      store.search(dimVector(768), 5),
    ).rejects.toThrow(/384/);
  });
});

describe('PgvectorStore.insert — attributed_to column hoist (v1.1 T2.1)', () => {
  test('INSERT SQL includes attributed_to column in the column list', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    const vector: readonly number[] = [0.1, 0.2, 0.3];
    const payload = {
      text: 'Paulo prefers tea',
      hash: 'h-paulo-tea',
      user_id: 'alice',
      attributed_to: 'paulo',
    };

    await store.insert([vector], ['id-1'], [payload]);

    expect(captured.length).toBeGreaterThan(0);
    const insertCall = captured.find((c) => c.sql.includes('INSERT INTO memories'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.sql).toMatch(/attributed_to/);
    // attributed_to value MUST appear in the params (hoisted from payload).
    expect(insertCall!.params).toContain('paulo');
  });

  test('INSERT supports infer:false path — payload.attributed_to from RememberOptions (EC-2)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    // Verbatim-path callers route options.attributedTo into payload at the
    // pipeline boundary; pgvector-store hoists payload['attributed_to'] to the
    // column regardless of the path that set it.
    const verbatimPayload = {
      text: 'verbatim fact text',
      hash: 'h-verbatim',
      user_id: 'alice',
      attributed_to: 'alice', // routed from RememberOptions.attributedTo
    };

    await store.insert([[0.1, 0.2, 0.3]], ['id-verbatim'], [verbatimPayload]);

    const insertCall = captured.find((c) => c.sql.includes('INSERT INTO memories'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params).toContain('alice');
  });

  test('INSERT writes NULL when payload omits attributed_to (backward compat)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    const payload = {
      text: 'no attribution recorded',
      hash: 'h-no-attr',
      user_id: 'alice',
      // no attributed_to key
    };

    await store.insert([[0.1, 0.2, 0.3]], ['id-no-attr'], [payload]);

    const insertCall = captured.find((c) => c.sql.includes('INSERT INTO memories'));
    expect(insertCall).toBeDefined();
    // NULL should be in the params at the attributed_to slot.
    expect(insertCall!.params).toContain(null);
  });
});

describe('PgvectorStore.search — attributed_to recall WHERE filter (v1.1 T2.2)', () => {
  test('search WHERE clause appends attributed_to = $N when filters.attributed_to set', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    await store.search([0.1, 0.2, 0.3], 5, { user_id: 'alice', attributed_to: 'paulo' });

    const selectCall = captured.find((c) => c.sql.includes('SELECT'));
    expect(selectCall).toBeDefined();
    expect(selectCall!.sql).toMatch(/attributed_to = \$\d+/);
    expect(selectCall!.params).toContain('paulo');
  });

  test('search WHERE clause OMITS attributed_to when filters.attributed_to undefined (regression guard)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    await store.search([0.1, 0.2, 0.3], 5, { user_id: 'alice' });

    const selectCall = captured.find((c) => c.sql.includes('SELECT'));
    expect(selectCall).toBeDefined();
    expect(selectCall!.sql).not.toMatch(/attributed_to = \$/);
  });

  test('EC-7: empty-string attributed_to filters with `= \'\'` Postgres semantics (NULL rows excluded)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    // EC-7: when caller passes attributedTo='' through to filters.attributed_to,
    // composeFilters must emit `attributed_to = $N` with '' in the param. Postgres
    // semantics then exclude NULL rows (NULL = '' returns NULL, not true).
    await store.search([0.1, 0.2, 0.3], 5, { user_id: 'alice', attributed_to: '' });

    const selectCall = captured.find((c) => c.sql.includes('SELECT'));
    expect(selectCall).toBeDefined();
    expect(selectCall!.sql).toMatch(/attributed_to = \$\d+/);
    expect(selectCall!.params).toContain('');
  });
});

describe('PgvectorStore.search — attributed_to SELECT projection (v1.1 T2.1)', () => {
  test('SELECT SQL includes attributed_to column', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string) => {
      captured.push({ sql, params: [] });
      return { rows: [] };
    });
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    await store.search([0.1, 0.2, 0.3], 5);

    const selectCall = captured.find((c) => c.sql.includes('SELECT'));
    expect(selectCall).toBeDefined();
    expect(selectCall!.sql).toMatch(/attributed_to/);
  });

  test('rowToResult: attributed_to from row maps into VectorStoreResult.payload', async () => {
    const poolQuery = vi.fn().mockImplementation(() => ({
      rows: [
        {
          id: 'id-1',
          text: 'Paulo prefers tea',
          hash: 'h-paulo-tea',
          payload: {},
          user_id: 'alice',
          session_id: null,
          agent_id: null,
          attributed_to: 'paulo',
          distance: 0.2,
        },
      ],
    }));
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    const results = await store.search([0.1, 0.2, 0.3], 5);

    expect(results).toHaveLength(1);
    expect(results[0]!.payload['attributed_to']).toBe('paulo');
  });

  test('rowToResult: NULL attributed_to is NOT projected into payload', async () => {
    const poolQuery = vi.fn().mockImplementation(() => ({
      rows: [
        {
          id: 'id-1',
          text: 'no attribution',
          hash: 'h-no-attr',
          payload: {},
          user_id: 'alice',
          session_id: null,
          agent_id: null,
          attributed_to: null,
          distance: 0.2,
        },
      ],
    }));
    const pool = { query: poolQuery } as unknown as Pool;
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    const results = await store.search([0.1, 0.2, 0.3], 5);

    expect(results).toHaveLength(1);
    // attributed_to should NOT be in payload when NULL (backward compat — pre-v1.1 rows).
    expect(results[0]!.payload['attributed_to']).toBeUndefined();
  });
});

describe('PgvectorStore constructor — tracer still works via options-object (T0.2 / SEPA iter 2 M2)', () => {
  test('accepts new PgvectorStore(pool, { tracer }) — tracer moved into options object', () => {
    const { pool } = buildPool();
    // Minimal tracer stub satisfying the Tracer interface used by F-arch-3.
    const tracer = {
      startActiveSpan: vi.fn(),
      startSpan: vi.fn(),
    };
    const store = new PgvectorStore(pool, { tracer: tracer as never });
    expect(store).toBeDefined();
  });

  test('accepts BOTH embeddingDim AND tracer in the options object', () => {
    const { pool } = buildPool();
    const tracer = {
      startActiveSpan: vi.fn(),
      startSpan: vi.fn(),
    };
    const store = new PgvectorStore(pool, { embeddingDim: 384, tracer: tracer as never });
    expect(store).toBeDefined();
  });
});
