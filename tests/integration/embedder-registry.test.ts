/**
 * GOAL test (embedder-registry T4.1) — a registry-built embedder round-trips
 * remember + recall end-to-end against a real pgvector container, AND the
 * registry fails loud on an unknown provider key.
 *
 * The embedder under test is built ENTIRELY through the public registry
 * (`createEmbedder({ provider: 'ollama', ... })`) — proving the factory + lazy
 * loader + fetch-based adapter compose into a working Embedder DIP. The fetch is
 * stubbed with a deterministic unit-vector function (NO network, NO SDK) so the
 * round-trip is hermetic; pgvector is REAL. The LLM extraction step is stubbed
 * with a queue so the STORED text equals the fixture, and recall uses that exact
 * text → cosine 1.0 → the stored row is retrieved, proving the registry-built
 * embedder is wired through BOTH remember() and recall().
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { EmbedderError } from '@usetheo/memory/contract';
import { createEmbedder } from '@usetheo/memory/embedders/registry';
import type { LLM } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_embedder_registry_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 16;
const FACT = 'I prefer dark mode in my editor';

/** Deterministic FNV-seeded unit vector — identical text → identical vector. */
function deterministicVec(text: string, dim: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const v: number[] = [];
  for (let d = 0; d < dim; d++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    v.push(((h >>> 0) % 1000) / 1000 - 0.5);
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Stub `fetch` mimicking the Ollama `/api/embed` contract — no network. */
const stubFetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body ?? '{}') as { input?: string[] };
  const embeddings = (body.input ?? []).map((t) => deterministicVec(t, DIM));
  return { ok: true, status: 200, json: async () => ({ embeddings }) };
}) as unknown as typeof fetch;

/** Deterministic extraction stub: returns a queued fact per remember() call. */
function makeQueueLlm(facts: readonly string[]): LLM {
  let i = 0;
  return {
    generateResponse: async () => {
      const text = facts[Math.min(i, facts.length - 1)] ?? '';
      i += 1;
      return { memory: [{ id: String(i), text }] };
    },
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

describe.skipIf(ROOT_PG_URI === '')('embedder-registry GOAL — registry-built embedder round-trip', () => {
  const USER = `embreg-goal-${Date.now()}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB}`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: DIM });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('builds an embedder via createEmbedder and round-trips remember + recall', async () => {
    const embedder = await createEmbedder({ provider: 'ollama', baseUrl: 'http://stub', fetchImpl: stubFetch });
    expect(embedder.constructor.name).toBe('OllamaEmbedder');

    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const memory = await createLocalMemory({
      vectorStore,
      embedder,
      embeddingDim: DIM,
      llm: makeQueueLlm([FACT]),
    });
    const user = memory.user(USER);

    await user.remember('seed turn');
    const results = await user.recall(FACT, { topK: 5, threshold: 0 });

    expect(results.map((r) => r.text)).toContain(FACT);
  }, 60_000);

  it('rejects an unknown provider key with EmbedderError', async () => {
    await expect(
      // @ts-expect-error — deliberately invalid key for the fail-loud contract
      createEmbedder({ provider: 'does-not-exist' }),
    ).rejects.toBeInstanceOf(EmbedderError);
  });
});
