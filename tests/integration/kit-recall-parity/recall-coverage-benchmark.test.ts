/**
 * M14 Phase 5 — per-prompt recall coverage BENCHMARK (real ankane/pgvector:v0.5.1).
 *
 * The M14 goal metric: the OLD kit recalled once per session by the project NAME
 * (`theo-recall.mjs` SessionStart, a CONSTANT `query = project`), so every session touched
 * the SAME nearest-neighbour set — leaving ~79% of memories never read
 * (`last_accessed_at IS NULL`). The NEW per-prompt recall (`theo-prompt-recall.mjs`,
 * UserPromptSubmit, `query = prompt`) issues a DISTINCT query per message, so the union of
 * touched neighbourhoods grows with prompt diversity.
 *
 * This benchmark measures the never-read fraction under both regimes against real pgvector,
 * with a corpus larger than what one recall returns so the two regimes discriminate. A memory
 * counts as read when recall RETURNED it; internal search candidates the caller never received
 * do not count (before that fix this benchmark counted the over-fetched neighbourhood, so its
 * numbers overstated coverage). The stub vectors are unrelated to the text, so the recalls use
 * threshold 0 to return their top-K instead of being gated out. The
 * DeterministicStubEmbedder gives a distinct, reproducible vector per text (no API key, no
 * flake), so the result is a deterministic real number (plan § Benchmark, "real number, not
 * estimate"). The numbers are persisted to a JSON the implementation report cites.
 *
 * Gated by THEOMEM_PG_URI (absent → SKIP).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import pg from 'pg';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<string> {
    return Promise.resolve('[]');
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ content: '[]', role: 'assistant' });
  },
};

const WS = 'tn-bench';
const USER = 'user-bench';
// Corpus larger than one recall's result set (TOP_K) so the two regimes discriminate.
const CORPUS_SIZE = 300;
const TOP_K = 5;
const WINDOW = 12; // messages in a session (the OLD hook fires 1 recall/session; NEW fires 1/message)

// A window of distinct user prompts (what the per-prompt hook searches by). Each targets a
// different region of the corpus, so the union of touched neighbourhoods grows.
const DISTINCT_PROMPTS = [
  'subject 5 domain 5',
  'subject 50 domain 4',
  'subject 120 domain 6',
  'subject 200 domain 16',
  'subject 33 domain 10',
  'subject 270 domain 17',
  'subject 88 domain 19',
  'subject 150 domain 12',
  'subject 210 domain 3',
  'subject 12 domain 12',
  'subject 260 domain 7',
  'subject 99 domain 9',
];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M14 Phase 5 recall coverage benchmark (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M14 Phase 5 — per-prompt recall coverage benchmark', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    /** DDL e TRUNCATE: privilégio que o papel de aplicação não tem, por desenho. */
    let setupPool: pg.Pool;
    let memory: Memory;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('tn-bench');
      dropDb = iso.dropDb;
      setupPool = iso.setupPool;
      memory = (
        await createLocalMemory({
          vectorStore: new PgvectorStore(pool),
          embedder: new DeterministicStubEmbedder(),
          llm: emptyJsonLlm,
        })
      ).withWorkspace!(WS);
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await setupPool.query('TRUNCATE memories, entities, memory_entities, entity_edges, history RESTART IDENTITY CASCADE');
    });

    /** Fraction of live memories never read (last_accessed_at IS NULL) in the bench scope. */
    async function neverReadFraction(): Promise<number> {
      const { rows } = await pool.query<{ frac: string }>(
        `SELECT count(*) FILTER (WHERE last_accessed_at IS NULL)::float / NULLIF(count(*),0) AS frac
           FROM memories WHERE workspace_id=$1 AND t_invalid IS NULL`,
        [WS],
      );
      return Number(rows[0]?.frac ?? 0);
    }

    async function resetAccess(): Promise<void> {
      await pool.query(`UPDATE memories SET last_accessed_at = NULL, access_count = 0 WHERE workspace_id=$1`, [WS]);
    }

    test('per-prompt recall drives the never-read fraction far below the constant project-name recall', async () => {
      const scoped = memory.user(USER);
      for (let i = 0; i < CORPUS_SIZE; i++) {
        await scoped.remember(`subject ${i} domain ${i % 23} topic ${(i * 3) % 41} note ${i}`, { infer: false });
      }
      const baseline = await neverReadFraction();
      expect(baseline).toBeCloseTo(1.0, 2); // nothing read yet → ~100% unread

      // OLD regime: the SAME constant query (project name) once per session — every session
      // touches the SAME neighbourhood, so distinct coverage never grows past one recall's set.
      await resetAccess();
      const projectRead = new Set<string>();
      for (let s = 0; s < WINDOW; s++) {
        for (const m of await scoped.recall('tn-bench', { topK: TOP_K, threshold: 0 })) projectRead.add(m.id);
      }
      const afterProjectRecall = await neverReadFraction();

      // NEW regime: a DISTINCT query per message over the same-size window.
      await resetAccess();
      const promptRead = new Set<string>();
      for (const prompt of DISTINCT_PROMPTS) {
        for (const m of await scoped.recall(prompt, { topK: TOP_K, threshold: 0 })) promptRead.add(m.id);
      }
      const afterPromptRecall = await neverReadFraction();

      // Read means returned: the never-read fraction is exactly what recall did not hand back.
      expect(afterProjectRecall).toBeCloseTo(1 - projectRead.size / CORPUS_SIZE, 10);
      expect(afterPromptRecall).toBeCloseTo(1 - promptRead.size / CORPUS_SIZE, 10);
      // The constant query returns the same memories every session.
      expect(projectRead.size).toBe(TOP_K);
      // The per-prompt window reads STRICTLY more of the corpus than the repeated constant query.
      expect(promptRead.size).toBeGreaterThan(projectRead.size);
      expect(afterPromptRecall).toBeLessThan(afterProjectRecall);

      // Persist the real numbers for the implementation report (§ Benchmark) — the plan's
      // "real number, not estimate" gate.
      const outDir = 'benchmarks/results';
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        `${outDir}/claude-code-kit-recall-parity-benchmark.json`,
        JSON.stringify(
          {
            metric: 'never_read_fraction (last_accessed_at IS NULL / total live memories)',
            corpus_size: CORPUS_SIZE,
            window: WINDOW,
            top_k: TOP_K,
            read_means: 'returned by recall (not internal search candidates)',
            baseline_fraction: baseline,
            after_constant_project_query_fraction: afterProjectRecall,
            after_distinct_per_prompt_query_fraction: afterPromptRecall,
            reduction_points_vs_project_recall: afterProjectRecall - afterPromptRecall,
            reduction_points_vs_baseline: baseline - afterPromptRecall,
            embedder: 'DeterministicStubEmbedder (Lehmer LCG, deterministic distinct vector per text)',
            db: 'ankane/pgvector:v0.5.1',
            note: 'Corpus > one recall result set so the constant-query regime (old SessionStart hook) and the distinct-per-prompt regime (new UserPromptSubmit hook) discriminate. Deterministic, no API key.',
          },
          null,
          2,
        ),
        'utf8',
      );
    });
  });
}
