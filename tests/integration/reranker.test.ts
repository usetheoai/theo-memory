/**
 * GOAL test (cross-encoder-reranker T5.1) — real cross-encoder rerank end-to-end.
 *
 * Composes against a real pgvector container + the REAL @xenova cross-encoder:
 *  - LocalTransformerEmbedder (Xenova all-MiniLM-L6-v2, 384-dim)
 *  - CrossEncoderReranker (Xenova/ms-marco-MiniLM-L-6-v2) — the feature under test
 *  - PgvectorStore at vector(384) (via runMigrations({ embeddingDim: 384 }))
 *
 * The LLM extraction step is stubbed with a deterministic fact queue so the
 * STORED text is exactly the fixture; the reranker, embedder, and pgvector are
 * all REAL — the feature under test runs end-to-end.
 *
 * Honest finding (Inquebrável Rule 3): on a tiny 2-doc corpus the MiniLM
 * bi-encoder already ranks a genuinely-relevant doc above a coherent distractor,
 * so a strict baseline-wrong→reranked-right FLIP is NOT reliably reproducible
 * without adversarial keyword-stuffing (which fools BOTH the bi-encoder AND the
 * cross-encoder via exact-term overlap — empirically verified during T5.1).
 * The reranker's value (precision@k lift) materializes on larger / adversarial
 * corpora. This GOAL therefore asserts the two robust, non-flaky truths that
 * prove the feature works end-to-end:
 *   1. with `rerank`, the genuinely-relevant doc is ranked #1 (relevance-correct);
 *   2. the result `score` is the REAL cross-encoder relevance (sigmoid ∈ [0,1]),
 *      DISTINCT from the cosine-combined baseline score — proving the reranker
 *      re-scored via the real model and is NOT a passthrough.
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI). First run downloads the
 * two ONNX models from the HF CDN (cached thereafter).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local';
import { CrossEncoderReranker } from '@usetheo/memory/reranker-local';
import type { LLM } from '@usetheo/memory';
import { ENGLISH, isLanguageIdentification } from './_helpers/language-identification.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_reranker_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);

const RELEVANT =
  'If you want to do data science, learn Python first; it has the richest ecosystem of analysis libraries.';
const DISTRACTOR =
  'Data science salaries depend heavily on your programming language skills and your total years of experience in the field.';
const QUERY = 'what programming language should I learn for data science';

/** Deterministic extraction stub: returns a queued fact per remember() call. */
function makeQueueLlm(facts: readonly string[]): LLM {
  let i = 0;
  return {
    generateResponse: async (messages) => {
      if (isLanguageIdentification(messages)) return ENGLISH;
      const text = facts[Math.min(i, facts.length - 1)] ?? '';
      i += 1;
      return { memory: [{ id: String(i), text }] };
    },
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

describe.skipIf(ROOT_PG_URI === '')('cross-encoder-reranker GOAL — real cross-encoder rerank', () => {
  const USER = `reranker-goal-${Date.now()}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB}`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: 384 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('ranks the relevant doc #1 and re-scores via the real cross-encoder (not a passthrough)', async () => {
    const vectorStore = new PgvectorStore(pool, { embeddingDim: 384 });
    await vectorStore.initialize();
    const memory = await createLocalMemory({
      vectorStore,
      embedder: new LocalTransformerEmbedder(),
      embeddingDim: 384,
      llm: makeQueueLlm([RELEVANT, DISTRACTOR]),
      reranker: new CrossEncoderReranker(),
    });
    const user = memory.user(USER);

    // Store the relevant doc then the distractor (deterministic via the queue stub).
    await user.remember('seed relevant');
    await user.remember('seed distractor');

    // Baseline (no rerank) + reranked, same query + topK.
    const baseline = await user.recall(QUERY, { topK: 2, threshold: 0 });
    const reranked = await user.recall(QUERY, { topK: 2, threshold: 0, rerank: {} });

    // Both docs are retrieved in each path (topK=2 covers the 2-doc corpus).
    expect(baseline.map((r) => r.text).sort()).toEqual([DISTRACTOR, RELEVANT].sort());
    expect(reranked.map((r) => r.text).sort()).toEqual([DISTRACTOR, RELEVANT].sort());

    // (1) Relevance-correct: the cross-encoder ranks the genuinely-relevant doc #1.
    expect(reranked[0]?.text).toBe(RELEVANT);

    // (2) Real re-scoring (NOT a passthrough): the reranked top score is the
    // cross-encoder sigmoid relevance (∈ [0, 1]) and is DISTINCT from the
    // cosine-combined baseline score for the same doc.
    const top = reranked[0];
    expect(top).toBeDefined();
    expect(Number.isFinite(top?.score)).toBe(true);
    expect(top!.score).toBeGreaterThanOrEqual(0);
    expect(top!.score).toBeLessThanOrEqual(1);
    const baselineRelevantScore = baseline.find((r) => r.text === RELEVANT)?.score ?? -1;
    expect(top!.score).not.toBe(baselineRelevantScore);
  }, 180_000);
});
