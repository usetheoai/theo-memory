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
 */
import type { Pool } from 'pg';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import { EmbeddingMismatch } from '../../domain/errors.js';

import { PgvectorStore } from './pgvector-store.js';

function transactionalPool(poolQuery: (sql: string, params?: unknown[]) => unknown): Pool {
  return { query: poolQuery, connect: async () => ({
    release: vi.fn(),
    query: async (sql: string, params?: unknown[]) => {
      const result = await poolQuery(sql, params) as { rows: { id?: string }[] };
      if (sql.includes('INSERT INTO memories') && result.rows.length > 1) {
        return { ...result, rows: result.rows.filter((row) => row.id === params?.[0]) };
      }
      return result;
    },
  }) } as unknown as Pool;
}

function buildPool(): { pool: Pool; poolQuery: ReturnType<typeof vi.fn> } {
  const poolQuery = vi.fn().mockImplementation(() => {
    throw new Error('pool.query should not be reached when the guard rejects');
  });
  const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
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

describe('PgvectorStore.insert — composite ON CONFLICT + dedup_collision_confirmed (principles-alignment-hardening T1.1)', () => {
  test('SQL uses composite ON CONFLICT (hash, COALESCE(user_id,""), COALESCE(session_id,""), COALESCE(agent_id,"")) per ADR D5', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [{ id: 'id-1', confirmation_count: 1, user_id: 'alice', session_id: null, agent_id: null, inserted: true }] };
    });
    const pool = transactionalPool(poolQuery);
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    await store.insert(
      [[0.1, 0.2, 0.3]],
      ['id-1'],
      [{ text: 'fact', hash: 'h-fact', user_id: 'alice' }],
    );

    const insertCall = captured.find((c) => c.sql.includes('INSERT INTO memories'));
    expect(insertCall).toBeDefined();
    // Composite ON CONFLICT — 5-key tuple matching migration 0016's index
    // expression (multi-tenant-workspace-isolation EC-12: workspace_id leads so
    // the same fact in two workspaces is two rows, not a cross-workspace bump).
    expect(insertCall!.sql).toMatch(/ON CONFLICT \(workspace_id, hash, COALESCE\(user_id, ''\), COALESCE\(session_id, ''\), COALESCE\(agent_id, ''\)\)/);
    expect(insertCall!.sql).toMatch(/DO UPDATE SET confirmation_count = memories\.confirmation_count \+ 1/);
    // RETURNING projects (xmax = 0) AS inserted so the wrap site can branch.
    expect(insertCall!.sql).toMatch(/RETURNING.*\(xmax = 0\) AS inserted/);
  });

  test('emits dedup_collision_confirmed for each row with inserted=false; NOT for inserted=true', async () => {
    const events: { event: string; attrs: Record<string, unknown> }[] = [];
    const tracer = {
      startActiveSpan: vi.fn((event: string, fn: (span: { setAttribute: (k: string, v: unknown) => void; end: () => void }) => void) => {
        const attrs: Record<string, unknown> = {};
        fn({ setAttribute: (k: string, v: unknown) => { attrs[k] = v; }, end: () => undefined });
        events.push({ event, attrs });
      }),
      startSpan: vi.fn(),
    };
    const poolQuery = vi.fn().mockImplementation(() => ({
      rows: [
        { id: 'id-new', confirmation_count: 1, user_id: 'alice', session_id: null, agent_id: null, inserted: true },
        { id: 'id-dup', confirmation_count: 2, user_id: 'bob', session_id: null, agent_id: null, inserted: false },
      ],
    }));
    const pool = transactionalPool(poolQuery);
    const store = new PgvectorStore(pool, { embeddingDim: 3, tracer: tracer as never });

    await store.insert(
      [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      ['id-new', 'id-dup'],
      [
        { text: 'fresh fact', hash: 'h-fresh', user_id: 'alice' },
        { text: 'dup fact', hash: 'h-dup', user_id: 'bob' },
      ],
    );

    // Exactly ONE dedup_collision_confirmed (for inserted=false row only).
    const dedupEvents = events.filter((e) => e.event === 'dedup_collision_confirmed');
    expect(dedupEvents).toHaveLength(1);
    expect(dedupEvents[0]?.attrs).toEqual({
      memory_id: 'id-dup',
      confirmation_count: 2,
      scope_tier: 'user',
    });
  });

  test('EC-5: dedup_collision_confirmed no-op when tracer is undefined', async () => {
    const poolQuery = vi.fn().mockImplementation(() => ({
      rows: [
        { id: 'id-dup', confirmation_count: 2, user_id: 'alice', session_id: null, agent_id: null, inserted: false },
      ],
    }));
    const pool = transactionalPool(poolQuery);
    // Construct WITHOUT tracer — emitEvent must handle gracefully.
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    // T2.1 changed insert() return type from Promise<void> to
    // Promise<readonly InsertOutcome[]>. The EC-5 invariant (no throw, no span)
    // is verified by the operation completing cleanly + the rejectedAsDuplicate
    // outcome surfacing without requiring a tracer.
    const outcomes = await store.insert([[0.1, 0.2, 0.3]], ['id-dup'], [{ text: 'fact', hash: 'h-fact', user_id: 'alice' }]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual({ id: 'id-dup', confirmationCount: 2, rejectedAsDuplicate: true });
  });

  test('T2.1 — insert() returns InsertOutcome[] surfacing confirmationCount + rejectedAsDuplicate per row (ADR D1 + D4)', async () => {
    const poolQuery = vi.fn().mockImplementation(() => ({
      rows: [
        { id: 'id-fresh', confirmation_count: 1, user_id: 'alice', session_id: null, agent_id: null, inserted: true },
        { id: 'id-bumped', confirmation_count: 3, user_id: 'alice', session_id: null, agent_id: null, inserted: false },
      ],
    }));
    const pool = transactionalPool(poolQuery);
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    const outcomes = await store.insert(
      [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      ['id-fresh', 'id-bumped'],
      [
        { text: 'fresh', hash: 'h-fresh', user_id: 'alice' },
        { text: 'bumped', hash: 'h-bumped', user_id: 'alice' },
      ],
    );

    expect(outcomes).toEqual([
      { id: 'id-fresh', confirmationCount: 1, rejectedAsDuplicate: false },
      { id: 'id-bumped', confirmationCount: 3, rejectedAsDuplicate: true },
    ]);
  });
});

describe('PgvectorStore.search — attributed_to recall WHERE filter (v1.1 T2.2)', () => {
  test('search WHERE clause appends attributed_to = $N when filters.attributed_to set', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
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
    const pool = transactionalPool(poolQuery);
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    const results = await store.search([0.1, 0.2, 0.3], 5);

    expect(results).toHaveLength(1);
    // attributed_to should NOT be in payload when NULL (backward compat — pre-v1.1 rows).
    expect(results[0]!.payload['attributed_to']).toBeUndefined();
  });
});

