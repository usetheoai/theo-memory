/**
 * Consumer-level regression for the Claude Code kit attribution bug — the test that
 * would have caught it WITHOUT waiting for dogfood.
 *
 * The bug: the Claude Code Stop hook (theo-remember.mjs) writes the assistant's turn
 * with `attributedTo:'assistant'` AND relies on LLM extraction (infer:true). The
 * extraction path ignored the request-level `attributedTo` and let the LLM's
 * content-inferred per-fact `attributed_to` guess win — so assistant summaries were
 * stored with `attributed_to='user'`, polluting the user's stated preferences.
 *
 * The pre-existing suite missed it because every attribution test was on ONE side of
 * the seam: the v1.1 integration test only ever used `infer:false`; the LLM-emit unit
 * tests never passed `attributedTo`; the store test received a ready-made payload.
 * NONE exercised `remember(text, {attributedTo}) + infer:true` against a real store.
 * This test closes that exact seam at the layer the real consumer uses.
 *
 * Skipped when THEOMEM_PG_URI is unset (CI without docker passes).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const USER = 'kit-attr-write-test';

// Constant unit vector — cosine identity; semantic relevance is not what this measures.
const UNIT: readonly number[] = (() => {
  const v = new Array<number>(1536).fill(0);
  v[0] = 1;
  return v;
})();
const ConstantEmbedder: Embedder = {
  embed: async () => UNIT,
  embedBatch: async (texts: readonly string[]) => texts.map(() => UNIT),
};

/**
 * LLM stub that EXTRACTS one fact and (like a real LLM reading assistant prose)
 * GUESSES the perspective owner is `user` — the exact content-inferred value that
 * clobbered the request-level 'assistant' before the fix.
 */
function llmGuessingUser(factText: string): LLM {
  return {
    generateResponse: async () => ({ memory: [{ id: '1', text: factText, attributed_to: 'user' }] }),
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  } as unknown as LLM;
}

describe.skipIf(PG_URI === '')(
  'claude-code-kit attribution — extraction path honours request-level attributedTo (real pgvector)',
  () => {
    let pool: pg.Pool;

    async function makeMemory(llm: LLM): Promise<Awaited<ReturnType<typeof createLocalMemory>>> {
      const vectorStore = new PgvectorStore(pool);
      await vectorStore.initialize();
      return createLocalMemory({ vectorStore, embedder: ConstantEmbedder, llm });
    }
    async function storedAttribution(): Promise<(string | null)[]> {
      const { rows } = await pool.query<{ attributed_to: string | null }>(
        `SELECT attributed_to FROM memories WHERE user_id = $1 AND t_invalid IS NULL ORDER BY created_at`,
        [USER],
      );
      return rows.map((r) => r.attributed_to);
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await runMigrations(pool);
      await pool.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS attributed_to text`);
    }, 30_000);

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [USER]);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [USER]);
      await pool.end();
    });

    test('the exact dogfood scenario: assistant turn + LLM guesses user → stored attributed_to is assistant (origin wins)', async () => {
      // Mirrors theo-remember.mjs: an assistant summary, extracted (infer:true), attributed to the hook ORIGIN.
      const memory = await makeMemory(llmGuessingUser('Migrated the auth module to JWT tokens'));
      const items = await memory
        .user(USER)
        .remember('I migrated the auth module to JWT tokens.', { attributedTo: 'assistant' });
      expect(items.length).toBeGreaterThanOrEqual(1);

      // Ground truth = the DB column (how the bug was actually found).
      const attrs = await storedAttribution();
      expect(attrs.length).toBeGreaterThanOrEqual(1);
      expect(attrs.every((a) => a === 'assistant')).toBe(true); // NOT 'user'
      expect(attrs).not.toContain('user');
    }, 30_000);

    test('recall filter agrees: the extracted fact is retrievable as an assistant-attributed memory, not a user one', async () => {
      const memory = await makeMemory(llmGuessingUser('User prefers dark mode'));
      await memory.user(USER).remember('The user said they prefer dark mode.', { attributedTo: 'assistant' });

      const asAssistant = await memory.user(USER).recall('dark mode', { attributedTo: 'assistant', threshold: 0 });
      expect(asAssistant.length).toBeGreaterThanOrEqual(1);
      const asUser = await memory.user(USER).recall('dark mode', { attributedTo: 'user', threshold: 0 });
      expect(asUser.length).toBe(0); // the assistant summary never masquerades as a user preference
    }, 30_000);
  },
);
