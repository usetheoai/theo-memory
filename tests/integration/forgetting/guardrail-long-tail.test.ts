/**
 * T7.2 — Guardrail unit test (long-tail preservation contract).
 *
 * CLAUDE.md § Macro roadmap Item 6 acceptance second half (verbatim):
 *   "Guardrail unit test: a rare-but-isolated memory survives ≥ 5 consecutive
 *    LRU eviction passes against frequent siblings."
 *
 * Seeds 1 rare-isolated memory + 100 frequent-cluster siblings, then drives
 * 5 consecutive `CapacityBasedTrigger` passes (cap = 70). Between passes,
 * 31 NEW frequent siblings are inserted to keep the scope above cap so the
 * trigger fires every time (the "wave of frequent writes" metaphor in plan
 * T7.2 § Deep Dives). The rare row's `t_invalid` must remain NULL after all
 * 5 passes — the long-tail multiplier MUST protect it across the eviction
 * lifecycle.
 *
 * Plan T7.2 § Files to edit declares the test at
 * `src/local/eviction/__tests__/guardrail-long-tail.test.ts` (UNIT tier with
 * `InMemoryVectorStore` adapter). ADR D18 fallback (plan v1.1 EC-3 absorption)
 * promotes to INTEGRATION tier if InMemoryVectorStore lacks cosine-distance
 * nearest-neighbor support. PgNearestNeighborProvider exists and is the
 * canonical impl; promoting here keeps the test honest. Placed at
 * tests/integration/forgetting/guardrail-long-tail.test.ts per the
 * established T2.2 / T3.1 / T4.x / T5.x / T6.1 / T7.1 pattern.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T7.2 (D18 + EC-3 fallback)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import { CapacityBasedTrigger } from '../../../src/local/eviction/capacity-based-trigger.js';
import { PgEvictor } from '../../../src/local/eviction/pg-evictor.js';
import { PgNearestNeighborProvider } from '../../../src/local/eviction/pg-nearest-neighbor-provider.js';
import { TriadicScoringPolicy } from '../../../src/local/eviction/triadic-scoring-policy.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t7-2-guardrail';
const TARGET_CAP = 70;
const INITIAL_FREQUENT = 100;
const REFILL_PER_PASS = 31;
const NUMBER_OF_PASSES = 5;

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T7.2 long-tail guardrail (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T7.2 GUARDRAIL — rare-isolated survives ≥ 5 consecutive LRU passes', () => {
    let pool: pg.Pool;
    let policy: TriadicScoringPolicy;
    let trigger: CapacityBasedTrigger;

    function rareVector(): readonly number[] {
      const v = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0);
      v[500] = 1;
      return v;
    }

    function frequentVector(perturbIndex: number): readonly number[] {
      const v = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0);
      v[0] = 1;
      v[1 + (perturbIndex % 30)] = 0.1;
      return v;
    }

    async function seedRare(): Promise<string> {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
            text, hash, embedding, payload, agent_id,
            llm_importance_score, access_count, last_accessed_at
         ) VALUES ($1, $2, $3::vector, $4, $5, 0.5, 0, NULL)
         RETURNING id`,
        [
          'rare-isolated',
          `h-t7-2-rare-${Math.random().toString(36).slice(2)}`,
          `[${rareVector().join(',')}]`,
          {},
          TEST_AGENT_ID,
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('Rare seed failed');
      return id;
    }

    async function seedFrequent(count: number, suffix: string): Promise<void> {
      for (let i = 0; i < count; i++) {
        await pool.query(
          `INSERT INTO memories (
              text, hash, embedding, payload, agent_id,
              llm_importance_score, access_count, last_accessed_at
           ) VALUES ($1, $2, $3::vector, $4, $5, 0.5, 0, NULL)`,
          [
            `frequent-${suffix}-${i}`,
            `h-t7-2-freq-${suffix}-${i}-${Math.random().toString(36).slice(2)}`,
            `[${frequentVector(i).join(',')}]`,
            {},
            TEST_AGENT_ID,
          ],
        );
      }
    }

    async function isRareSurviving(rareId: string): Promise<boolean> {
      const result = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [rareId],
      );
      return result.rows[0]?.t_invalid === null;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      const neighborProvider = new PgNearestNeighborProvider(pool);
      const evictor = new PgEvictor(pool);
      policy = new TriadicScoringPolicy(undefined, undefined, null, neighborProvider, evictor);
      trigger = new CapacityBasedTrigger(pool, policy, TARGET_CAP);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    });

    test(
      'rare-isolated memory survives 5 consecutive CapacityBasedTrigger passes',
      async () => {
        const rareId = await seedRare();
        await seedFrequent(INITIAL_FREQUENT, 'initial');

        for (let pass = 1; pass <= NUMBER_OF_PASSES; pass++) {
          const result = await trigger.fire(TEST_AGENT_ID, new Date());
          expect(result).not.toBeNull();
          // Rare must NEVER be in the evicted set.
          expect(result?.softDeleted ?? []).not.toContain(rareId);

          // After each pass, verify rare is still active.
          const surviving = await isRareSurviving(rareId);
          expect(surviving).toBe(true);

          // Refill: add 31 fresh frequent rows to push count above cap for next pass.
          if (pass < NUMBER_OF_PASSES) {
            await seedFrequent(REFILL_PER_PASS, `refill-${pass}`);
          }
        }

        // Final assertion: rare row's t_invalid is still NULL after all 5 passes.
        const finalSurviving = await isRareSurviving(rareId);
        expect(finalSurviving).toBe(true);
      },
      60_000,
    );
  });
}
