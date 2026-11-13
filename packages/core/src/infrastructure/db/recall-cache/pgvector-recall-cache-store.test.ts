/**
 * T1.1/T1.2 unit tests — `PgvectorRecallCacheStore` SQL composition + parameter
 * binding against a MOCKED `Pool`. Live DB behavior (cosine similarity,
 * SERIALIZABLE semantics) is covered by sibling integration tests at
 * `tests/integration/cache/*.test.ts`.
 *
 */
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MAX_SIZE_PER_SCOPE,
  DEFAULT_THRESHOLD,
  DEFAULT_TTL_SECONDS_BY_SCOPE_TIER,
} from '../../../domain/dip/recall-cache-store.js';
import type { MemoryItemWithScore } from '../../../domain/memory-item.js';
import type { Scope } from '../../../domain/scope.js';

import { PgvectorRecallCacheStore } from './pgvector-recall-cache-store.js';
import { withWorkspaceScope } from '../workspace-scope.js';

/**
 * `set()` escreve numa tabela escopada, e escrever sem escopo passou a lançar
 * (workspace-write-scope.ts). Estes casos exercitam a COMPOSIÇÃO do SQL, então
 * declaram um escopo em vez de contornar o guard — e de quebra o `workspace_id`
 * que chega ao INSERT vira observável.
 */
const WS = 'ws-cache-mock';
const inScope = <T>(fn: () => Promise<T>): Promise<T> => withWorkspaceScope(WS, fn);
import { deriveScopeKey } from './scope-key.js';

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

function buildPool(queryHandler: (sql: string, params?: unknown[]) => { rows?: unknown[]; rowCount?: number }): MockPool {
  const query = vi.fn((sql: string, params?: unknown[]) => Promise.resolve(queryHandler(sql, params)));
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => Promise.resolve(queryHandler(sql, params))),
    release: vi.fn(),
  };
  const connect = vi.fn(() => Promise.resolve(client));
  return { query, connect };
}

