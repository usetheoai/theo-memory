import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CapacityBasedTrigger } from '../../../src/local/eviction/capacity-based-trigger.js';
import { TimeBasedTrigger } from '../../../src/local/eviction/time-based-trigger.js';
import { PgEvictor } from '../../../src/local/eviction/pg-evictor.js';
import { PgNearestNeighborProvider } from '../../../src/local/eviction/pg-nearest-neighbor-provider.js';
import { TriadicScoringPolicy } from '../../../src/local/eviction/triadic-scoring-policy.js';
import type { Scope } from '../../../src/core/scope.js';

/**
 * T3.1 multi-tier eviction integration test (closes F-dom-1 + F-dom-pg-3
 * CRITICAL + F-arch-4 + F-dom-4 MAJOR per ADR D3).
 *
 * Asserts the v0.4b eviction pipeline (CapacityBasedTrigger, TimeBasedTrigger,
 * PgNearestNeighborProvider, long-tail multiplier) honors all 3 scope tiers
 * declared by ADR-0002: `kind: 'user'` / `kind: 'session'` / `kind: 'agent'`.
 * Prior to T3.1, every WHERE clause was `agent_id = $1`, silently restricting
 * eviction to AgentScope rows.
 *
 * Migration 0005 ships per-tier partial indexes
 * `idx_memories_eviction_score_user (user_id, last_accessed_at)` and
 * `idx_memories_eviction_score_session (session_id, last_accessed_at)` so the
 * triggers' generalized queries stay performant against active rows.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T3.1
 * @see .claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md § F-dom-1, F-dom-pg-3, F-arch-4, F-dom-4
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const NOW = new Date('2026-05-31T12:00:00.000Z');

const TEST_USER_ID = 'multi-tier-test-user';
const TEST_SESSION_ID = 'multi-tier-test-session';
const TEST_AGENT_ID = 'multi-tier-test-agent';
const EMBED_DIM = 1536;

function makeEmbedding(seed: number): readonly number[] {
  const v = Array.from({ length: EMBED_DIM }, () => 0);
  v[seed % EMBED_DIM] = 1;
  return v;
}

interface SeedRow {
  readonly text: string;
  readonly hash: string;
  readonly embedding: readonly number[];
  readonly userId?: string | null;
  readonly sessionId?: string | null;
  readonly agentId?: string | null;
  readonly lastAccessedAt: Date;
  readonly accessCount?: number;
  readonly llmImportanceScore?: number;
}

async function seed(pool: pg.Pool, row: SeedRow): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO memories (
       text, hash, embedding, payload, user_id, session_id, agent_id,
       last_accessed_at, access_count, llm_importance_score
     ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      row.text,
      row.hash,
      `[${row.embedding.join(',')}]`,
      {},
      row.userId ?? null,
      row.sessionId ?? null,
      row.agentId ?? null,
      row.lastAccessedAt,
      row.accessCount ?? 0,
      row.llmImportanceScore ?? 0.5,
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error('seed: INSERT returned no row');
  }
  return id;
}

async function resetTestRows(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM memories
       WHERE user_id = $1 OR session_id = $2 OR agent_id = $3`,
    [TEST_USER_ID, TEST_SESSION_ID, TEST_AGENT_ID],
  );
}

describe.skipIf(PG_URI === '')(
  'T3.1: scope-tier generalization (F-dom-1 + F-dom-pg-3 + F-arch-4 + F-dom-4)',
  () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await resetTestRows(pool);
      await pool.end();
    });

    beforeEach(async () => {
      await resetTestRows(pool);
    });

    it('CapacityBasedTrigger evicts the User tier (F-dom-1)', async () => {
      // Given: 6 user-scoped memories with the cap at 4
      for (let i = 0; i < 6; i++) {
        await seed(pool, {
          text: `user-mem-${i}`,
          hash: `hash-user-${i}`,
          embedding: makeEmbedding(i),
          userId: TEST_USER_ID,
          lastAccessedAt: new Date(NOW.getTime() - i * 1000),
        });
      }
      const policy = new TriadicScoringPolicy({ evictor: new PgEvictor(pool) });
      const trigger = new CapacityBasedTrigger(pool, policy, 4);
      const userScope: Scope = { kind: 'user', userId: TEST_USER_ID };

      // When: the trigger fires on the user scope
      const result = await trigger.fire(userScope, NOW);

      // Then: at least one victim was soft-deleted; the remaining count <= cap
      expect(result?.softDeleted.length ?? 0).toBeGreaterThan(0);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM memories
          WHERE user_id = $1 AND t_invalid IS NULL`,
        [TEST_USER_ID],
      );
      expect(Number(rows[0]?.count ?? '0')).toBeLessThanOrEqual(4);
    });

    it('CapacityBasedTrigger evicts the Session tier (F-dom-1)', async () => {
      for (let i = 0; i < 6; i++) {
        await seed(pool, {
          text: `session-mem-${i}`,
          hash: `hash-session-${i}`,
          embedding: makeEmbedding(i),
          sessionId: TEST_SESSION_ID,
          lastAccessedAt: new Date(NOW.getTime() - i * 1000),
        });
      }
      const policy = new TriadicScoringPolicy({ evictor: new PgEvictor(pool) });
      const trigger = new CapacityBasedTrigger(pool, policy, 4);
      const sessionScope: Scope = { kind: 'session', sessionId: TEST_SESSION_ID };

      const result = await trigger.fire(sessionScope, NOW);

      expect(result?.softDeleted.length ?? 0).toBeGreaterThan(0);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM memories
          WHERE session_id = $1 AND t_invalid IS NULL`,
        [TEST_SESSION_ID],
      );
      expect(Number(rows[0]?.count ?? '0')).toBeLessThanOrEqual(4);
    });

    it('TimeBasedTrigger evicts the User tier (F-dom-1)', async () => {
      for (let i = 0; i < 4; i++) {
        await seed(pool, {
          text: `time-user-mem-${i}`,
          hash: `hash-time-user-${i}`,
          embedding: makeEmbedding(100 + i),
          userId: TEST_USER_ID,
          lastAccessedAt: new Date(NOW.getTime() - (i + 1) * 1000),
        });
      }
      const policy = new TriadicScoringPolicy({ evictor: new PgEvictor(pool) });
      const userScope: Scope = { kind: 'user', userId: TEST_USER_ID };
      const trigger = new TimeBasedTrigger(pool, policy, {
        cronExpression: '0 0 * * *', // arbitrary; we drive tickNow directly
        evictionFraction: 0.5,
        scope: userScope,
      });

      const result = await trigger.tickNow(NOW);

      expect(result?.softDeleted.length ?? 0).toBeGreaterThan(0);
    });

    it('PgNearestNeighborProvider returns User-tier distance (F-dom-pg-3)', async () => {
      const idA = await seed(pool, {
        text: 'user-A',
        hash: 'hash-user-A',
        embedding: makeEmbedding(10),
        userId: TEST_USER_ID,
        lastAccessedAt: NOW,
      });
      await seed(pool, {
        text: 'user-B',
        hash: 'hash-user-B',
        embedding: makeEmbedding(11),
        userId: TEST_USER_ID,
        lastAccessedAt: NOW,
      });

      const provider = new PgNearestNeighborProvider(pool);
      const userScope: Scope = { kind: 'user', userId: TEST_USER_ID };
      const distance = await provider.distance(idA, userScope);

      // distance ∈ [0, 1] for cosine on near-orthogonal one-hot vectors
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(1);
    });

    it('Long-tail multiplier protects an isolated User-scope memory (F-dom-5; bridges to T7.2)', async () => {
      const idIsolated = await seed(pool, {
        text: 'isolated-user',
        hash: 'hash-isolated-user',
        embedding: makeEmbedding(900),
        userId: TEST_USER_ID,
        lastAccessedAt: new Date(NOW.getTime() - 10_000),
        accessCount: 0,
        llmImportanceScore: 0.5,
      });
      for (let i = 0; i < 5; i++) {
        await seed(pool, {
          text: `clustered-${i}`,
          hash: `hash-clustered-${i}`,
          embedding: makeEmbedding(100), // identical-ish cluster
          userId: TEST_USER_ID,
          lastAccessedAt: new Date(NOW.getTime() - 10_000),
          accessCount: 0,
          llmImportanceScore: 0.5,
        });
      }
      const policy = new TriadicScoringPolicy({
        evictor: new PgEvictor(pool),
        neighborProvider: new PgNearestNeighborProvider(pool),
      });
      const trigger = new CapacityBasedTrigger(pool, policy, 4);
      const userScope: Scope = { kind: 'user', userId: TEST_USER_ID };

      const result = await trigger.fire(userScope, NOW);

      // The isolated memory should NOT be in the victim list (multiplier
      // boosted its score above the cluster's).
      expect(result?.softDeleted ?? []).not.toContain(idIsolated);
    });
  },
);
