/**
 * entity-extraction-nodes-slice1 T2.1 — schema-level guarantees against real
 * `ankane/pgvector:v0.5.1`. Proves the migration 0018 DDL:
 *   1. EC-1 dedup: same (workspace, scope, type, normalized_key) → ON CONFLICT
 *      DO NOTHING leaves exactly ONE entities row (COALESCE handles NULL scope).
 *   2. EC-1 type-in-identity: same key, DIFFERENT type (PROPER vs NOUN) → TWO rows
 *      (Apple/apple do not silently merge).
 *   3. CASCADE: deleting a memory removes its memory_entities links.
 *
 * Gated by THEOMEM_PG_URI (EC-17: CI=true with absent env fails loudly).
 *
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T2.1
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { runMigrations } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];
const ZERO_VEC = `[${new Array(1536).fill(0).join(',')}]`;

// MUST track the `entities_scope_type_key_uq` index expression byte-for-byte
// (schema.ts entities table). If the index COALESCE order drifts, update this too.
const ON_CONFLICT =
  'ON CONFLICT (workspace_id, COALESCE(user_id,\'\'), COALESCE(session_id,\'\'),' +
  ' COALESCE(agent_id,\'\'), COALESCE(type,\'\'), COALESCE(normalized_key,\'\')) DO NOTHING';

async function insertEntity(
  pool: pg.Pool,
  name: string,
  type: string,
  key: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO entities (workspace_id, name, embedding, payload, type, normalized_key, user_id)
     VALUES ('default', $1, $2::vector, '{}'::jsonb, $3, $4, $5) ${ON_CONFLICT}`,
    [name, ZERO_VEC, type, key, userId],
  );
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('entities schema T2.1 (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities RESTART IDENTITY CASCADE');
  });

  describe('entities schema T2.1 — real pgvector', () => {
    test('EC-1: same scope+type+normalized_key dedups to one row (NULL-safe COALESCE)', async () => {
      await insertEntity(pool, 'John Smith', 'PROPER', 'john_smith', 'alice');
      await insertEntity(pool, 'John Smith', 'PROPER', 'john_smith', 'alice');
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM entities WHERE normalized_key='john_smith'`,
      );
      expect(rows[0].n).toBe(1);
    });

    test('EC-1: same key but different type yields two rows (PROPER != NOUN)', async () => {
      await insertEntity(pool, 'Apple', 'PROPER', 'apple', 'alice');
      await insertEntity(pool, 'apple', 'NOUN', 'apple', 'alice');
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM entities WHERE normalized_key='apple'`,
      );
      expect(rows[0].n).toBe(2);
    });

    test('CASCADE: deleting a memory removes its memory_entities links', async () => {
      const memId = randomUUID();
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload) VALUES ($1,'t','h',$2::vector,'{}'::jsonb)`,
        [memId, ZERO_VEC],
      );
      await insertEntity(pool, 'Google', 'PROPER', 'google', 'alice');
      const { rows: er } = await pool.query(`SELECT id FROM entities WHERE normalized_key='google'`);
      await pool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1,$2)`, [
        memId,
        er[0].id,
      ]);
      await pool.query(`DELETE FROM memories WHERE id=$1`, [memId]);
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM memory_entities WHERE memory_id=$1`,
        [memId],
      );
      expect(rows[0].n).toBe(0);
    });
  });
}
