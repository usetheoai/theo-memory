/**
 * M0 T2.1 — graph-aware recall temporal correctness over the REST surface.
 *
 * Proves that `POST /v1/recall` with `graphExpand` (and `asOf`) honors the
 * bi-temporal filter end-to-end over HTTP against real pgvector: a superseded
 * (`t_invalid`) shared-entity memory does NOT resurface, and `asOf` returns it
 * point-in-time. Companion to the core store GOAL test
 * (`graph-aware-recall-temporal.test.ts`) — this closes the REST-layer DoD.
 *
 * Own isolated DB + own describe so forgetting B never affects the sibling
 * REST graph-expand suite (no order dependency).
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_rest_graph_temporal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

const QUERY = 'alpha';
const MATCH = 'alpha doc';
const FAR = 'beta doc';

function craftedVec(text: string): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  if (text.includes('alpha')) v[0] = 1;
  else v[1] = 1;
  return v;
}

function craftedEmbedder(): Embedder {
  return {
    embed: async (t: string) => craftedVec(t),
    embedBatch: async (texts: readonly string[]) => texts.map((t) => craftedVec(t)),
  };
}

function queueLlm(): LLM {
  return {
    generateResponse: async (messages: readonly { role: string; content: string }[]) => {
      const content = messages.find((m) => m.role === 'user')?.content ?? '';
      const line = content.split('\n').find((l) => l.startsWith('user: ')) ?? '';
      const text = line.replace(/^user:\s*/, '') || 'fact';
      return { memory: [{ id: '0', text, attributed_to: 'user' }] };
    },
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

const sharedEntityExtractor = {
  extract: () => [{ type: 'NOUN' as const, name: 'sharedentity' }],
};

describe.skipIf(ROOT_PG_URI === '')('rest-graph-aware-recall temporal correctness (M0 T2.1)', () => {
  let pool: pg.Pool;
  let memory: Memory;
  let app: ReturnType<typeof createServer>;

  async function recall(body: Record<string, unknown>): Promise<Response> {
    return app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

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
    memory = await createLocalMemory({
      vectorStore,
      embedder: craftedEmbedder(),
      embeddingDim: DIM,
      llm: queueLlm(),
      entityExtractor: sharedEntityExtractor,
    });
    await memory.user('alice').remember(MATCH); // A — near the query
    await memory.user('alice').remember(FAR); //  B — far; same entity as A
    app = createServer({ memory });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('a superseded shared-entity memory does NOT resurface via POST /v1/recall graphExpand; asOf returns it point-in-time', async () => {
    // Baseline over HTTP: graphExpand surfaces B through the shared entity.
    const before = (await (await recall({ userId: 'alice', query: QUERY, threshold: 0.1, graphExpand: {} })).json()) as {
      results: { text: string }[];
    };
    expect(before.results.map((r) => r.text)).toContain(FAR);

    // Supersede B (soft-delete → t_invalid); the entity link survives.
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM memories WHERE text = $1 AND t_invalid IS NULL`,
      [FAR],
    );
    const bId = found.rows[0]?.id;
    expect(bId).toBeDefined();
    await memory.user('alice').forget(bId as string);

    // THE FIX over REST: graphExpand must NOT resurface the superseded B.
    const afterRes = await recall({ userId: 'alice', query: QUERY, threshold: 0.1, graphExpand: {} });
    expect(afterRes.status).toBe(200);
    const after = (await afterRes.json()) as { results: { text: string }[] };
    expect(after.results.map((r) => r.text)).toContain(MATCH);
    expect(after.results.map((r) => r.text)).not.toContain(FAR);

    // asOf point-in-time over REST: at an instant before t_invalid, B resurfaces.
    const bt = await pool.query<{ t_valid: string; t_invalid: string }>(
      `SELECT t_valid, t_invalid FROM memories WHERE id = $1`,
      [bId as string],
    );
    const mid = new Date((new Date(bt.rows[0]!.t_valid).getTime() + new Date(bt.rows[0]!.t_invalid).getTime()) / 2);
    const asOfRes = await recall({
      userId: 'alice',
      query: QUERY,
      threshold: 0.1,
      graphExpand: {},
      asOf: mid.toISOString(),
    });
    expect(asOfRes.status).toBe(200);
    const asOf = (await asOfRes.json()) as { results: { text: string }[] };
    expect(asOf.results.map((r) => r.text)).toContain(FAR);
  }, 60_000);
});
