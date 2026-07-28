/**
 * M0 GOAL test — graph-aware recall temporal correctness (against a real
 * ankane/pgvector container + the REAL recall pipeline + REAL entity-linking +
 * REAL PgGraphExpansionStore JOIN).
 *
 * Proves the fix: graph expansion must NOT resurface a `t_invalid`
 * (superseded/evicted) memory (T1.2), and `asOf` returns the state valid at an
 * instant (T1.3). Before the fix, a superseded shared-entity memory resurfaced
 * through `graphExpand` — the bug this milestone closes.
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_graph_recall_temporal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

const QUERY = 'alpha';
const MATCH = 'alpha doc'; // near the query → top semantic result
const FAR = 'beta doc'; //   far from the query → surfaces only via the shared entity

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

/** Stub extractor: every stored memory links to the SAME entity (deterministic). */
const sharedEntityExtractor = {
  extract: () => [{ type: 'NOUN' as const, name: 'sharedentity' }],
};

describe.skipIf(ROOT_PG_URI === '')('graph-aware-recall temporal correctness (M0)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: DIM });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('a superseded (t_invalid) shared-entity memory does NOT resurface via graphExpand; asOf returns it point-in-time', async () => {
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const memory = await createLocalMemory({
      vectorStore,
      embedder: craftedEmbedder(),
      embeddingDim: DIM,
      llm: queueLlm(),
      entityExtractor: sharedEntityExtractor,
    });
    const user = memory.user('alice');
    await user.remember(MATCH); // A — near the query
    await user.remember(FAR); //  B — far; linked to the SAME entity as A

    // Baseline: with graphExpand ON, B surfaces through the shared entity.
    const baseline = await user.recall(QUERY, { topK: 10, threshold: 0.1, graphExpand: {} });
    expect(baseline.map((r) => r.text)).toContain(MATCH);
    expect(baseline.map((r) => r.text)).toContain(FAR);

    // Find B's row and supersede it (soft-delete → t_invalid set; the entity link survives).
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM memories WHERE text = $1 AND t_invalid IS NULL`,
      [FAR],
    );
    const bId = found.rows[0]?.id;
    expect(bId).toBeDefined();
    await user.forget(bId as string);

    // THE FIX: graphExpand must NOT resurface the superseded B (bug: it did).
    const afterForget = await user.recall(QUERY, { topK: 10, threshold: 0.1, graphExpand: {} });
    expect(afterForget.map((r) => r.text)).toContain(MATCH); // A still valid
    expect(afterForget.map((r) => r.text)).not.toContain(FAR); // B superseded ⇒ excluded

    // T1.3 — asOf point-in-time: at an instant between t_valid and t_invalid, B is valid ⇒ resurfaces.
    const bt = await pool.query<{ t_valid: string; t_invalid: string }>(
      `SELECT t_valid, t_invalid FROM memories WHERE id = $1`,
      [bId as string],
    );
    const tValid = new Date(bt.rows[0]!.t_valid).getTime();
    const tInvalid = new Date(bt.rows[0]!.t_invalid).getTime();
    expect(tInvalid).toBeGreaterThan(tValid); // sanity: forget set a later t_invalid
    const mid = new Date((tValid + tInvalid) / 2);

    const asOfExpanded = await user.recall(QUERY, { topK: 10, threshold: 0.1, graphExpand: {}, asOf: mid });
    expect(asOfExpanded.map((r) => r.text)).toContain(FAR); // valid at `mid` ⇒ resurfaces
  }, 60_000);
});
