/**
 * GOAL test (entity-label-language-determinism EG-5 T3.1) — the persisted entity
 * labels stay in the INPUT language. This is an LLM-behavioral property, so it uses
 * a REAL OpenAI LLM (a stub would prove nothing about real label-following —
 * Inquebrável Rule 3); the embedder is a crafted stub (embeddings are irrelevant to
 * the entity-label LANGUAGE under test). The EG-4 fix already pins the fact text;
 * EG-5 closes the entity/relation LABEL drift the complete live-test surfaced
 * (English input → `surfar`/`fins de semana` nodes).
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
const ISOLATED_DB = 'themem_entity_label_lang_goal';
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

describe.skipIf(ROOT_PG_URI === '' || !HAS_KEY)('entity-label-language-determinism GOAL — entity labels stay in source language', () => {
  let pool: pg.Pool;
  let memory: Memory;

  beforeAll(async () => {
    if ((process.env['OPENAI_BASE_URL'] ?? '') === '') process.env['OPENAI_BASE_URL'] = 'https://api.openai.com/v1';
    if ((process.env['OPENAI_CHAT_MODEL'] ?? '') === '') process.env['OPENAI_CHAT_MODEL'] = 'gpt-4o-mini';

    const adminPool = new pg.Pool({ connectionString: ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres') });
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

  it('an English input persists English entity labels (not translated to Portuguese)', async () => {
    await memory.user('en').remember('My name is Daniel and I work as a product manager and I enjoy surfing on weekends');
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM entities WHERE user_id = 'en'");
    const labels = rows.map((r) => r.name.toLowerCase()).join(' || ');
    expect(rows.length).toBeGreaterThan(0);
    // at least one clearly-English label is present (robust to which entities the LLM chose).
    expect(labels).toMatch(/surf|weekend|manager|product/);
    // the Portuguese translations the live-test produced must be ABSENT (the EG-5 oracle).
    expect(labels).not.toMatch(/surfar|fins de semana|gerente/);
  }, 60_000);

  it('a Portuguese input persists Portuguese entity labels (not translated to English)', async () => {
    await memory.user('pt').remember('Eu trabalho como engenheiro mecânico e moro em Lisboa');
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM entities WHERE user_id = 'pt'");
    const labels = rows.map((r) => r.name.toLowerCase()).join(' || ');
    expect(rows.length).toBeGreaterThan(0);
    expect(labels).toMatch(/engenheiro|lisboa/);
    // not translated to English.
    expect(labels).not.toMatch(/\bengineer\b|\bmechanic\b/);
  }, 60_000);
});