describe('PgvectorStore.search — bi-temporal asOf SQL composition (v1.1 T3.1 + ADR-0011)', () => {
  test('search WHERE clause uses currently-valid predicate when asOf is undefined (regression guard)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = transactionalPool(poolQuery);
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    await store.search([0.1, 0.2, 0.3], 5, { user_id: 'alice' });

    const selectCall = captured.find((c) => c.sql.includes('SELECT'));
    expect(selectCall).toBeDefined();
    // Pre-asOf semantic: t_invalid IS NULL filter only.
    expect(selectCall!.sql).toMatch(/t_invalid IS NULL/);
    // asOf-aware clause should NOT fire when undefined.
    expect(selectCall!.sql).not.toMatch(/t_valid\s*<=\s*\$/);
  });

  test('search WHERE clause composes asOf bi-temporal predicate when filters.asOf is set', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = transactionalPool(poolQuery);
    const store = new PgvectorStore(pool, { embeddingDim: 3 });

    const asOf = new Date('2026-03-15T10:00:00Z');
    await store.search([0.1, 0.2, 0.3], 5, { user_id: 'alice', asOf });

    const selectCall = captured.find((c) => c.sql.includes('SELECT'));
    expect(selectCall).toBeDefined();
    // asOf semantic: t_valid <= asOf AND (t_invalid IS NULL OR t_invalid > asOf).
    // null-safe temporal predicate: NULL t_valid treated as -Infinity (always-valid).
    expect(selectCall!.sql).toMatch(/t_valid IS NULL OR t_valid\s*<=\s*\$/);
    expect(selectCall!.sql).toMatch(/t_invalid IS NULL OR t_invalid\s*>\s*\$/);
    expect(selectCall!.params).toContain(asOf);
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

describe('PgvectorStore.search — EG-6 scoped exact path (recall-scoped-exact-search)', () => {
  function capturingStore() {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      return { rows: [] };
    });
    const pool = transactionalPool(poolQuery);
    return { store: new PgvectorStore(pool, { embeddingDim: 3 }), captured };
  }

  test('uses the MATERIALIZED-CTE exact path when a scope filter is present', async () => {
    const { store, captured } = capturingStore();
    await store.search([0.1, 0.2, 0.3], 5, { user_id: 'alice' });
    const searchCall = captured.find((c) => c.sql.includes('embedding <=> $1::vector'));
    expect(searchCall).toBeDefined();
    expect(searchCall!.sql).toMatch(/MATERIALIZED/);
    expect(searchCall!.sql).toMatch(/ORDER BY distance ASC/);
    // scope filter param present + topK last (param order preserved).
    expect(searchCall!.params).toContain('alice');
    expect(searchCall!.params[searchCall!.params.length - 1]).toBe(5);
  });

  test('keeps the plain HNSW ORDER BY path when no filter is present', async () => {
    const { store, captured } = capturingStore();
    await store.search([0.1, 0.2, 0.3], 5);
    const searchCall = captured.find((c) => c.sql.includes('embedding <=> $1::vector'));
    expect(searchCall).toBeDefined();
    expect(searchCall!.sql).not.toMatch(/MATERIALIZED/);
    expect(searchCall!.sql).toMatch(/FROM memories/);
  });

  test('a param-less selective clause (excludeSuperseded) still takes the exact CTE path', async () => {
    // ARCH-3: `excludeSuperseded` emits `superseded_by IS NULL` with NO param.
    // The branch keys on filter.sql (not params.length), so the clause is NOT
    // silently dropped into the unscoped path. Locks the footgun closed.
    const { store, captured } = capturingStore();
    await store.search([0.1, 0.2, 0.3], 5, { excludeSuperseded: true });
    const searchCall = captured.find((c) => c.sql.includes('embedding <=> $1::vector'));
    expect(searchCall).toBeDefined();
    expect(searchCall!.sql).toMatch(/MATERIALIZED/);
    expect(searchCall!.sql).toMatch(/superseded_by IS NULL/);
  });
});

