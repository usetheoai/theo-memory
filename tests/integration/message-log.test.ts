/**
 * PgMessageLog against real Postgres under the application role (row-level security on):
 * the shared MessageLog conformance suite, plus the database-level guarantee that erasing a
 * memory erases the messages that produced it.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import pg from 'pg';

import { PgMessageLog } from '@usetheo/memory';
import { runMessageLogConformance } from '../../packages/core/src/infrastructure/db/message-log-conformance.js';
import type { Filters } from '../../packages/core/src/domain/scope.js';

import { createIsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('PgMessageLog (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  let pool: pg.Pool;
  let otherTenantPool: pg.Pool;
  let setupPool: pg.Pool;
  let dropDb: () => Promise<void>;

  beforeAll(async () => {
    const iso = await createIsolatedDb();
    pool = iso.poolPinnedTo('default');
    otherTenantPool = iso.poolPinnedTo('other-tenant');
    setupPool = iso.setupPool;
    dropDb = iso.dropDb;
  }, 30_000);

  afterAll(async () => {
    await dropDb();
  });

  async function createMemory(filters: Filters): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO memories (text, hash, embedding, payload, workspace_id, user_id, session_id, agent_id)
       VALUES ('fact', $1, array_fill(0.1::real, ARRAY[1536])::vector, '{}'::jsonb, 'default', $2, $3, $4) RETURNING id`,
      [`h-${randomUUID()}`, filters.user_id ?? null, filters.session_id ?? null, filters.agent_id ?? null],
    );
    return rows[0]!.id;
  }

  runMessageLogConformance('PgMessageLog (real Postgres, application role)', () =>
    Promise.resolve({
      log: new PgMessageLog(pool),
      createMemory,
      inScope: (_filters, fn) => fn(),
      reset: async () => {
        await setupPool.query('TRUNCATE memory_message_sources, memory_messages, memories RESTART IDENTITY CASCADE');
      },
    }));

  describe('PgMessageLog erasure enforced by the database', () => {
    const user: Filters = { workspace_id: 'default', user_id: 'erasure-user' };

    test('physically deleting a memory erases the messages that produced it', async () => {
      const log = new PgMessageLog(pool);
      const memoryId = await createMemory(user);
      const ids = await log.append(user, [{ role: 'user', content: 'my card number is 4111' }]);
      await log.append(user, [{ role: 'user', content: 'unrelated' }]);
      await log.linkSources(user, [memoryId], ids);
      await pool.query('DELETE FROM memories WHERE id = $1', [memoryId]);
      expect((await log.recent(user, 10)).map((m) => m.content)).toEqual(['unrelated']);
    });

    test('a soft forget (t_invalid) keeps the source messages', async () => {
      const log = new PgMessageLog(pool);
      const memoryId = await createMemory(user);
      const ids = await log.append(user, [{ role: 'user', content: 'still on record' }]);
      await log.linkSources(user, [memoryId], ids);
      await pool.query('UPDATE memories SET t_invalid = now() WHERE id = $1', [memoryId]);
      expect((await log.sourcesOf(user, memoryId)).map((m) => m.content)).toEqual(['still on record']);
    });

    test('another workspace cannot read the log', async () => {
      const log = new PgMessageLog(pool);
      await log.append(user, [{ role: 'user', content: 'tenant default only' }]);
      // Same user id, read from another tenant's connection, with or without naming the workspace.
      const other = new PgMessageLog(otherTenantPool);
      expect(await other.recent({ workspace_id: 'other-tenant', user_id: 'erasure-user' }, 10)).toEqual([]);
      expect(await other.recent({ workspace_id: 'default', user_id: 'erasure-user' }, 10)).toEqual([]);
    });
  });

}
