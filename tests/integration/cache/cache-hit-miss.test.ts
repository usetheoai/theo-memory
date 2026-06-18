/**
 * T1.1 integration — `PgvectorRecallCacheStore` get/set/invalidateScope/clearExpired
 * against real `ankane/pgvector:v0.5.1`.
 *
 * Verifies the semantic-similarity contract that mocks cannot: cosine via
 * pgvector `<=>`, NaN behavior on zero-norm queries (EC-8), TTL expiry,
 * scope isolation, clearExpired sweep.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T1.1
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { MemoryItemWithScore } from '@usetheo/memory';
import type { Scope } from '@usetheo/memory';
import { PgvectorRecallCacheStore } from '../../../packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t1_1_cache_hit_miss';

const EMBED_DIM = 1536;

/** Build a length-1536 vector with the first 3 numbers set as requested + rest zeros. */
function vec(first: readonly number[]): number[] {
  const out = new Array<number>(EMBED_DIM).fill(0);
  for (let i = 0; i < first.length; i++) out[i] = first[i] ?? 0;
  return out;
}

/** L2-normalize a vector so cosine similarity calculations are well-defined and finite. */
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

const ALICE: Scope = { kind: 'user', userId: 'alice' };
const BOB: Scope = { kind: 'user', userId: 'bob' };
const SAMPLE_RESULTS: MemoryItemWithScore[] = [
  {
    id: '00000000-0000-0000-0000-00000000abcd',
    text: 'Paulo likes dark mode',
    payload: { source: 'chat' },
    createdAt: new Date('2026-06-03T00:00:00Z'),
    updatedAt: new Date('2026-06-03T00:00:00Z'),
    score: 0.95,
  },
];

