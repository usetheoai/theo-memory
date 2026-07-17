/**
 * T4.2 — Public-API smoke gate for the category filter chain.
 *
 * Two scenarios composing the FULL public stack end-to-end:
 *   1. POST /v1/remember with body.category='preferences' → row persisted →
 *      GET /v1/scopes/user/.../memories?category=preferences returns the row.
 *   2. POST /v1/remember WITHOUT category → row persisted → GET with category
 *      filter returns empty list (legacy NULL row not findable per ADR D1 + EC-9).
 *
 * Composition uses Path C primitives (Constant384 embedder + DeterministicStubLLM)
 * — same pattern as scopes-list-temporal-fidelity + scopes-list-category-filter.
 *
 * Acts as the wiring sentinel for Phase 4 — locks the contract delivered by
 * T1.1 (RememberOptions.category) + T2.1 (migration 0014) + T3.1/T3.2/T3.3
 * (adapter + pipeline) + T4.1 (REST handler).
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import type { Embedder } from '@usetheo/memory';
import { DeterministicStubLLM } from '@usetheo/memory/llms/stub';
import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const EMBEDDING_DIM = 1536;

const ConstantEmbedder: Embedder = {
  embed: async () => {
    const v = new Array<number>(EMBEDDING_DIM).fill(0);
    v[0] = 1;
    return v;
  },
  embedBatch: async (texts) =>
    texts.map(() => {
      const v = new Array<number>(EMBEDDING_DIM).fill(0);
      v[0] = 1;
      return v;
    }),
};

describe.skipIf(PG_URI === '')('T4.2 — category filter public-API smoke gate', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createServer>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await runMigrations(pool);
    const vectorStore = new PgvectorStore(pool);
    const memory = await createLocalMemory({
      vectorStore,
      embedder: ConstantEmbedder,
      llm: new DeterministicStubLLM(),
    });
    app = createServer({ memory });
  }, 30_000);

  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('POST /v1/remember with category → GET ?category=X returns the row', async () => {
    // POST /v1/remember body includes category=preferences. infer:false avoids
    // the LLM extraction path (would fan out to N facts under DeterministicStubLLM).
    const postRes = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'alice',
          text: 'I prefer aeropress',
          infer: false,
          category: 'preferences',
        }),
      }),
    );
    expect(postRes.status).toBe(201);
    const postBody = (await postRes.json()) as { items: { id: string }[] };
    expect(postBody.items).toHaveLength(1);
    const insertedId = postBody.items[0]?.id;
    expect(insertedId).toBeDefined();

    // GET /v1/scopes/user/alice/memories?category=preferences returns the row.
    const getRes = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?category=preferences'),
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { items: { id: string }[] };
    expect(getBody.items).toHaveLength(1);
    expect(getBody.items[0]?.id).toBe(insertedId);
  });

  test('POST /v1/remember WITHOUT category → GET ?category=X returns empty (ADR D1 + EC-9)', async () => {
    // POST without category — row persists with category=NULL.
    const postRes = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'alice',
          text: 'a fact with no operator category',
          infer: false,
        }),
      }),
    );
    expect(postRes.status).toBe(201);

    // GET with a filter does NOT match the NULL row per ADR D1 honest no-backfill
    // + EC-9 NULL findability disclosed semantic.
    const filtered = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?category=anything'),
    );
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as { items: unknown[] };
    expect(filteredBody.items).toEqual([]);

    // Sanity: no-filter GET DOES return the row (proves it persisted).
    const all = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories'),
    );
    const allBody = (await all.json()) as { items: unknown[] };
    expect(allBody.items).toHaveLength(1);
  });
});
