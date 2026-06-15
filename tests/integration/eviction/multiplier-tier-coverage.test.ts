import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CapacityBasedTrigger } from '@usetheo/memory';
import { PgEvictor } from '@usetheo/memory';
import { PgNearestNeighborProvider } from '@usetheo/memory';
import { TriadicScoringPolicy } from '@usetheo/memory';
import type { Scope } from '@usetheo/memory';

/**
 * T7.2 — long-tail multiplier honors User + Session scope tiers (closes
 * F-dom-5 MAJOR). Prior to T3.1, `getNeighborScopeId` returned null for
 * UserScope and SessionScope, short-circuiting the multiplier to 1.0 (no
 * isolation-based protection). T3.1 generalized the function across all 4
 * tiers; T7.2 locks the end-to-end behavior — a rare-isolated User-scope
 * memory survives eviction even when its base score is tied with a
 * clustered sibling, mirroring the Agent-tier guarantee that v0.4b T7.1
 * GOAL TEST proved.
 *
 * Test seeds 1 isolated memory + 5 clustered siblings in the same scope;
 * caps the scope at 4; expects the isolated memory to NOT appear in the
 * victim list (multiplier × base_score elevated its rank above the
 * clustered cluster).
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T7.2
 * @see .claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md § F-dom-5
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const NOW = new Date('2026-05-31T12:00:00.000Z');
const EMBED_DIM = 1536;
const CAP = 4;

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
  if (id === undefined) throw new Error('seed: no row');
  return id;
}

describe.skipIf(PG_URI === '')(
  'T7.2 — long-tail multiplier honors User + Session scope tiers (F-dom-5)',
  () => {
    let pool: pg.Pool;
    const TEST_USER = 't7-2-multiplier-user';
    const TEST_SESSION = 't7-2-multiplier-session';

    async function resetTestRows(): Promise<void> {
      await pool.query(
        `DELETE FROM memories WHERE user_id = $1 OR session_id = $2`,
        [TEST_USER, TEST_SESSION],
      );
    }

    async function seedClusterWithIsolated(
      scopeColumn: 'user_id' | 'session_id',
      scopeValue: string,
    ): Promise<string> {
      const isolatedRow: SeedRow = {
        text: 'isolated',
        hash: `t7-2-isolated-${scopeColumn}-${Date.now()}`,
        embedding: makeEmbedding(900),
        lastAccessedAt: new Date(NOW.getTime() - 10_000),
        accessCount: 0,
        llmImportanceScore: 0.5,
      };
      const isolatedSeed: SeedRow =
        scopeColumn === 'user_id'
          ? { ...isolatedRow, userId: scopeValue }
          : { ...isolatedRow, sessionId: scopeValue };
      const isolatedId = await seed(pool, isolatedSeed);
      // 5 clustered siblings on the same one-hot index (cosine distance ≈ 0)
      for (let i = 0; i < 5; i++) {
        const baseRow: SeedRow = {
          text: `clustered-${i}`,
          hash: `t7-2-clustered-${scopeColumn}-${i}-${Date.now()}`,
          embedding: makeEmbedding(100),
          lastAccessedAt: new Date(NOW.getTime() - 10_000),
          accessCount: 0,
          llmImportanceScore: 0.5,
        };
        const clusteredSeed: SeedRow =
          scopeColumn === 'user_id'
            ? { ...baseRow, userId: scopeValue }
            : { ...baseRow, sessionId: scopeValue };
        await seed(pool, clusteredSeed);
      }
      return isolatedId;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await resetTestRows();
      await pool.end();
    });

    beforeEach(async () => {
      await resetTestRows();
    });

    it('long-tail multiplier protects an isolated User-scope memory (F-dom-5)', async () => {
      const isolatedId = await seedClusterWithIsolated('user_id', TEST_USER);
      const policy = new TriadicScoringPolicy({
        evictor: new PgEvictor(pool),
        neighborProvider: new PgNearestNeighborProvider(pool),
      });
      const trigger = new CapacityBasedTrigger(pool, policy, CAP);
      const userScope: Scope = { kind: 'user', userId: TEST_USER };

      const result = await trigger.fire(userScope, NOW);

      expect(result?.softDeleted ?? []).not.toContain(isolatedId);
    });

    it('long-tail multiplier protects an isolated Session-scope memory (F-dom-5)', async () => {
      const isolatedId = await seedClusterWithIsolated('session_id', TEST_SESSION);
      const policy = new TriadicScoringPolicy({
        evictor: new PgEvictor(pool),
        neighborProvider: new PgNearestNeighborProvider(pool),
      });
      const trigger = new CapacityBasedTrigger(pool, policy, CAP);
      const sessionScope: Scope = { kind: 'session', sessionId: TEST_SESSION };

      const result = await trigger.fire(sessionScope, NOW);

      expect(result?.softDeleted ?? []).not.toContain(isolatedId);
    });
  },
);