describe.skipIf(ROOT_PG_URI === '')(
  'T1.1 — PgvectorRecallCacheStore (integration)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let pool: pg.Pool;
    let store: PgvectorRecallCacheStore;

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();

      pool = new pg.Pool({ connectionString: testUri });
      const m = await import('@usetheo/memory');
      await m.runMigrations(pool);
      store = new PgvectorRecallCacheStore(pool);
    }, 60_000);

    afterAll(async () => {
      await pool?.end();
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    });

    beforeEach(async () => {
      // Truncate to isolate tests.
      await pool.query('TRUNCATE recall_cache RESTART IDENTITY');
    });

    it('T1.1-RED-1 — get() on empty cache returns undefined (MISS)', async () => {
      const result = await store.get(normalize(vec([1, 0, 0])), ALICE);
      expect(result).toBeUndefined();
    });

    it('T1.1-RED-2 — set() then get() with SAME embedding → HIT with similarity ~ 1.0', async () => {
      const e = normalize(vec([1, 0, 0]));
      await store.set(e, ALICE, SAMPLE_RESULTS, 600);
      const hit = await store.get(e, ALICE);
      expect(hit).toBeDefined();
      expect(hit?.results).toEqual(
        SAMPLE_RESULTS.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      );
      expect(hit?.similarity).toBeGreaterThan(0.9999);
    });

    it('T1.1-RED-3 — set() then get() at cosine 0.85 (above default threshold 0.8) → HIT', async () => {
      // Construct a near-duplicate: same first dim, slightly different second dim.
      // Cosine of (1,0,...) and (cos(θ), sin(θ),...) is cos(θ).
      // cos⁻¹(0.85) ≈ 31.79°  → θ ≈ 0.5548 rad
      const theta = Math.acos(0.85);
      const e1 = normalize(vec([1, 0]));
      const e2 = normalize(vec([Math.cos(theta), Math.sin(theta)]));
      await store.set(e1, ALICE, SAMPLE_RESULTS, 600);
      const hit = await store.get(e2, ALICE);
      expect(hit).toBeDefined();
      expect(hit?.similarity).toBeGreaterThan(0.84);
      expect(hit?.similarity).toBeLessThan(0.86);
    });

    it('T1.1-RED-4 — set() then get() at cosine 0.7 (below default threshold 0.8) → MISS', async () => {
      const theta = Math.acos(0.7);
      const e1 = normalize(vec([1, 0]));
      const e2 = normalize(vec([Math.cos(theta), Math.sin(theta)]));
      await store.set(e1, ALICE, SAMPLE_RESULTS, 600);
      const miss = await store.get(e2, ALICE);
      expect(miss).toBeUndefined();
    });

    it('T1.1-RED-5 — set() with ttl=1; wait 2s; get() returns undefined (expired)', async () => {
      const e = normalize(vec([0.5, 0.5]));
      await store.set(e, ALICE, SAMPLE_RESULTS, 1);
      await new Promise((r) => setTimeout(r, 2000));
      const expired = await store.get(e, ALICE);
      expect(expired).toBeUndefined();
    }, 10_000);

    it('T1.1-RED-6 — invalidateScope() deletes all rows in scope; subsequent get() → MISS', async () => {
      const e = normalize(vec([1, 0]));
      await store.set(e, ALICE, SAMPLE_RESULTS, 600);
      await store.set(normalize(vec([0, 1])), ALICE, SAMPLE_RESULTS, 600);
      const deleted = await store.invalidateScope(ALICE);
      expect(deleted).toBe(2);
      const miss = await store.get(e, ALICE);
      expect(miss).toBeUndefined();
    });

    it('T1.1-RED-7 — clearExpired() deletes ONLY rows where expires_at <= NOW()', async () => {
      // One expired (ttl=1, wait), one fresh (ttl=600).
      await store.set(normalize(vec([1, 0])), ALICE, SAMPLE_RESULTS, 1);
      await store.set(normalize(vec([0, 1])), ALICE, SAMPLE_RESULTS, 600);
      await new Promise((r) => setTimeout(r, 1500));
      const swept = await store.clearExpired();
      expect(swept).toBe(1);
      const remaining = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'ws:default|user:alice'`,
      );
      expect(remaining.rows[0]?.count).toBe('1');
    }, 10_000);

    it('T1.1-RED-8 — scope isolation: set in user:alice; get in user:bob → MISS', async () => {
      const e = normalize(vec([1, 0]));
      await store.set(e, ALICE, SAMPLE_RESULTS, 600);
      const miss = await store.get(e, BOB);
      expect(miss).toBeUndefined();
      // And the original hit in alice still works.
      const hit = await store.get(e, ALICE);
      expect(hit).toBeDefined();
    });

    it('T1.1-RED-9 (EC-8) — get() with zero-norm query embedding → MISS (no NaN crash)', async () => {
      // Seed with a normal vector.
      await store.set(normalize(vec([1, 0])), ALICE, SAMPLE_RESULTS, 600);
      // Query with zero vector → cosine distance NaN → (1 - NaN) >= 0.8 is FALSE → row excluded.
      const zeroVec = new Array<number>(EMBED_DIM).fill(0);
      const miss = await store.get(zeroVec, ALICE);
      expect(miss).toBeUndefined();
    });

    it('T1.1-RED-10 (EC-12 DOCUMENT) — set() with large result_set (10 items × 50 KB each) succeeds', async () => {
      // ~500 KB total JSONB — well within Postgres practical row limits.
      const big = Array.from({ length: 10 }, (_, i): MemoryItemWithScore => ({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        text: 'x'.repeat(50_000),
        payload: { i },
        createdAt: new Date('2026-06-03T00:00:00Z'),
        updatedAt: new Date('2026-06-03T00:00:00Z'),
        score: 0.5,
      }));
      const e = normalize(vec([1, 0]));
      await expect(store.set(e, ALICE, big, 600)).resolves.toBeUndefined();
      const hit = await store.get(e, ALICE);
      expect(hit?.results).toHaveLength(10);
    });
  },
);
