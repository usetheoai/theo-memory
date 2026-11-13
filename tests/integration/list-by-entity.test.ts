/**
 * Entity-filtered listing integration (theo-cloud#252): `PgvectorStore.listByEntity`
 * returns ONLY the live memories linked (via memory_entities) to the entity whose
 * `normalized_key` matches the requested name — never the rest of the scope. This
 * is the server-side filter the dashboard cascade-forget was missing (it deleted
 * the first GLOBAL page instead).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';

import { PgvectorStore, MAX_EMBEDDING_DIM } from '@usetheo/memory';

import { createIsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('listByEntity (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('PgvectorStore.listByEntity — memories of one entity only', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let store: PgvectorStore;
    const EMB = JSON.stringify(Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1));
    const ids = { linked1: randomUUID(), linked2: randomUUID(), unlinked: randomUUID(), softDeleted: randomUUID() };

    async function seedMemory(id: string, text: string, softDeleted = false): Promise<void> {
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, user_id, workspace_id, t_invalid)
         VALUES ($1, $2, $3, $4::vector, $5, 'alice', 'ws1', $6)`,
        [id, text, `h-${text}`, EMB, JSON.stringify({ text }), softDeleted ? new Date() : null],
      );
    }

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('ws1');
      dropDb = iso.dropDb;
      store = new PgvectorStore(pool);
      await seedMemory(ids.linked1, 'codex reviewed the PR');
      await seedMemory(ids.linked2, 'codex flagged a bug');
      await seedMemory(ids.unlinked, 'unrelated global fact');
      await seedMemory(ids.softDeleted, 'codex fact already forgotten', true);
      // Entity "Codex Reviewer" → normalized_key codex_reviewer, linked to 3 rows
      // (one of them soft-deleted — must not come back).
      const ent = await pool.query<{ id: string }>(
        `INSERT INTO entities (name, embedding, payload, workspace_id, normalized_key)
         VALUES ('Codex Reviewer', $1::vector, '{}', 'ws1', 'codex_reviewer') RETURNING id`,
        [EMB],
      );
      const entityId = ent.rows[0]!.id;
      for (const mid of [ids.linked1, ids.linked2, ids.softDeleted]) {
        await pool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)`, [mid, entityId]);
      }
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    /** Page of 50 at offset 0 for the given workspace + surface name. */
    function firstPage(workspaceId: string, entityName: string) {
      return store.listByEntity({ user_id: 'alice', workspace_id: workspaceId }, entityName, 50, 0);
    }

    test('returns only the entity-linked live rows (name normalized server-side)', async () => {
      // Surface name — normalization to codex_reviewer happens inside the store.
      const [rows, total] = await firstPage('ws1', 'Codex Reviewer');
      const texts = rows.map((r) => (r.payload as { text: string }).text).sort();
      expect(texts).toEqual(['codex flagged a bug', 'codex reviewed the PR']);
      expect(total).toBe(2);
    });

    test('unknown entity yields an empty page, never the scope fallback', async () => {
      const [rows, total] = await firstPage('ws1', 'no-such-entity');
      expect(rows).toHaveLength(0);
      expect(total).toBe(0);
    });

    test('cross-workspace entity name never leaks rows', async () => {
      const [rows] = await firstPage('other-ws', 'Codex Reviewer');
      expect(rows).toHaveLength(0);
    });
  });
}