describe('PgvectorStore.listSkillsBySubject — EG cross-repo flat list (skills-cross-repo-flat-list)', () => {
  function capturingStore() {
    const captured: { sql: string; params: unknown[] }[] = [];
    const poolQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      // first call = COUNT, second = page
      return sql.includes('COUNT(*)') ? { rows: [{ total: 0 }] } : { rows: [] };
    });
    const pool = transactionalPool(poolQuery);
    return { store: new PgvectorStore(pool, { embeddingDim: 3 }), captured };
  }

  test('SQL prefix-filters agent_id with escaped wildcards + ESCAPE, binds workspace_id, kind=skill, superseded, LIMIT/OFFSET', async () => {
    const { store, captured } = capturingStore();
    await store.listSkillsBySubject({
      workspaceId: 'default',
      subject: 'alice',
      limit: 25,
      offset: 10,
      includeSuperseded: false,
    });
    const pageCall = captured.find((c) => c.sql.includes('LIMIT'));
    expect(pageCall).toBeDefined();
    expect(pageCall!.sql).toMatch(/agent_id LIKE \$/);
    expect(pageCall!.sql).toMatch(/ESCAPE '\\'/);
    expect(pageCall!.sql).toMatch(/workspace_id = \$1/);
    expect(pageCall!.sql).toMatch(/kind = 'skill'/);
    expect(pageCall!.sql).toMatch(/superseded_by IS NULL/);
    expect(pageCall!.sql).toMatch(/ORDER BY created_at DESC, id ASC/);
    expect(pageCall!.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    // params: $1 workspace, $2 prefix, then limit, offset.
    expect(pageCall!.params[0]).toBe('default');
    expect(pageCall!.params[1]).toBe('alice:%');
    expect(pageCall!.params).toContain(25);
    expect(pageCall!.params).toContain(10);
  });

  test('escapes LIKE wildcards in the subject prefix (no broadening)', async () => {
    const { store, captured } = capturingStore();
    await store.listSkillsBySubject({
      workspaceId: 'default',
      subject: 'a%b_c\\d',
      limit: 10,
      offset: 0,
      includeSuperseded: false,
    });
    const pageCall = captured.find((c) => c.sql.includes('LIMIT'));
    expect(pageCall!.params[1]).toBe('a\\%b\\_c\\\\d:%');
  });

  test('includeSuperseded omits the superseded_by IS NULL clause', async () => {
    const { store, captured } = capturingStore();
    await store.listSkillsBySubject({
      workspaceId: 'default',
      subject: 'alice',
      limit: 10,
      offset: 0,
      includeSuperseded: true,
    });
    const pageCall = captured.find((c) => c.sql.includes('LIMIT'));
    expect(pageCall!.sql).not.toMatch(/superseded_by IS NULL/);
  });

  test('q filter adds description ILIKE bound substring', async () => {
    const { store, captured } = capturingStore();
    await store.listSkillsBySubject({
      workspaceId: 'default',
      subject: 'alice',
      limit: 10,
      offset: 0,
      includeSuperseded: false,
      q: 'csv',
    });
    const pageCall = captured.find((c) => c.sql.includes('LIMIT'));
    expect(pageCall!.sql).toMatch(/description ILIKE \$\d+ ESCAPE/);
    // COR-1: q is escaped + wrapped as a literal substring param.
    expect(pageCall!.params).toContain('%csv%');
  });
});
