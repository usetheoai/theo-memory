/**
 * Integration test for T3.2 of themory-category-filter-server-side plan v1.2.
 *
 * Covers all 10 RED scenarios per plan TDD:
 *  1. category persists from payload via column hoist
 *  2. filter by category exact match (3 rows [a,a,b]; cat=a returns 2)
 *  3. filter excludes NULL category rows
 *  4. no filter returns all rows
 *  5. EXPLAIN shows index scan on memories_category_idx (>50 rows)
 *  6. EC-3 — empty-string filter equivalent to undefined
 *  7. EC-1 / ADR D6 — UPSERT does NOT overwrite category (first-write wins)
 *  8. EC-4 — case-sensitive byte equality
 *  9. EC-5 — Unicode byte equality (NFC vs NFD distinct)
 * 10. EC-6 — SQL-injection probe via category value (parameterized binding)
 *
 * Runs against `ankane/pgvector:v0.5.1` via THEOMEM_PG_URI. Mirrors the
 * pgvector-store-list-temporal.test.ts skeleton.
 *
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

import { PgvectorStore } from '@usetheo/memory';
import { vectorLiteral } from '../../packages/core/src/infrastructure/db/pgvector-vector-literal.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const EMBEDDING_DIM = 1536;

function makeVec(seed = 0.1): readonly number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[0] = seed;
  return v;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('PgvectorStore.category (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => {});
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const store = new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM });

  beforeAll(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  afterEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertVia(
    rows: ReadonlyArray<{ id: string; user: string; cat?: string; hash?: string }>,
  ): Promise<void> {
    const vectors = rows.map((_, i) => makeVec(0.1 + i / 100));
    const ids = rows.map((r) => r.id);
    const payloads = rows.map((r) => {
      const p: Record<string, string | number | boolean | null> = {
        text: `fact-${r.id}`,
        hash: r.hash ?? `hash-${r.id}`,
        user_id: r.user,
      };
      if (r.cat !== undefined) {
        p['category'] = r.cat;
      }
      return p;
    });
    await store.insert(vectors, ids, payloads);
  }

  describe('PgvectorStore.category — T3.2 persist + filter + projection', () => {
    test('1. category persists from payload via column hoist (SELECT-side column reflects payload write)', async () => {
      const id = randomUUID();
      await insertVia([{ id, user: 'alice', cat: 'preferences' }]);

      const colRes = await pool.query<{ category: string | null }>(
        `SELECT category FROM memories WHERE id = $1`,
        [id],
      );
      expect(colRes.rows[0]?.category).toBe('preferences');
    });

    test('2. filter by exact-match category — 3 rows [a, a, b]; filter=a returns 2', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await insertVia([
        { id: ids[0]!, user: 'alice', cat: 'a' },
        { id: ids[1]!, user: 'alice', cat: 'a' },
        { id: ids[2]!, user: 'alice', cat: 'b' },
      ]);

      const [results, total] = await store.list({ user_id: 'alice', category: 'a' }, 100);
      expect(total).toBe(2);
      expect(results.map((r) => r.id).sort()).toEqual([ids[0], ids[1]].sort());
    });

    test('3. filter for category=a excludes rows where category IS NULL', async () => {
      const idCat = randomUUID();
      const idNull = randomUUID();
      await insertVia([
        { id: idCat, user: 'alice', cat: 'a' },
        { id: idNull, user: 'alice' }, // no category
      ]);

      const [results, total] = await store.list({ user_id: 'alice', category: 'a' }, 100);
      expect(total).toBe(1);
      expect(results[0]?.id).toBe(idCat);
    });

    test('4. no category filter returns all rows including NULL category (backward-compat)', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await insertVia([
        { id: ids[0]!, user: 'alice', cat: 'a' },
        { id: ids[1]!, user: 'alice', cat: 'b' },
        { id: ids[2]!, user: 'alice' }, // NULL
      ]);

      const [, total] = await store.list({ user_id: 'alice' }, 100);
      expect(total).toBe(3);
    });

    test('5. memories_category_idx is queryable by the planner (EXPLAIN with enable_seqscan=off)', async () => {
      // Seed 60 rows distributed across two categories.
      const rows = Array.from({ length: 60 }, (_, i) => ({
        id: randomUUID(),
        user: 'alice',
        cat: i % 2 === 0 ? 'evens' : 'odds',
      }));
      await insertVia(rows);
      // ANALYZE so stats reflect the seeded distribution.
      await pool.query('ANALYZE memories');

      // The Postgres planner picks Seq Scan over Index Scan on small tables
      // because the index lookup overhead dominates. To assert the index is
      // QUERYABLE (the architectural invariant — ADR D2 promises O(log n) when
      // the planner needs it), force `enable_seqscan = off` for the session
      // and re-run EXPLAIN. If the index were missing or unusable, the
      // planner would fall back to Seq Scan EVEN with the flag off (it picks
      // the cheapest viable plan; Seq Scan re-emerges when no Index Scan is
      // viable). This proves the index is wired to the column.
      const client = await pool.connect();
      try {
        // SET LOCAL only takes effect inside a transaction; wrap explicitly so
        // the seqscan disable survives until COMMIT/ROLLBACK.
        await client.query('BEGIN');
        await client.query('SET LOCAL enable_seqscan = off');
        const explain = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN (FORMAT TEXT) SELECT id FROM memories
              WHERE category = 'evens' LIMIT 100`,
        );
        await client.query('ROLLBACK');
        const plan = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(plan).toMatch(/Index Scan|Bitmap Index Scan|Bitmap Heap Scan/i);
        // memories_category_idx is the named index introduced by migration 0014.
        expect(plan).toMatch(/memories_category_idx/);
      } finally {
        client.release();
      }
    }, 30_000);

    test('6. EC-3 — empty-string filter normalizes to no-filter (identical result set to undefined)', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await insertVia([
        { id: ids[0]!, user: 'alice', cat: 'a' },
        { id: ids[1]!, user: 'alice', cat: 'b' },
        { id: ids[2]!, user: 'alice' },
      ]);

      const [, totalEmpty] = await store.list({ user_id: 'alice', category: '' }, 100);
      const [, totalUndef] = await store.list({ user_id: 'alice' }, 100);
      expect(totalEmpty).toBe(totalUndef);
      expect(totalEmpty).toBe(3);
    });

    test('7. EC-1 / ADR D6 — UPSERT does NOT overwrite category (first-write wins; confirmation_count bumps)', async () => {
      const id = randomUUID();
      const sharedHash = 'd41d8cd98f00b204e9800998ecf8427e';

      // First write with category='A'.
      await store.insert(
        [makeVec(0.5)],
        [id],
        [{ text: 'same fact', hash: sharedHash, user_id: 'alice', category: 'A' }],
      );

      // Second write — SAME (hash, user_id) but category='B'. ON CONFLICT
      // SET list MUST NOT include category; first-write wins per ADR D6.
      // The new id is irrelevant — UPSERT returns the existing row's id.
      await store.insert(
        [makeVec(0.6)],
        [randomUUID()],
        [{ text: 'same fact rewritten', hash: sharedHash, user_id: 'alice', category: 'B' }],
      );

      const row = await pool.query<{ category: string | null; confirmation_count: number }>(
        `SELECT category, confirmation_count FROM memories WHERE hash = $1 AND user_id = 'alice'`,
        [sharedHash],
      );
      expect(row.rowCount).toBe(1);
      // First-write category preserved.
      expect(row.rows[0]?.category).toBe('A');
      // Confirmation count bumped.
      expect(row.rows[0]?.confirmation_count).toBe(2);
    });

    test('8. EC-4 — case-sensitive byte equality (filter=preferences returns only lowercase)', async () => {
      const idUpper = randomUUID();
      const idLower = randomUUID();
      await insertVia([
        { id: idUpper, user: 'alice', cat: 'Preferences', hash: 'h-upper' },
        { id: idLower, user: 'alice', cat: 'preferences', hash: 'h-lower' },
      ]);

      const [results, total] = await store.list({ user_id: 'alice', category: 'preferences' }, 100);
      expect(total).toBe(1);
      expect(results[0]?.id).toBe(idLower);
    });

    test('9. EC-5 — Unicode byte equality (NFC vs NFD distinct strings)', async () => {
      const idNFC = randomUUID();
      const idNFD = randomUUID();
      const nfc = 'café'; // single composed char é
      const nfd = 'café'; // base e + combining acute accent
      expect(nfc).not.toBe(nfd); // sanity — they are distinct strings

      await insertVia([
        { id: idNFC, user: 'alice', cat: nfc, hash: 'h-nfc' },
        { id: idNFD, user: 'alice', cat: nfd, hash: 'h-nfd' },
      ]);

      const [resultsNFC, totalNFC] = await store.list({ user_id: 'alice', category: nfc }, 100);
      expect(totalNFC).toBe(1);
      expect(resultsNFC[0]?.id).toBe(idNFC);

      const [resultsNFD, totalNFD] = await store.list({ user_id: 'alice', category: nfd }, 100);
      expect(totalNFD).toBe(1);
      expect(resultsNFD[0]?.id).toBe(idNFD);
    });

    test('10. EC-6 — SQL-injection probe via category value (parameterized binding rejects payload)', async () => {
      const idMatch = randomUUID();
      const idOther = randomUUID();
      const probe = "' OR 1=1 --";

      await insertVia([
        { id: idMatch, user: 'alice', cat: probe, hash: 'h-probe' },
        { id: idOther, user: 'alice', cat: 'unrelated', hash: 'h-other' },
      ]);

      // Filter for the literal probe string. If parameterization were broken,
      // the OR 1=1 would force ALL rows to match (catastrophic data leak).
      // With parameterized binding, the predicate becomes `category = $N` with
      // $N bound to the literal probe string — only the matching row returns.
      const [results, total] = await store.list({ user_id: 'alice', category: probe }, 100);
      expect(total).toBe(1);
      expect(results[0]?.id).toBe(idMatch);
    });
  });
}
