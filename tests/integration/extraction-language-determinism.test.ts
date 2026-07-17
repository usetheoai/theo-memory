/**
 * GOAL test (extraction-language-determinism T2.1) — the persisted fact text
 * stays in the INPUT language (EG-4). This is an LLM-behavioral property, so it
 * uses a REAL OpenAI LLM (a stub would prove nothing about prompt-following —
 * Inquebrável Rule 3). The embedder is a crafted stub: embeddings are irrelevant
 * to the fact-text LANGUAGE under test; the LLM (the thing under test) is real.
 *
 * Skipped when OPENAI_API_KEY or THEOMEM_PG_URI is missing (no flaky/keyless CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const HAS_KEY = (process.env['OPENAI_API_KEY'] ?? '') !== '';
const ISOLATED_DB = 'themem_extraction_language_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

function craftedVec(text: string): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  v[Math.abs(h) % DIM] = 1;
  return v;
}
function craftedEmbedder(): Embedder {
  return {
    embed: async (t: string) => craftedVec(t),
    embedBatch: async (texts: readonly string[]) => texts.map((t) => craftedVec(t)),
  };
}

describe.skipIf(ROOT_PG_URI === '' || !HAS_KEY)('extraction-language-determinism GOAL — fact stays in source language', () => {
  let pool: pg.Pool;
  let memory: Memory;

  beforeAll(async () => {
    // Real OpenAI extraction. OpenAILLM reads OPENAI_API_KEY/_BASE_URL/_CHAT_MODEL at call time.
    if ((process.env['OPENAI_BASE_URL'] ?? '') === '') process.env['OPENAI_BASE_URL'] = 'https://api.openai.com/v1';
    if ((process.env['OPENAI_CHAT_MODEL'] ?? '') === '') process.env['OPENAI_CHAT_MODEL'] = 'gpt-4o-mini';

    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: DIM });
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const llm: LLM = new OpenAILLM();
    memory = await createLocalMemory({ vectorStore, embedder: craftedEmbedder(), embeddingDim: DIM, llm });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('a Portuguese input persists a Portuguese fact (not translated to English)', async () => {
    await memory.user('pt').remember('Eu trabalho como engenheiro mecânico');
    const facts = (await memory.user('pt').getAll()).map((m) => m.text.toLowerCase()).join(' || ');
    // PT content stems survive rephrasing (trabalho/trabalha; engenheiro).
    expect(facts).toMatch(/trabalh/);
    expect(facts).toMatch(/engenheiro/);
    // The obvious English translation must be ABSENT (word-boundary, anti-flake).
    expect(facts).not.toMatch(/\bworks?\b/);
    expect(facts).not.toMatch(/\bengineer\b/);
  }, 60_000);

  it('an English input persists an English fact (not translated to Portuguese)', async () => {
    // fixes-cycle-1 D4: the canonical dogfood sentence the live-test caught being
    // translated to PT ("cientista de dados", "escalada"). NON-COGNATE assertion:
    // "data scientist" / "climbing" have NO shared stem with their PT translations,
    // so a leak is detected reliably (the old "hiking" sentence was a false-green).
    await memory.user('en').remember('My name is Sarah and I work as a data scientist and I love rock climbing');
    const facts = (await memory.user('en').getAll()).map((m) => m.text.toLowerCase()).join(' || ');
    expect(facts.length).toBeGreaterThan(0); // something was extracted
    // The property under test is LANGUAGE, not extraction completeness: at least one
    // clearly-English content token is present (OR — robust to which facts the LLM
    // chose to extract on a given run)...
    expect(facts).toMatch(/\bdata\b|scientist|climb/);
    // ...AND the Portuguese translation of the input is ABSENT (the exact tokens the
    // live-test produced when the fact was wrongly translated). This is the EG-4 oracle.
    expect(facts).not.toMatch(/cientista|escalada|caminhada|trilha/);
  }, 60_000);
});
