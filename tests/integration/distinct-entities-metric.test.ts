/**
 * GOAL test (distinct-entities-metric-fix T2.1) — the Overview "Distinct
 * entities" metric equals the Entities-tab count end-to-end.
 *
 * Root cause being fixed: `GET /metrics`.`entity_count` used distinct
 * `attributedTo` peers while `GET /entities` reads the real entity graph
 * (`MemoryEntityStore.list()`), so the dashboard showed "1" vs "10". After EG-3
 * both read `list()` when the store is wired. This GOAL persists a scope with
 * ≥ 2 distinct graph entities (via the LLM-primary node path) and asserts, over
 * the HTTP server against real pgvector, that `metrics.entity_count` EQUALS
 * `entities.length` AND is ≥ 2 (non-vacuous).
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgMemoryEntityStore, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_distinct_entities_metric_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

const SENTENCE = 'Dune by Frank Herbert is a science fiction novel';
const LLM_ENTITIES = ['Dune', 'Frank Herbert'] as const; // ≥ 2 distinct graph entities

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

/** Deterministic LLM: returns the fact + an `entities` list (≥2 distinct), so the
 *  entity graph is provably populated with multiple distinct nodes. */
function entitiesLlm(): LLM {
  return {
    generateResponse: async (messages: readonly { role: string; content: string }[]) => {
      const content = messages.find((m) => m.role === 'user')?.content ?? '';
      const line = content.split('\n').find((l) => l.startsWith('user: ')) ?? '';
      const text = line.replace(/^user:\s*/, '') || SENTENCE;
      return { memory: [{ id: '0', text, attributed_to: 'user' }], entities: LLM_ENTITIES.map((name) => ({ name })) };
    },
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

describe.skipIf(ROOT_PG_URI === '')('distinct-entities-metric GOAL — Overview == Entities tab', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createServer>;

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
      llm: entitiesLlm(),
    });
    await memory.user('alice').remember(SENTENCE);
    // Server read side: the SAME entity store both endpoints will read.
    app = createServer({ memory, memoryEntityStore: new PgMemoryEntityStore(pool) });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('metrics.entity_count equals the Entities-tab count (and is >= 2)', async () => {
    const metricsRes = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    expect(metricsRes.status).toBe(200);
    const metrics = (await metricsRes.json()) as { entity_count: number };

    const entitiesRes = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
    expect(entitiesRes.status).toBe(200);
    const entities = (await entitiesRes.json()) as { entities: unknown[] };

    expect(entities.entities.length).toBeGreaterThanOrEqual(2); // non-vacuous: ≥2 distinct graph entities
    expect(metrics.entity_count).toBe(entities.entities.length); // single source of truth
  }, 60_000);
});
