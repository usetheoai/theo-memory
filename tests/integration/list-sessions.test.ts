/**
 * Session enumeration integration (session-separation fix, 2026-07-23):
 * `PgvectorStore.listSessions(filters)` returns the DISTINCT `session_id`
 * values under the `(workspace, user)` anchor with live counts + newest
 * activity, newest first — global rows (session_id NULL), soft-deleted rows,
 * cross-user and cross-workspace rows never appear.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';

import { PgvectorStore, MAX_EMBEDDING_DIM } from '@usetheo/memory';

import { createIsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('listSessions (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('PgvectorStore.listSessions — distinct session enumeration', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let store: PgvectorStore;
    const EMB = JSON.stringify(Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1));

    async function seed(row: {
      text: string;
      user: string;
      ws?: string;
      session?: string;
      minutesAgo: number;
      softDeleted?: boolean;
    }): Promise<void> {
      await pool.query(
        `INSERT INTO memories (text, hash, embedding, payload, user_id, session_id, workspace_id, created_at, t_invalid)
         VALUES ($1, $2, $3::vector, $4, $5, $6, $7, NOW() - ($8 || ' minutes')::interval, $9)`,
        [
          row.text,
          `h-${row.text}`,
          EMB,
          JSON.stringify({ text: row.text }),
          row.user,
          row.session ?? null,
          row.ws ?? 'default',
          row.minutesAgo,
          row.softDeleted === true ? new Date() : null,
        ],
      );
    }

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      // Semeia em 'default' E em 'ws2' para provar que o filtro do STORE separa
      // os dois — logo, atravessa por definição. Sobre o pool contido a policy
      // responderia pelo filtro e o teste passaria mesmo sem ele.
      pool = iso.crossWorkspacePool('semeia dois workspaces para provar o filtro de listSessions');
      dropDb = iso.dropDb;
      store = new PgvectorStore(pool);
      await seed({ text: 'global fact', user: 'alice', minutesAgo: 1 });
      await seed({ text: 'sA one', user: 'alice', session: 's-a', minutesAgo: 30 });
      await seed({ text: 'sA two', user: 'alice', session: 's-a', minutesAgo: 20 });
      await seed({ text: 'sB one', user: 'alice', session: 's-b', minutesAgo: 5 });
      await seed({ text: 'sA gone', user: 'alice', session: 's-a', minutesAgo: 2, softDeleted: true });
      await seed({ text: 'bob sess', user: 'bob', session: 's-bob', minutesAgo: 3 });
      await seed({ text: 'other ws', user: 'alice', ws: 'ws2', session: 's-ws2', minutesAgo: 4 });
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    test('aggregates live rows per session under (workspace, user), newest activity first', async () => {
      const sessions = await store.listSessions({ workspace_id: 'default', user_id: 'alice' });
      // s-b is newer (5 min ago) than s-a's newest LIVE row (20 min ago — the
      // soft-deleted 2-min row must not count for activity or count).
      expect(sessions.map((s) => s.sessionId)).toEqual(['s-b', 's-a']);
      expect(sessions[1]?.memoryCount).toBe(2);
      expect(sessions[0]?.memoryCount).toBe(1);
    });

    test('admin (no user filter) sees the workspace sessions, never another workspace', async () => {
      const sessions = await store.listSessions({ workspace_id: 'default' });
      expect(sessions.map((s) => s.sessionId).sort()).toEqual(['s-a', 's-b', 's-bob']);
    });
  });
}
