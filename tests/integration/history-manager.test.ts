/**
 * Integration test for DrizzleHistoryManager — T6.1 of v0-1-local-runtime plan v1.3.
 *
 * Runs against real ankane/pgvector:v0.5.1 via docker-compose. Gated by
 * THEOMEM_PG_URI env var.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import { DrizzleHistoryManager } from '../../src/local/history-manager.js';
import { memories } from '../../src/local/schema.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('DrizzleHistoryManager (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const db = drizzle(pool);
  const manager = new DrizzleHistoryManager(db);

  let seedMemoryId = '';

  afterAll(async () => {
    await pool.query('TRUNCATE memories, history CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    // Seed a fresh memory row per test so FK constraints survive cross-file TRUNCATEs.
    await pool.query('TRUNCATE memories, history RESTART IDENTITY CASCADE');
    seedMemoryId = randomUUID();
    const embedding = `[${new Array(1536).fill(0).join(',')}]`;
    await pool.query(
      `INSERT INTO memories (id, text, hash, embedding, payload) VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
      [seedMemoryId, `seed-${seedMemoryId}`, `hash-${seedMemoryId}`, embedding, JSON.stringify({})],
    );
  });

  describe('DrizzleHistoryManager', () => {
    test('addHistory persists a single audit row', async () => {
      const memoryId = seedMemoryId;
      await manager.addHistory(memoryId, null, 'first fact', 'remember');
      const rows = await manager.getHistory(memoryId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('remember');
      expect(rows[0]?.newValue).toBe('first fact');
    });

    test('batchAddHistory persists N rows in one statement', async () => {
      const memoryId = seedMemoryId;
      await manager.batchAddHistory([
        { memoryId, previousValue: null, newValue: 'a', action: 'remember' },
        { memoryId, previousValue: 'a', newValue: 'b', action: 'reflect' },
      ]);
      const rows = await manager.getHistory(memoryId);
      expect(rows).toHaveLength(2);
    });

    test('getHistory orders newest first (timestamp DESC, id DESC tiebreaker per EC-18)', async () => {
      const memoryId = seedMemoryId;
      // Two rows with very close timestamps
      const now = new Date();
      await manager.addHistory(memoryId, null, 'older', 'remember', now);
      await manager.addHistory(memoryId, null, 'newer', 'reflect', now);
      const rows = await manager.getHistory(memoryId);
      expect(rows[0]?.newValue).toBe('newer');
      expect(rows[1]?.newValue).toBe('older');
    });

    test('reset drops all history rows', async () => {
      const memoryId = seedMemoryId;
      await manager.addHistory(memoryId, null, 'temp', 'remember');
      await manager.reset();
      const rows = await manager.getHistory(memoryId);
      expect(rows).toHaveLength(0);
    });

    test('getHistory returns empty for memory with no events', async () => {
      const rows = await manager.getHistory(randomUUID());
      expect(rows).toEqual([]);
    });

    test('batchAddHistory with empty array is a no-op', async () => {
      await manager.batchAddHistory([]);
      const rows = await manager.getHistory(seedMemoryId);
      expect(rows).toHaveLength(0);
    });
  });
}
