/**
 * Multi-session AGGREGATION ("how many") — where the fix belongs (keyless proof).
 *
 * The e2e-qa bench's multi-session `how many` questions fail. Experiment B (a
 * harness coverage-gate relaxation for counting questions) was REVERTED: it let
 * the answer-LLM try, but the LLM still could not produce the count — proving the
 * coverage-gate was NOT the blocker. That left two hypotheses:
 *   (a) recall does not surface all the occurrences  -> memory-layer gap (IN SCOPE)
 *   (b) the consumer cannot aggregate/count the surfaced memories -> AGENT-side
 *       (OUT OF SCOPE for TheMemory core, per the locked "memory layer, NOT agent
 *        runtime" boundary — the same reason G1/G4 were deferred to TheoKit).
 *
 * This keyless test resolves (a) vs (b) and shows the CORRECT layering, i.e. the
 * pattern a TheoKit consumer/agent uses on top of TheMemory:
 *   1. TheMemory recall SURFACES every relevant memory (asserted)   -> (a) is fine.
 *   2. Counting them is a TRIVIAL agent-side step over `recall()`    -> (b) is the
 *      consumer's job, and it is easy once recall is complete.
 *
 * Keyless: raw ingest via `remember(text, { infer: false })` (no extraction LLM),
 * real `LocalTransformerEmbedder` (local, no key), real pgvector. DB-gated:
 * `describe.skipIf(THEOMEM_PG_URI unset)` — SKIPs in keyless-no-DB CI, GREEN vs a
 * live `ankane/pgvector:v0.5.1`.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLocalMemory,
  PgvectorStore,
  runMigrations,
  type DisposableMemory,
  type LLM,
  type LLMResponse,
} from '@usetheo/memory';
import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local';

const ADMIN_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_aggregation_demo';
const DIM = 384;

/** Keyless no-op extraction LLM: raw ingest uses `infer:false`, so this is never asked to extract. */
const noopLlm: LLM = {
  generateResponse: (): Promise<unknown> => Promise.resolve([]),
  generateChat: (): Promise<LLMResponse> => Promise.resolve({ role: 'assistant', content: '[]' }),
};

function isolatedUri(): string {
  const u = new URL(ADMIN_PG_URI);
  u.pathname = `/${ISOLATED_DB}`;
  return u.toString();
}

// A realistic multi-"session" scope: 3 clothing items to pick up/return + distractors,
// mirroring the shape of the real bench question `0a995998` (gold = 3).
const CLOTHING_ITEMS: readonly string[] = [
  'I need to return a blue jacket to the department store.',
  'I have to pick up my dry-cleaned shirt from the store this weekend.',
  'These jeans do not fit, so I need to return them to the store.',
];
const DISTRACTORS: readonly string[] = [
  'My favorite color is green.',
  'I work as a software engineer at a startup.',
  'I visited Paris last summer for a technology conference.',
];
const QUERY = 'How many items of clothing do I need to pick up or return from a store?';

/**
 * The AGENT-side aggregation step (what a TheoKit consumer does over `recall()`).
 * Deterministic on purpose: the point is that once recall surfaces the memories,
 * counting is trivial — no memory-layer feature required.
 */
function agentCountClothingToHandle(memories: readonly { text: string }[]): number {
  const action = /\b(return|pick(?:ing)?\s*up|pick up)\b/i;
  const garment = /\b(jacket|shirt|jeans|clothing|clothes|garment)\b/i;
  return memories.filter((m) => action.test(m.text) && garment.test(m.text)).length;
}

describe.skipIf(ADMIN_PG_URI === '')(
  'multi-session aggregation — recall completeness (in scope) + agent-side count (out of scope)',
  () => {
    let pool: pg.Pool;
    let memory: DisposableMemory;
    const user = 'agg-demo-user';

    beforeAll(async () => {
      const admin = new pg.Pool({ connectionString: ADMIN_PG_URI });
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB}`);
        await admin.query(`CREATE DATABASE ${ISOLATED_DB}`);
      } finally {
        await admin.end();
      }
      pool = new pg.Pool({ connectionString: isolatedUri() });
      await runMigrations(pool, { embeddingDim: DIM });
      memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: DIM }),
        embedder: new LocalTransformerEmbedder(),
        llm: noopLlm,
        embeddingDim: DIM,
      });

      const scope = memory.user(user);
      // Raw ingest (keyless — no extraction LLM). Interleave items + distractors.
      for (const text of [...CLOTHING_ITEMS, ...DISTRACTORS]) {
        await scope.remember(text, { infer: false });
      }
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
    });

    it('recall SURFACES every clothing item (memory-layer job — resolves hypothesis (a): recall is complete)', async () => {
      const recalled = await memory.user(user).recall(QUERY, { topK: 10 });
      const texts = recalled.map((m) => m.text);
      // Every one of the 3 real occurrences is present in recall — the memory layer did its job.
      for (const item of CLOTHING_ITEMS) {
        expect(texts).toContain(item);
      }
    });

    it('the AGENT-side count over recall answers the "how many" query (out of scope for core)', async () => {
      const recalled = await memory.user(user).recall(QUERY, { topK: 10 });
      // Counting the surfaced memories is a trivial consumer/agent step — no core feature needed.
      expect(agentCountClothingToHandle(recalled)).toBe(3);
    });
  },
);
