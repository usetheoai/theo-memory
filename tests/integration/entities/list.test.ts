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
    test('soft-deleted memories do not count and a fully-deleted entity vanishes (#115)', async () => {
      const live = await seedMemory(pool, '2026-06-01T00:00:00Z');
      const gone = await seedMemory(pool, '2026-06-02T00:00:00Z');
      await store.upsertAndLink({
        memoryId: live,
        workspaceId: 'default',
        filters: { user_id: 'alice' },
        entities: [
          { type: 'PROPER', name: 'Kept Entity', normalizedKey: 'kept_entity', embedding: new Array(1536).fill(0) },
        ],
      });
      await store.upsertAndLink({
        memoryId: gone,
        workspaceId: 'default',
        filters: { user_id: 'alice' },
        entities: [
          { type: 'PROPER', name: 'Kept Entity', normalizedKey: 'kept_entity', embedding: new Array(1536).fill(0) },
          { type: 'PROPER', name: 'Ghost Entity', normalizedKey: 'ghost_entity', embedding: new Array(1536).fill(0) },
        ],
      });
      // Soft-delete one memory: its links MUST stop counting (the incident
      // symptom: "Forget 1 memories" offered for an entity whose only links
      // were already forgotten).
      await pool.query(`UPDATE memories SET t_invalid = now() WHERE id = $1`, [gone]);

      const rows = await store.list({ workspaceId: 'default', filters: { user_id: 'alice' } });
      const kept = rows.find((r) => r.name === 'Kept Entity');
      expect(kept?.memoryCount).toBe(1);
      // An entity whose every linked memory is soft-deleted disappears entirely.
      expect(rows.find((r) => r.name === 'Ghost Entity')).toBeUndefined();
    });

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

    test('F-H2: two concurrent same-entity upserts (diff memories) → ONE entity row, TWO links', async () => {
      const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
      const m2 = await seedMemory(pool, '2026-06-02T00:00:00Z');
      const ent = {
        type: 'PROPER' as const,
        name: 'John Smith',
        normalizedKey: 'john_smith',
        embedding: new Array(1536).fill(0),
      };
      // Concurrent test: the ON CONFLICT DO NOTHING upsert is the happens-before
      // observation — exactly one entities row must survive the race, with both links.
      await Promise.all([
        store.upsertAndLink({ memoryId: m1, workspaceId: 'default', filters: { user_id: 'alice' }, entities: [ent] }),
        store.upsertAndLink({ memoryId: m2, workspaceId: 'default', filters: { user_id: 'alice' }, entities: [ent] }),
      ]);
      // Scoped to user_id='alice' so the assertion is robust to other integration
      // files sharing the DB (cross-file parallelism on the dev pg).
      const { rows: erows } = await pool.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM entities WHERE normalized_key='john_smith' AND user_id='alice'`,
      );
      expect(Number(erows[0]?.n)).toBe(1); // atomic-counter invariant: one row, not two
      const { rows: lrows } = await pool.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM memory_entities me
           JOIN entities e ON e.id = me.entity_id
          WHERE e.user_id='alice' AND e.normalized_key='john_smith'`,
      );
      expect(Number(lrows[0]?.n)).toBe(2); // both memories linked to the one entity
      const summary = await store.list({ workspaceId: 'default', filters: { user_id: 'alice' } });
      expect(summary.find((s) => s.name === 'John Smith')?.memoryCount).toBe(2);
    });
  });
}
