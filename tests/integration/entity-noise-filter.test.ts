/**
 * GOAL test (entity-extraction-noise-filter T3.1) — the entity-graph excludes
 * noise nodes end-to-end against real pgvector.
 *
 * The observed dogfood noise ("I'm", "m reading", "love science", "user")
 * originates in the COMPROMISE NER fallback (deterministic), NOT the LLM — a
 * real LLM emits clean entities and would test the filter vacuously (EC-4). So
 * this GOAL drives the production compromise-fallback path: a deterministic LLM
 * returns the fact text but NO `entities`, which makes `linkEntities` fall back
 * to the default `CompromiseEntityExtractor` over the stored fact — reproducing
 * the noise — and asserts the persisted `entities` rows INCLUDE Dune +
 * Frank Herbert and EXCLUDE the four noise tokens.
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 * @see .claude/knowledge-base/plans/entity-extraction-noise-filter-plan.md § T3.1
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_entity_noise_filter_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

const SENTENCE = "I'm reading Dune by Frank Herbert and I love science fiction novels";

function craftedVec(text: string): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  v[Math.abs(hash(text)) % DIM] = 1;
  return v;
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function craftedEmbedder(): Embedder {
  return {
    embed: async (t: string) => craftedVec(t),
    embedBatch: async (texts: readonly string[]) => texts.map((t) => craftedVec(t)),
  };
}

/** Deterministic LLM: echoes the input as ONE fact, emits NO `entities` — forcing
 *  the compromise-fallback node path (where the dogfood noise originates). */
function factOnlyLlm(): LLM {
  return {
    generateResponse: async (messages: readonly { role: string; content: string }[]) => {
      const content = messages.find((m) => m.role === 'user')?.content ?? '';
      const line = content.split('\n').find((l) => l.startsWith('user: ')) ?? '';
      const text = line.replace(/^user:\s*/, '') || SENTENCE;
      return { memory: [{ id: '0', text, attributed_to: 'user' }] }; // NO entities → compromise fallback
    },
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

describe.skipIf(ROOT_PG_URI === '')('entity-noise-filter GOAL — entity-graph excludes noise nodes', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: DIM });
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const memory: Memory = await createLocalMemory({
      vectorStore,
      embedder: craftedEmbedder(),
      embeddingDim: DIM,
      llm: factOnlyLlm(),
    });
    await memory.user('alice').remember(SENTENCE);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('persists Dune + Frank Herbert and excludes the noise tokens', async () => {
    const { rows } = await pool.query<{ name: string }>('SELECT name FROM entities');
    const names = rows.map((r) => r.name);

    // Non-vacuous: the compromise fallback must have produced at least the real entities.
    expect(names.length).toBeGreaterThan(0);

    // INCLUDE — real entities survive (recall preserved).
    expect(names.some((n) => n.includes('Dune'))).toBe(true);
    expect(names.some((n) => n.includes('Frank Herbert'))).toBe(true);

    // EXCLUDE — the four observed noise tokens are filtered out.
    const lowered = names.map((n) => n.toLowerCase());
    expect(lowered).not.toContain("i'm");
    expect(lowered).not.toContain('m reading');
    expect(lowered).not.toContain('love science');
    expect(lowered).not.toContain('user');
  }, 60_000);
});
