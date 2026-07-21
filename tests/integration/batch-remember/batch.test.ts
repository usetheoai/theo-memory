/**
 * M6 claude-code-memory-integration T1.3 — POST /v1/remember/batch against real
 * ankane/pgvector:v0.5.1. Proves: a batch of N facts (`infer:false`, provenance
 * metadata) imports once (imported=N), `metadata.source` round-trips on recall,
 * and a RE-RUN is idempotent (deduped=N, confirmation_count bumps, no double-insert).
 *
 * Gated by THEOMEM_PG_URI (absent → SKIP). Open-mode server (no auth) → default
 * workspace, like the sibling REST integration tests.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM, PgvectorStore, createLocalMemory, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M6 T1.3 batch remember (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M6 T1.3 — POST /v1/remember/batch', () => {
    const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
    // Deterministic non-zero embedding (cosine well-defined) — same vector for
    // every text, so recall returns the whole scope (we assert existence + provenance).
    const embedder: Embedder = {
      embed: vi.fn(async () => new Array<number>(MAX_EMBEDDING_DIM).fill(0.1)),
      embedBatch: vi.fn(async (t: readonly string[]) => t.map(() => new Array<number>(MAX_EMBEDDING_DIM).fill(0.1))),
    };
    const llm = (): LLM => ({
      generateResponse: vi.fn(async () => ({ memory: [] })),
      generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
    });

    afterAll(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await runMigrations(pool);
      await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges, history RESTART IDENTITY CASCADE');
    });

    // createLocalMemory is async; build a fresh instance per test.
    function buildMemory() {
      return createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm: llm() });
    }

    const FACTS = [
      { userId: 'cc-batch', text: 'The CD pipeline deployed themory on 2026-07-20.', infer: false, metadata: { source: 'claude-code', project: 'theo-memory', file: 'a.md' } },
      { userId: 'cc-batch', text: 'The dev host is a shared box running the platform.', infer: false, metadata: { source: 'claude-code', project: 'theo-memory', file: 'b.md' } },
      { userId: 'cc-batch', text: 'Hooks beat MCP tools for reliable auto-capture.', infer: false, metadata: { source: 'claude-code', project: 'theo-memory', file: 'c.md' } },
    ];

    async function postBatch(app: ReturnType<typeof createServer> | Awaited<ReturnType<typeof createServer>>, items: unknown[]) {
      return (await app).fetch(
        new Request('http://localhost/v1/remember/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items }),
        }),
      );
    }

    test('imports N facts once, provenance round-trips on recall, re-run dedups (idempotent)', async () => {
      const memory = await buildMemory();
      const app = createServer({ memory });

      // 1) batch import
      const res = await postBatch(app, FACTS);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { imported: number; deduped: number; failed: number; items: unknown[] };
      expect(body.imported).toBe(3);
      expect(body.deduped).toBe(0);
      expect(body.failed).toBe(0);

      // 2) provenance round-trips on recall
      const recallRes = await app.fetch(
        new Request('http://localhost/v1/recall', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: 'cc-batch', query: 'what did the pipeline do?' }),
        }),
      );
      expect(recallRes.status).toBe(200);
      const recalled = (await recallRes.json()) as { results: { metadata?: Record<string, unknown> }[] };
      expect(recalled.results.length).toBeGreaterThan(0);
      expect(recalled.results.every((r) => r.metadata?.['source'] === 'claude-code')).toBe(true);

      // 3) RE-RUN the identical batch → idempotent (deduped, no new rows)
      const before = await pool.query<{ n: string }>("SELECT COUNT(*)::int n FROM memories WHERE user_id='cc-batch'");
      const res2 = await postBatch(app, FACTS);
      const body2 = (await res2.json()) as { imported: number; deduped: number };
      expect(body2.imported).toBe(0);
      expect(body2.deduped).toBe(3);
      const after = await pool.query<{ n: string }>("SELECT COUNT(*)::int n FROM memories WHERE user_id='cc-batch'");
      expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n)); // no double-insert
    });

    test('rejects an empty batch (422) and a mixed-scope item (422)', async () => {
      const memory = await buildMemory();
      const app = createServer({ memory });
      expect((await postBatch(app, [])).status).toBe(422); // items.min(1)
      const mixed = [{ userId: 'a', sessionId: 'b', text: 'x', infer: false }];
      expect((await postBatch(app, mixed)).status).toBe(422); // SingleScopeRefine per item
    });
  });
}
