/**
 * T6.1 — THE GOAL TEST per plan v0-4a-reflection-pipeline.
 *
 * CLAUDE.md § Macro roadmap Item 5 acceptance verbatim:
 *   "Test: seed 50 memories in a scope; trigger reflect(); assert ≥ 1
 *    higher-order memory exists with derived_from: string[] provenance
 *    linking source memory IDs."
 *
 * Pattern: real ankane/pgvector:v0.5.1 via env-gated THEOMEM_PG_URI;
 * ThresholdReflectionPolicy(threshold=50); mocked LLM returns canned drafts
 * for determinism.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T6.1
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import type { Embedder } from '../../../src/core/dip/embedder.js';
import type { LLM } from '../../../src/core/dip/llm.js';
import type { LLMResponse, Message } from '../../../src/core/message.js';
import { createLocalMemory } from '../../../src/local/index.js';
import { PgvectorStore } from '../../../src/local/pgvector-store.js';
import { ThresholdReflectionPolicy } from '../../../src/local/reflection/threshold-reflection-policy.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('THE GOAL TEST T6.1 — threshold reflection (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('THE GOAL TEST T6.1 — 50 memories → reflect() → ≥ 1 derived', () => {
    let pool: pg.Pool;
    let store: PgvectorStore;

    function stubEmbedder(): Embedder {
      const probeVec = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);
      return {
        async embed(_text: string) {
          return Promise.resolve(probeVec);
        },
        async embedBatch(texts: readonly string[]) {
          return Promise.resolve(texts.map(() => probeVec));
        },
      };
    }

    function stubLLM(): { llm: LLM; reflectCallCount: () => number } {
      let reflectCalls = 0;
      const llm: LLM = {
        async generateResponse() {
          return Promise.resolve('unused');
        },
        async generateChat(messages: readonly Message[]): Promise<LLMResponse> {
          const last = messages[messages.length - 1];
          const content = (last?.content ?? '').toLowerCase();
          if (content.includes('reflection helper') || messages[0]?.content?.toLowerCase().includes('reflection helper')) {
            reflectCalls++;
            // Return one derived draft referencing the first 3 source IDs from the prompt
            const ids = [...messages[0]?.content?.matchAll(/id="([^"]+)"/g) ?? []]
              .slice(0, 3)
              .map((m) => m[1] ?? '');
            return Promise.resolve({
              content: JSON.stringify([
                { text: 'Alice has consistent preferences', derived_from: ids },
              ]),
              role: 'assistant',
            });
          }
          // Extraction prompt: return empty
          return Promise.resolve({ content: '{"facts": []}', role: 'assistant' });
        },
      };
      return { llm, reflectCallCount: () => reflectCalls };
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      store = new PgvectorStore({ connectionString: PG_URI });
      await store.initialize();
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE memories, reflection_counters RESTART IDENTITY CASCADE`);
    });

    test(
      'produces ≥ 1 higher-order memory with derived_from after 50-memory threshold',
      { timeout: 60000 },
      async () => {
        const { llm, reflectCallCount } = stubLLM();
        const memory = await createLocalMemory({
          vectorStore: store,
          embedder: stubEmbedder(),
          llm,
          reflectionPolicy: new ThresholdReflectionPolicy({ threshold: 50, store }),
        });

        // Seed 50 distinct memories directly via the store (bypass extraction
        // pipeline since the goal is reflect() observability, not extraction)
        const scope = { kind: 'user' as const, userId: 'alice' };
        const ids: string[] = [];
        const probeVec = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);
        for (let i = 0; i < 49; i++) {
          const id = `seed-${String(i)}`;
          ids.push(id);
          await store.insert(
            [probeVec],
            [id],
            [{ text: `Fact ${String(i)}: Alice likes thing-${String(i)}`, hash: `hash-${String(i)}`, user_id: 'alice' }],
          );
        }

        // Now trigger threshold via 50th remember() — calls shouldReflect → bump → 50 % 50 === 0 → fire
        // To bypass extraction (which would need an LLM extraction prompt), invoke reflect directly
        // OR trigger via the policy explicitly:
        await store.insert(
          [probeVec],
          ['seed-49'],
          [{ text: 'Fact 49: Alice likes thing-49', hash: 'hash-49', user_id: 'alice' }],
        );

        // Explicitly trigger reflect (simulates what auto-fire would do)
        await memory.user('alice').reflect();

        // THE GOAL ASSERTION: at least one kind='derived' row exists
        const derived = await pool.query<{ id: string; derived_from: string[] | null; kind: string }>(
          `SELECT id, derived_from, kind FROM memories WHERE kind = 'derived' AND user_id = 'alice'`,
        );
        expect(derived.rows.length).toBeGreaterThanOrEqual(1);
        const first = derived.rows[0];
        expect(first?.kind).toBe('derived');
        expect(first?.derived_from).not.toBeNull();
        expect((first?.derived_from ?? []).length).toBeGreaterThanOrEqual(1);

        // Sanity: LLM was called at least once for reflection
        expect(reflectCallCount()).toBeGreaterThanOrEqual(1);
      },
    );
  });
}
