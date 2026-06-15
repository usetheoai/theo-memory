import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  createLocalMemory,
  PgvectorStore,
  StubEmbedder,
  LastWriteWinsConflictPolicy,
} from '@usetheo/memory';
import type { LLM, LLMResponse, Message } from '@usetheo/memory';

const emptyJsonLlm: LLM = {
  async generateResponse(_messages: readonly Message[]): Promise<unknown> {
    return Promise.resolve([]);
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ role: 'assistant', content: '[]' });
  },
};

/**
 * T2.1 — wiring `Memory.reflect({ conflictResolution })` end-to-end:
 * given 2 contradictory memories in the same scope and a
 * `LastWriteWinsConflictPolicy`, after reflect():
 *   (a) the older memory has `t_invalid IS NOT NULL` (soft-deleted)
 *   (b) `consolidation_history` has one row with verbatim `reason`,
 *       `policy_name = 'last-write-wins'`, and `kept_memory_id` pointing
 *       to the newer row.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T2.1 + ADR D2 + EC-1
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

describe.skipIf(PG_URI === '')(
  'T2.1: Memory.reflect({ conflictResolution }) wires LWW into reflect() pipeline',
  () => {
    let pool: pg.Pool;
    const TEST_USER = 't2-1-policy-user';

    async function reset(): Promise<void> {
      await pool.query(
        `DELETE FROM consolidation_history WHERE policy_name = 'last-write-wins'`,
      );
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER]);
    }

    async function seed(text: string, createdOffsetMs: number): Promise<string> {
      const embedding = Array.from({ length: 1536 }, () => 0);
      embedding[0] = 1;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload, user_id, created_at,
           last_accessed_at, access_count, llm_importance_score
         ) VALUES ($1, $2, $3::vector, $4, $5, NOW() + ($6 || ' milliseconds')::interval,
                   NOW(), 0, 0.5)
         RETURNING id`,
        [
          text,
          `t2-1-hash-${String(Date.now())}-${String(Math.random())}`,
          `[${embedding.join(',')}]`,
          { text, user_id: TEST_USER },
          TEST_USER,
          String(createdOffsetMs),
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('seed: no row');
      return id;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await reset();
      await pool.end();
    });

    beforeEach(async () => {
      await reset();
    });

    it('LWW policy soft-deletes the older memory + writes consolidation_history row', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: emptyJsonLlm,
        reflectionPolicy: { kind: 'manual' },
      });
      const idOlder = await seed('older fact', -5_000);
      const idNewer = await seed('newer fact', +5_000);

      const result = await memory
        .user(TEST_USER)
        .reflect({ conflictResolution: new LastWriteWinsConflictPolicy() });

      // The reflection LLM (StubLLM) returns no drafts → reason='no-consolidation';
      // but consolidation still ran via T2.1 wire.
      expect(result.derivedMemoriesCreated).toBe(0);

      // (a) the older memory was soft-deleted
      const { rows: memRows } = await pool.query<{ id: string; t_invalid: Date | null }>(
        `SELECT id, t_invalid FROM memories WHERE user_id = $1 ORDER BY created_at ASC`,
        [TEST_USER],
      );
      expect(memRows).toHaveLength(2);
      expect(memRows[0]?.id).toBe(idOlder);
      expect(memRows[0]?.t_invalid).not.toBeNull();
      expect(memRows[1]?.id).toBe(idNewer);
      expect(memRows[1]?.t_invalid).toBeNull();

      // (b) consolidation_history row
      const { rows: auditRows } = await pool.query<{
        kept_memory_id: string;
        rejected_memory_ids: string[];
        reason: string;
        policy_name: string;
      }>(
        `SELECT kept_memory_id, rejected_memory_ids, reason, policy_name
           FROM consolidation_history WHERE policy_name = 'last-write-wins'`,
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.kept_memory_id).toBe(idNewer);
      expect(auditRows[0]?.rejected_memory_ids).toEqual([idOlder]);
      expect(auditRows[0]?.reason).toBe('last-write-wins');

      await memory.dispose();
    });
  },
);
