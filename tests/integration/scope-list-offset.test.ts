/**
 * Dashboard pager live finding (2026-07-22): `GET /v1/scopes/:type/:id/memories`
 * IGNORED `offset` — the zod schema never parsed it and the store list had no
 * OFFSET, so every page returned the same first items (and the cursor path,
 * filtering in-memory over a 100-capped getAll, could never reach item 101+).
 *
 * Contract under test: `PgvectorStore.list(filters, topK, includeSoftDeleted,
 * offset)` applies SQL OFFSET under the deterministic `created_at DESC, id ASC`
 * order, and `total` stays the full scope count.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';

import { PgvectorStore, MAX_EMBEDDING_DIM } from '@usetheo/memory';

import { createIsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('scope-list offset (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('PgvectorStore.list — SQL offset pagination', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let store: PgvectorStore;
    const EMB = JSON.stringify(Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1));

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('default');
      dropDb = iso.dropDb;
      store = new PgvectorStore(pool);
      // 5 rows with strictly decreasing created_at so the DESC order is fixed.
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO memories (text, hash, embedding, payload, user_id, workspace_id, created_at)
           VALUES ($1, $2, $3::vector, $4, 'alice', 'default', NOW() - ($5 || ' minutes')::interval)`,
          [`fact ${String(i)}`, `h-off-${String(i)}`, EMB, JSON.stringify({ text: `fact ${String(i)}`, user_id: 'alice' }), i],
        );
      }
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    test('offset pages through the scope without repeating items; total stays full', async () => {
      const filters = { user_id: 'alice', workspace_id: 'default' };
      const [page1, total1] = await store.list(filters, 2, false, 0);
      const [page2, total2] = await store.list(filters, 2, false, 2);
      const [page3] = await store.list(filters, 2, false, 4);
      expect(total1).toBe(5);
      expect(total2).toBe(5);
      const texts = [...page1, ...page2, ...page3].map((r) => (r.payload as { text: string }).text);
      // DESC by created_at: fact 0 is the newest.
      expect(texts).toEqual(['fact 0', 'fact 1', 'fact 2', 'fact 3', 'fact 4']);
    });
  });
}
