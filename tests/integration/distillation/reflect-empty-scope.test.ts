import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import {
  createLocalMemory,
  PgvectorStore,
  StubEmbedder,
  StubLLM,
  LlmJudgedMergeConflictPolicy,

} from '../../../src/local/index.js';
import type { LLM, LLMResponse, Message } from '../../../src/core/dip/llm.js';

/**
 * T2.1 / EC-7 — `reflect({ conflictResolution })` with empty scope
 * (recall returns 0 memories) gracefully no-ops:
 *   - 0 LLM calls on the policy's LLM (the policy is never reached)
 *   - 0 rows inserted into `consolidation_history`
 *   - no exceptions
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T2.1 + EC-7
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

describe.skipIf(PG_URI === '')(
  'T2.1 / EC-7: reflect({ conflictResolution }) on empty scope is a graceful no-op',
  () => {
    let pool: pg.Pool;
    const TEST_USER = 't2-1-empty-scope-user';

    async function reset(): Promise<void> {
      await pool.query(
        `DELETE FROM consolidation_history WHERE policy_name = 'llm-judged-merge'`,
      );
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER]);
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

    it('empty scope short-circuits — 0 LLM calls, 0 audit rows, no exceptions', async () => {
      const generateResponseSpy = vi.fn().mockResolvedValue({
        kept_id: '',
        rejected_ids: [],
        reason: '',
      });
      const stubLlm: LLM = {
        generateResponse: generateResponseSpy,
        async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
          return Promise.resolve({ role: 'assistant', content: '' });
        },
      };
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
        reflectionPolicy: { kind: 'manual' },
      });
      // No memories seeded for TEST_USER — scope is empty.

      const result = await memory
        .user(TEST_USER)
        .reflect({
          conflictResolution: new LlmJudgedMergeConflictPolicy({ llm: stubLlm }),
        });

      // Reflect early-returns with reason='no-source-memories' (existing v0.4a EC-5).
      expect(result.derivedMemoriesCreated).toBe(0);
      expect(generateResponseSpy).not.toHaveBeenCalled();

      const { rows: auditRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM consolidation_history WHERE policy_name = 'llm-judged-merge'`,
      );
      expect(auditRows[0]?.count).toBe('0');

      await memory.dispose();
    });
  },
);