const ALICE: Scope = { kind: 'user', userId: 'alice' };
const BOB: Scope = { kind: 'user', userId: 'bob' };
const SAMPLE_RESULTS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    text: 'sample fact',
    payload: { source: 'test' },
    createdAt: new Date('2026-06-03T00:00:00Z'),
    updatedAt: new Date('2026-06-03T00:00:00Z'),
    score: 0.95,
  },
] as unknown as MemoryItemWithScore[];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PgvectorRecallCacheStore — SQL composition (mocked Pool)', () => {
  it('T1.1-RED-1 (mock) — get() returns undefined on empty result set', async () => {
    const pool = buildPool(() => ({ rows: [] }));
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    const result = await store.get([0.1, 0.2, 0.3], ALICE);
    expect(result).toBeUndefined();
  });

  it('T1.1-RED-2 (mock) — get() maps DB row to CachedResult shape (results + cachedAt + similarity)', async () => {
    const cachedAt = new Date('2026-06-01T12:00:00Z');
    const pool = buildPool(() => ({
      rows: [
        {
          result_set: SAMPLE_RESULTS,
          threshold_used: 0.8,
          similarity: 0.92,
          created_at: cachedAt,
        },
      ],
    }));
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    const result = await store.get([0.1, 0.2, 0.3], ALICE);
    expect(result).toEqual({
      results: SAMPLE_RESULTS,
      cachedAt,
      similarity: 0.92,
    });
  });

  it('T1.1 (mock) — get() binds scope_key + vector literal + threshold to SQL params', async () => {
    let capturedParams: unknown[] | undefined;
    const pool = buildPool((_sql, params) => {
      capturedParams = params;
      return { rows: [] };
    });
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool, { threshold: 0.75 });
    await store.get([0.1, 0.2, 0.3], { kind: 'session', sessionId: 'run-42' });
    // T3.1 (Slice 1 100% / EC-8): the scope key is workspace-prefixed; an unbound
    // get defaults to the `default` workspace, matching the column default.
    expect(capturedParams).toEqual(['ws:default|session:run-42', '[0.1,0.2,0.3]', 0.75]);
  });

  it('T1.1-RED-8 (mock) — scope isolation: distinct scope_key per Scope.kind/id', async () => {
    const captured: string[] = [];
    const pool = buildPool((_sql, params) => {
      captured.push(String(params?.[0]));
      return { rows: [] };
    });
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    await store.get([1, 0, 0], ALICE);
    await store.get([1, 0, 0], BOB);
    await store.get([1, 0, 0], { kind: 'session', sessionId: 'S1' });
    await store.get([1, 0, 0], { kind: 'agent', agentId: 'A1' });
    await store.get([1, 0, 0], { kind: 'repo', repoId: 'R1' });
    // T3.1: every key is workspace-prefixed (unbound → default workspace).
    expect(captured).toEqual([
      'ws:default|user:alice',
      'ws:default|user:bob',
      'ws:default|session:S1',
      'ws:default|agent:A1',
      'ws:default|repo:R1',
    ]);
  });

  it('T3.1 (mock) — workspace isolation: same scope in two workspaces yields distinct cache keys (EC-8)', async () => {
    const captured: string[] = [];
    const pool = buildPool((_sql, params) => {
      captured.push(String(params?.[0]));
      return { rows: [] };
    });
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    // Byte-identical query + scope, two different workspaces → two DISTINCT keys,
    // so a ws-A cache row can never satisfy a ws-B lookup (no cross-workspace hit).
    await store.get([1, 0, 0], ALICE, 'ws-a');
    await store.get([1, 0, 0], ALICE, 'ws-b');
    expect(captured).toEqual(['ws:ws-a|user:alice', 'ws:ws-b|user:alice']);
    expect(captured[0]).not.toBe(captured[1]);
  });

  it('T1.1 (mock) — set() opens SERIALIZABLE transaction, COUNTs scope, INSERTs', async () => {
    const sequence: { sql: string; params?: unknown[] }[] = [];
    const queryHandler = (sql: string, params?: unknown[]) => {
      sequence.push(params !== undefined ? { sql, params } : { sql });
      if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }] };
      return { rows: [], rowCount: 1 };
    };
    const pool = buildPool(queryHandler);
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    await inScope(() => store.set([0.1, 0.2, 0.3], ALICE, SAMPLE_RESULTS, 600));
    const sqls = sequence.map((s) => s.sql.split(/\s+/, 2).join(' '));
    expect(sqls).toContain('BEGIN ISOLATION');
    expect(sqls).toContain('COMMIT');
    expect(sequence.some((s) => s.sql.includes('SELECT COUNT(*)'))).toBe(true);
    expect(sequence.some((s) => s.sql.includes('INSERT INTO recall_cache'))).toBe(true);
    // No DELETE because count=0 (well below cap)
    expect(sequence.some((s) => s.sql.includes('DELETE FROM recall_cache') && s.sql.includes('ORDER BY created_at'))).toBe(false);
  });

  it('T1.2-RED-1 (mock) — set() with COUNT >= maxSizePerScope triggers LRU DELETE oldest BEFORE INSERT', async () => {
    const sequence: string[] = [];
    const queryHandler = (sql: string, _params?: unknown[]) => {
      sequence.push(sql);
      if (sql.includes('COUNT(*)')) return { rows: [{ count: 1000 }] }; // at cap
      return { rows: [], rowCount: 1 };
    };
    const pool = buildPool(queryHandler);
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool, { maxSizePerScope: 1000 });
    await inScope(() => store.set([0.1, 0.2, 0.3], ALICE, SAMPLE_RESULTS, 600));
    const deleteIdx = sequence.findIndex((s) => s.includes('DELETE FROM recall_cache') && s.includes('ORDER BY created_at'));
    const insertIdx = sequence.findIndex((s) => s.includes('INSERT INTO recall_cache'));
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(deleteIdx); // DELETE first, INSERT second
  });

  it('T1.2 (mock) — set() with COUNT < maxSizePerScope does NOT issue DELETE', async () => {
    const sequence: string[] = [];
    const queryHandler = (sql: string) => {
      sequence.push(sql);
      if (sql.includes('COUNT(*)')) return { rows: [{ count: 50 }] };
      return { rows: [], rowCount: 1 };
    };
    const pool = buildPool(queryHandler);
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool, { maxSizePerScope: 1000 });
    await inScope(() => store.set([0.1, 0.2, 0.3], ALICE, SAMPLE_RESULTS, 600));
    expect(sequence.some((s) => s.includes('DELETE FROM recall_cache') && s.includes('ORDER BY created_at'))).toBe(false);
  });

  it('T1.1-RED-6 (mock) — invalidateScope() returns deleted rowCount', async () => {
    const pool = buildPool(() => ({ rows: [], rowCount: 42 }));
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    const deleted = await store.invalidateScope({ kind: 'agent', agentId: 'a-1' });
    expect(deleted).toBe(42);
  });

  it('T1.1-RED-7 (mock) — clearExpired() returns swept rowCount', async () => {
    const pool = buildPool(() => ({ rows: [], rowCount: 7 }));
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    const cleared = await store.clearExpired();
    expect(cleared).toBe(7);
  });

  it('T1.2-RED-5 (mock) — set() retries once on 40001 serialization_failure', async () => {
    let connectCalls = 0;
    let beginCount = 0;
    const queryHandler = (sql: string) => {
      if (sql.startsWith('BEGIN ISOLATION')) {
        beginCount++;
        return { rows: [] };
      }
      if (sql.includes('COUNT(*)')) {
        // First attempt: throw 40001; second: succeed (handled in connect override below).
        if (beginCount === 1) {
          const err = new Error('could not serialize access') as Error & { code?: string };
          err.code = '40001';
          throw err;
        }
        return { rows: [{ count: 0 }] };
      }
      return { rows: [], rowCount: 1 };
    };
    const pool: MockPool = {
      query: vi.fn(),
      connect: vi.fn(() => {
        connectCalls++;
        return Promise.resolve({
          query: vi.fn((sql: string) => Promise.resolve(queryHandler(sql))),
          release: vi.fn(),
        });
      }),
    };
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    await expect(inScope(() => store.set([0.1, 0.2, 0.3], ALICE, SAMPLE_RESULTS, 600)))
      .resolves.toBeUndefined();
    expect(connectCalls).toBe(2); // 1 failed + 1 retry
  });

  it('T1.2-RED-5b (mock) — set() does NOT retry on non-40001 errors', async () => {
    let connectCalls = 0;
    const queryHandler = (sql: string) => {
      if (sql.startsWith('BEGIN ISOLATION')) return { rows: [] };
      if (sql.includes('COUNT(*)')) {
        const err = new Error('foreign key violation') as Error & { code?: string };
        err.code = '23503';
        throw err;
      }
      return { rows: [] };
    };
    const pool: MockPool = {
      query: vi.fn(),
      connect: vi.fn(() => {
        connectCalls++;
        return Promise.resolve({
          query: vi.fn((sql: string) => Promise.resolve(queryHandler(sql))),
          release: vi.fn(),
        });
      }),
    };
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    await expect(inScope(() => store.set([0.1, 0.2, 0.3], ALICE, SAMPLE_RESULTS, 600)))
      .rejects.toThrow(/foreign key/);
    expect(connectCalls).toBe(1); // failed once, NOT retried
  });

  it('T1.1 (mock) — defaults applied when config absent (threshold=0.8, max=1000, TTL 4-tier)', async () => {
    let capturedThreshold: number | undefined;
    const pool = buildPool((sql, params) => {
      if (sql.includes('SELECT result_set')) {
        capturedThreshold = params?.[2] as number;
      }
      return { rows: [] };
    });
    const store = new PgvectorRecallCacheStore(pool as unknown as Pool);
    await store.get([1, 0, 0], ALICE);
    expect(capturedThreshold).toBe(DEFAULT_THRESHOLD);
    expect(DEFAULT_THRESHOLD).toBe(0.8);
    expect(DEFAULT_MAX_SIZE_PER_SCOPE).toBe(1000);
    expect(DEFAULT_TTL_SECONDS_BY_SCOPE_TIER.repo).toBe(3600);
  });
});

describe('deriveScopeKey — pure function', () => {
  it('builds `ws:${workspace}|${kind}:${id}` for all 4 scope tiers (default workspace)', () => {
    expect(deriveScopeKey({ kind: 'user', userId: 'u1' })).toBe('ws:default|user:u1');
    expect(deriveScopeKey({ kind: 'session', sessionId: 's1' })).toBe('ws:default|session:s1');
    expect(deriveScopeKey({ kind: 'agent', agentId: 'a1' })).toBe('ws:default|agent:a1');
    expect(deriveScopeKey({ kind: 'repo', repoId: 'r1' })).toBe('ws:default|repo:r1');
  });

  it('prefixes the workspace so the SAME scope in two workspaces yields DISTINCT keys (EC-8)', () => {
    const a = deriveScopeKey({ kind: 'user', userId: 'u1' }, 'ws-a');
    const b = deriveScopeKey({ kind: 'user', userId: 'u1' }, 'ws-b');
    expect(a).toBe('ws:ws-a|user:u1');
    expect(b).toBe('ws:ws-b|user:u1');
    expect(a).not.toBe(b);
  });
});
