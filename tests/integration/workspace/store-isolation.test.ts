/**
 * T1.1 — PgvectorStore workspace isolation (the security core).
 *
 * Plan multi-tenant-workspace-isolation § T1.1 / ADR D1/D4 + EC-12.
 * Asserts the store-level enforcement: with workspace_id in the payload (insert)
 * and in the Filters (search), a ws-A search never returns a ws-B row, and the
 * SAME fact under the SAME user in two workspaces is two distinct rows (EC-12 —
 * no cross-workspace confirmation_count bump).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { PgvectorStore } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const DIM = 1536;

/** One-hot vector at `index` so cosine distance is deterministic. */
function oneHot(index: number): number[] {
  const v = Array.from({ length: DIM }, () => 0);
  v[index] = 1;
  return v;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('store workspace isolation (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('PgvectorStore — workspace isolation', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let store: PgvectorStore;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      // Uma conexão que ATRAVESSA workspaces, de propósito. O teste existe para
      // provar que o filtro do STORE isola — e para isso a conexão precisa ser
      // capaz de vazar. Rodá-lo sobre o pool contido inverteria o que ele mede:
      // passaria mesmo se o `WHERE workspace_id` fosse removido, porque a policy
      // seguraria. Duas camadas independentes; um teste de uma não pode ser
      // satisfeito em silêncio pela outra.
      pool = iso.crossWorkspacePool('mede o filtro do store, que precisa poder vazar para falhar');
      dropDb = iso.dropDb;
      store = new PgvectorStore(pool);
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    test('a ws-A search never returns a ws-B row (the IDOR core)', async () => {
      const userId = `alice-${randomUUID()}`;
      const vec = oneHot(7);
      // Same user, same query vector, two workspaces.
      await store.insert(
        [vec],
        [randomUUID()],
        [{ text: 'secret in workspace A', hash: `h-${randomUUID()}`, workspace_id: 'ws-a', user_id: userId }],
      );
      await store.insert(
        [vec],
        [randomUUID()],
        [{ text: 'secret in workspace B', hash: `h-${randomUUID()}`, workspace_id: 'ws-b', user_id: userId }],
      );

      // ws-A Principal recalls — must see ONLY ws-A's row.
      const resultsA = await store.search(vec, 10, { workspace_id: 'ws-a', user_id: userId });
      expect(resultsA.length).toBe(1);
      expect(resultsA[0]?.payload['text']).toBe('secret in workspace A');

      // ws-B Principal recalls — must see ONLY ws-B's row.
      const resultsB = await store.search(vec, 10, { workspace_id: 'ws-b', user_id: userId });
      expect(resultsB.length).toBe(1);
      expect(resultsB[0]?.payload['text']).toBe('secret in workspace B');
    });

    test('the same fact under the same user in two workspaces is two rows, not a cross-workspace bump (EC-12)', async () => {
      const userId = `bob-${randomUUID()}`;
      const sharedHash = `h-shared-${randomUUID()}`;
      const vec = oneHot(9);
      await store.insert(
        [vec],
        [randomUUID()],
        [{ text: 'same fact', hash: sharedHash, workspace_id: 'ws-a', user_id: userId }],
      );
      await store.insert(
        [vec],
        [randomUUID()],
        [{ text: 'same fact', hash: sharedHash, workspace_id: 'ws-b', user_id: userId }],
      );

      // Two distinct rows survive (the ws-B insert did NOT collide onto ws-A's row).
      const { rows } = await pool.query<{ workspace_id: string; confirmation_count: number }>(
        `SELECT workspace_id, confirmation_count FROM memories WHERE hash = $1 ORDER BY workspace_id`,
        [sharedHash],
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.workspace_id)).toEqual(['ws-a', 'ws-b']);
      // Neither row's confirmation_count was bumped by the OTHER workspace's write
      // (confirmation_count DEFAULTs to 1 on a fresh insert per migration 0011).
      expect(rows[0]?.confirmation_count).toBe(1);
      expect(rows[1]?.confirmation_count).toBe(1);
    });

    test('a re-remember WITHIN the same workspace still bumps confirmation_count (intra-workspace dedup intact)', async () => {
      const userId = `carol-${randomUUID()}`;
      const sharedHash = `h-intra-${randomUUID()}`;
      const vec = oneHot(11);
      await store.insert([vec], [randomUUID()], [{ text: 'dup', hash: sharedHash, workspace_id: 'ws-a', user_id: userId }]);
      await store.insert([vec], [randomUUID()], [{ text: 'dup', hash: sharedHash, workspace_id: 'ws-a', user_id: userId }]);
      const { rows } = await pool.query<{ confirmation_count: number }>(
        `SELECT confirmation_count FROM memories WHERE hash = $1 AND workspace_id = 'ws-a'`,
        [sharedHash],
      );
      expect(rows).toHaveLength(1);
      // DEFAULT 1 on insert + 1 bump from the intra-workspace re-remember = 2.
      expect(rows[0]?.confirmation_count).toBe(2);
    });
  });
}
