/**
 * entity-extraction-nodes-slice1 T4.1 (ADR D4) — PgMemoryEntityStore.list read
 * method against real `ankane/pgvector:v0.5.1`.
 *
 * Proves: memoryCount = COUNT(DISTINCT memory_id) via the join; ordering by
 * memoryCount desc; lastSeenAt = MAX(linked memory created_at); workspace+scope
 * isolation via the COALESCE idiom (an entity in user-scope is NOT returned for
 * a session-scope query).
 *
 * Gated by THEOMEM_PG_URI.
 *
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T4.1 + ADR D4
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { runMigrations } from '@usetheo/memory';
import { PgMemoryEntityStore } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];
const ZERO_VEC = `[${new Array(1536).fill(0).join(',')}]`;

async function seedMemory(pool: pg.Pool, createdAt: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO memories (id, text, hash, embedding, payload, created_at)
     VALUES ($1,'t',$2,$3::vector,'{}'::jsonb,$4)`,
    [id, randomUUID(), ZERO_VEC, createdAt],
  );
  return id;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('PgMemoryEntityStore.list (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const store = new PgMemoryEntityStore(pool);

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities RESTART IDENTITY CASCADE');
  });

  describe('PgMemoryEntityStore.list (T4.1)', () => {
    test('returns one summary per entity with memoryCount from the join, ordered desc', async () => {
      const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
      const m2 = await seedMemory(pool, '2026-06-03T00:00:00Z');
      // "John Smith" linked to 2 memories; "Google" to 1.
      await store.upsertAndLink({
        memoryId: m1,
        workspaceId: 'default',
        filters: { user_id: 'alice' },
        entities: [
          { type: 'PROPER', name: 'John Smith', normalizedKey: 'john_smith', embedding: new Array(1536).fill(0) },
          { type: 'PROPER', name: 'Google', normalizedKey: 'google', embedding: new Array(1536).fill(0) },
        ],
      });
      await store.upsertAndLink({
        memoryId: m2,
        workspaceId: 'default',
        filters: { user_id: 'alice' },
        entities: [
          { type: 'PROPER', name: 'John Smith', normalizedKey: 'john_smith', embedding: new Array(1536).fill(0) },
        ],
      });

      const rows = await store.list({ workspaceId: 'default', filters: { user_id: 'alice' } });
      expect(rows).toHaveLength(2);
      expect(rows[0]?.name).toBe('John Smith');
      expect(rows[0]?.memoryCount).toBe(2);
      expect(rows[0]?.lastSeenAt).toContain('2026-06-03');
      expect(rows[1]?.memoryCount).toBe(1);
    });

    test('is workspace + scope filtered (COALESCE idiom): user-scope entity not returned for a session query', async () => {
      const m = await seedMemory(pool, '2026-06-01T00:00:00Z');
      await store.upsertAndLink({
        memoryId: m,
        workspaceId: 'default',
        filters: { user_id: 'alice' },
        entities: [{ type: 'PROPER', name: 'Alice Co', normalizedKey: 'alice_co', embedding: new Array(1536).fill(0) }],
      });
      const sessionRows = await store.list({ workspaceId: 'default', filters: { session_id: 's1' } });
      expect(sessionRows).toHaveLength(0);
      const userRows = await store.list({ workspaceId: 'default', filters: { user_id: 'alice' } });
      expect(userRows).toHaveLength(1);
    });

    test('empty scope returns []', async () => {
      const rows = await store.list({ workspaceId: 'default', filters: { user_id: 'nobody' } });
      expect(rows).toEqual([]);
    });
  });
}
