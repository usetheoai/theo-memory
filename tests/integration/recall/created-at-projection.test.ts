/**
 * M10 T1.1 — the vector `search` recall path must project `created_at` so the recalled
 * row carries its REAL age (not `now`), the recency signal the M10 scope-aware reweight
 * reads. Before this, the `search` `cols` omitted `created_at`, so `rowToItem` hardcoded
 * `createdAt: now` and a recency boost was a no-op. Proven on real ankane/pgvector.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import { PgvectorStore } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M10 created_at recall projection (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M10 T1.1 — the vector search projects the real created_at (real pgvector)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let store: PgvectorStore;
    const USER = `alice-${randomUUID()}`;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('default');
      dropDb = iso.dropDb;
      store = new PgvectorStore(pool);
      await store.initialize();
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
    });

    test('search result carries the stored created_at, not undefined/now (the projection)', async () => {
      // Seed a row with a KNOWN past created_at + a vector; then search that same vector.
      const past = new Date('2020-01-02T03:04:05.000Z');
      const embedding = new Array<number>(1536).fill(0);
      embedding[0] = 0.1;
      await pool.query(
        `INSERT INTO memories (text, hash, embedding, payload, user_id, created_at)
         VALUES ($1,$2,$3::vector,$4::jsonb,$5,$6)`,
        ['alice fact', `h-${randomUUID()}`, `[${embedding.join(',')}]`, JSON.stringify({}), USER, past.toISOString()],
      );

      // Direct store.search with the scope filter — the level M10 T1.1 changed (the `cols`
      // projection). Before the fix, the vector search omitted created_at → the result's
      // createdAt was undefined (and the pipeline hardcoded `now`).
      const results = await store.search([...embedding], 5, { user_id: USER });
      expect(results.length).toBeGreaterThanOrEqual(1);
      // The projected created_at is the STORED past value (and payload carries it too, for the
      // pipeline hoist that feeds the M10 recency boost).
      expect(results[0]!.createdAt).toBeInstanceOf(Date);
      expect((results[0]!.createdAt as Date).getTime()).toBe(past.getTime());
      expect(results[0]!.payload['created_at']).toBe(past.toISOString());
    });
  });
}
