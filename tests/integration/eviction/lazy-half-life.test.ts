/**
 * T2.2 RED integration tests for v0.4b lazy `half_life_seconds` backfill.
 *
 * Asserts behavior of `TriadicScoringPolicy` + `PgHalfLifePersister` against
 * real `ankane/pgvector:v0.5.1` (env-gated via `THEOMEM_PG_URI`):
 *
 *   - First scoring of a row with `half_life_seconds = NULL` persists the
 *     computed half-life via `UPDATE memories SET half_life_seconds = $1
 *     WHERE id = $2 AND half_life_seconds IS NULL` (idempotent guard).
 *   - Second scoring of the SAME row issues NO UPDATE (idempotency contract
 *     per plan T2.2 Acceptance #2: UPDATE count == 1 across two calls).
 *   - When `llm_importance_score` is UPDATEd later, the Postgres trigger
 *     `memories_reset_half_life_on_importance_update_trg` resets
 *     `half_life_seconds = NULL` so the next scoring re-backfills (EC-1
 *     absorption — stale-half-life-on-importance-update invariant).
 *
 * File location: plan T2.2 § Files to edit declares
 * `src/local/eviction/__tests__/lazy-half-life.test.ts` (CONTRACT-tier path
 * per vitest.contract.config.ts include glob). Real-pgvector integration
 * belongs at `tests/integration/**` per `vitest.integration.config.ts` +
 * the established pattern in `tests/integration/reflection/threshold-policy.test.ts`.
 * Placed here; documented in commit body as plan deviation.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T2.2 (ADR D14)
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md § D14
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import { PgHalfLifePersister } from '../../../src/local/eviction/pg-half-life-persister.js';
import {
  TriadicScoringPolicy,
  DEFAULT_TRIADIC_CONSTANTS,
  computeHalfLifeSeconds,
} from '../../../src/local/eviction/triadic-scoring-policy.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T2.2 lazy half-life backfill (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T2.2 lazy half_life_seconds backfill (D14 + EC-1)', () => {
    let pool: pg.Pool;
    let persister: PgHalfLifePersister;
    let policy: TriadicScoringPolicy;

    const TEST_EMBEDDING = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);
    const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t2-2';
    const NOW = new Date('2026-05-30T12:00:00Z');

    async function seedMemory(opts: {
      llmImportanceScore: number | null;
      halfLifeSeconds: number | null;
      lastAccessedAt: Date | null;
      accessCount: number;
    }): Promise<string> {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
            text, hash, embedding, payload, agent_id,
            llm_importance_score, half_life_seconds, last_accessed_at, access_count
         ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          'lazy backfill seed',
          `h-${Math.random().toString(36).slice(2)}`,
          `[${TEST_EMBEDDING.join(',')}]`,
          {},
          TEST_AGENT_ID,
          opts.llmImportanceScore,
          opts.halfLifeSeconds,
          opts.lastAccessedAt,
          opts.accessCount,
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) {
        throw new Error('Seed insert returned no row');
      }
      return id;
    }

    async function getHalfLife(memoryId: string): Promise<number | null> {
      const result = await pool.query<{ half_life_seconds: number | null }>(
        `SELECT half_life_seconds FROM memories WHERE id = $1`,
        [memoryId],
      );
      return result.rows[0]?.half_life_seconds ?? null;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      persister = new PgHalfLifePersister(pool);
      policy = new TriadicScoringPolicy({ halfLifePersister: persister });
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    });

    test('lazy backfill persists half_life on first score (D14)', async () => {
      const importance = 0.8;
      const id = await seedMemory({
        llmImportanceScore: importance,
        halfLifeSeconds: null,
        lastAccessedAt: new Date(NOW.getTime() - 60_000),
        accessCount: 1,
      });

      const before = await getHalfLife(id);
      expect(before).toBeNull();

      const memory = await loadMemoryItem(pool, id);
      await policy.score(memory, { meanIsolationDistance: 0, now: NOW });

      const after = await getHalfLife(id);
      const expected = computeHalfLifeSeconds(importance, DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds);
      expect(after).toBe(expected);
    });

    test('lazy backfill idempotent: no double UPDATE on second score', async () => {
      const id = await seedMemory({
        llmImportanceScore: 0.7,
        halfLifeSeconds: null,
        lastAccessedAt: new Date(NOW.getTime() - 60_000),
        accessCount: 1,
      });

      const memory = await loadMemoryItem(pool, id);
      const ctx = { meanIsolationDistance: 0, now: NOW };

      await policy.score(memory, ctx);
      const persistedFirst = await getHalfLife(id);
      expect(persistedFirst).not.toBeNull();

      // Re-load with the now-persisted half_life; second score must NOT issue UPDATE.
      const memoryReloaded = await loadMemoryItem(pool, id);
      const updateCountBefore = await getUpdateCount(pool, id);
      await policy.score(memoryReloaded, ctx);
      const updateCountAfter = await getUpdateCount(pool, id);

      expect(updateCountAfter).toBe(updateCountBefore);
    });

    test('EC-1: importance UPDATE resets half_life via Postgres trigger', async () => {
      const id = await seedMemory({
        llmImportanceScore: 0.5,
        halfLifeSeconds: null,
        lastAccessedAt: new Date(NOW.getTime() - 60_000),
        accessCount: 1,
      });

      // First score backfills half_life from importance=0.5
      const memoryFirst = await loadMemoryItem(pool, id);
      await policy.score(memoryFirst, { meanIsolationDistance: 0, now: NOW });
      const persistedAtImp05 = await getHalfLife(id);
      expect(persistedAtImp05).toBe(
        computeHalfLifeSeconds(0.5, DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds),
      );

      // UPDATE the importance — trigger MUST reset half_life_seconds to NULL
      await pool.query(
        `UPDATE memories SET llm_importance_score = $1 WHERE id = $2`,
        [0.9, id],
      );
      const afterTrigger = await getHalfLife(id);
      expect(afterTrigger).toBeNull();

      // Next score re-backfills from the new importance
      const memorySecond = await loadMemoryItem(pool, id);
      await policy.score(memorySecond, { meanIsolationDistance: 0, now: NOW });
      const persistedAtImp09 = await getHalfLife(id);
      expect(persistedAtImp09).toBe(
        computeHalfLifeSeconds(0.9, DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds),
      );
    });
  });
}

async function loadMemoryItem(
  pool: pg.Pool,
  id: string,
): Promise<import('../../../src/core/memory-item.js').MemoryItem> {
  const result = await pool.query<{
    id: string;
    text: string;
    hash: string;
    user_id: string | null;
    session_id: string | null;
    agent_id: string | null;
    payload: Record<string, string | number | boolean | null>;
    t_valid: Date | null;
    t_invalid: Date | null;
    created_at: Date;
    updated_at: Date;
    last_accessed_at: Date | null;
    access_count: number;
    half_life_seconds: number | null;
    llm_importance_score: number | null;
  }>(
    `SELECT id, text, hash, user_id, session_id, agent_id, payload,
            t_valid, t_invalid, created_at, updated_at,
            last_accessed_at, access_count, half_life_seconds, llm_importance_score
       FROM memories WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Memory ${id} not found`);
  }
  return {
    id: row.id,
    text: row.text,
    hash: row.hash,
    scope: row.agent_id !== null
      ? { kind: 'agent' as const, agentId: row.agent_id }
      : { kind: 'user' as const, userId: row.user_id ?? '' },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.payload,
    tValid: row.t_valid,
    tInvalid: row.t_invalid,
    llmImportanceScore: row.llm_importance_score,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    halfLifeSeconds: row.half_life_seconds,
  };
}

async function getUpdateCount(pool: pg.Pool, memoryId: string): Promise<string> {
  // Track via ctid: physical row pointer. UPDATE moves the row to a new ctid
  // under MVCC, so two ctids being equal across two calls proves no UPDATE
  // happened. More precise than xmin (which loses precision when cast to
  // Number on long-running DBs).
  const result = await pool.query<{ ctid: string }>(
    `SELECT ctid::text AS ctid FROM memories WHERE id = $1`,
    [memoryId],
  );
  return result.rows[0]?.ctid ?? '';
}
