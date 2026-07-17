/**
 * GOAL test (rest-graph-aware-recall T2.1) — graph-aware recall over the REST surface.
 *
 * Proves `RecallOptions.graphExpand` flows REST → recallHandler → scoped.recall →
 * pipeline Step 8.7 → the JOIN, end-to-end over the HTTP server against real
 * pgvector. Two memories share an entity (A near the query, B below threshold);
 * a `POST /v1/recall` with `graphExpand` surfaces B in the JSON `results`; the
 * same POST WITHOUT `graphExpand` is byte-identical (B absent); an invalid
 * `graphExpand.hops` is rejected 422 (not 500).
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
const ISOLATED_DB = 'themem_rest_graph_recall_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

const QUERY = 'alpha';
const MATCH = 'alpha doc'; // near the query → top semantic result
const FAR = 'beta doc'; //   far from the query → below threshold (surfaces only via the graph)

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

/** Stub extractor linking every stored memory to the SAME entity (deterministic). */
const sharedEntityExtractor = {
  extract: () => [{ type: 'NOUN' as const, name: 'sharedentity' }],
};

describe.skipIf(ROOT_PG_URI === '')('rest-graph-aware-recall GOAL — graphExpand over HTTP', () => {
  let pool: pg.Pool;
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
    const memory: Memory = await createLocalMemory({
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

  it('POST /v1/recall WITH graphExpand surfaces the shared-entity below-threshold memory', async () => {
    const res = await recall({ userId: 'alice', query: QUERY, threshold: 0.1, graphExpand: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { text: string }[] };
    const texts = body.results.map((r) => r.text);
    expect(texts).toContain(MATCH);
    expect(texts).toContain(FAR); // surfaced via the entity graph over HTTP
  }, 60_000);

  it('POST /v1/recall with explicit graphExpand.hops=1 also surfaces the connected memory', async () => {
    // F-tests-7: prove an EXPLICIT hops value (not just the {} default) flows over HTTP.
    const res = await recall({ userId: 'alice', query: QUERY, threshold: 0.1, graphExpand: { hops: 1, limit: 10 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { text: string }[] };
    expect(body.results.map((r) => r.text)).toContain(FAR);
  }, 60_000);

  it('POST /v1/recall WITHOUT graphExpand is byte-unchanged (B absent)', async () => {
    const res = await recall({ userId: 'alice', query: QUERY, threshold: 0.1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { text: string }[] };
    const texts = body.results.map((r) => r.text);
    expect(texts).toContain(MATCH);
    expect(texts).not.toContain(FAR);
  }, 60_000);

  it('invalid graphExpand (hops out of range) ⇒ 422, never 500', async () => {
    const res = await recall({ userId: 'alice', query: QUERY, graphExpand: { hops: 3 } });
    expect(res.status).toBe(422);
  }, 60_000);
});
