/**
 * entity-extraction-nodes-slice1 T5.1 — THE GOAL TEST. Full chain vs real
 * `ankane/pgvector:v0.5.1`: remember() (infer:true, fact-returning LLM stub) →
 * Phase 7 extracts + persists entities → GET /v1/scopes/user/:id/entities returns
 * them through the wired read port.
 *
 * Covers EC-4: `createLocalMemory` defaults entityBoost ON (no port injected at
 * the factory — it wires CompromiseEntityExtractor + PgMemoryEntityStore itself),
 * AND the negative: `entityBoost: false` → zero entity rows.
 *
 * KNOWN LIMITATION (honest, Rule 3): Phase 7 runs on the infer:true write path
 * only; the `infer:false` verbatim fast-path returns before Phase 7 (pipeline.ts
 * :305). Surfacing entities from verbatim writes is a follow-up. The GOAL test
 * therefore exercises the infer:true path (the default remember()).
 *
 * Gated by THEOMEM_PG_URI.
 *
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T5.1
 */
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';
import { createLocalMemory, PgvectorStore, PgMemoryEntityStore, runMigrations } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'];

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async () => new Array<number>(MAX_EMBEDDING_DIM).fill(0)),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => new Array<number>(MAX_EMBEDDING_DIM).fill(0)),
  ),
});

// Fact-returning LLM stub so the infer:true write path persists a deterministic
// memory whose text Phase 7 then extracts entities from.
const factLlm = (text: string): LLM => ({
  generateResponse: vi.fn(async () => ({ memory: [{ id: '0', text }] })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('entities GOAL test (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities RESTART IDENTITY CASCADE');
  });

  describe('entity-extraction-nodes-slice1 T5.1 — GOAL test vs real pgvector', () => {
    test('EC-4 default-ON: remember() populates entities; GET /entities returns them', async () => {
      // No port injected → createLocalMemory wires the defaults because
      // entityBoost defaults ON AND the store is a PgvectorStore.
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: factLlm('John Smith works at Google'),
      });
      await memory.user('alice').remember('John Smith works at Google');

      // Read side: wire the port into the server.
      const app = createServer({ memory, memoryEntityStore: new PgMemoryEntityStore(pool) });
      const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entities: { id: string; memory_count: number }[] };
      const names = body.entities.map((e) => e.id);
      expect(names).toContain('John Smith');
      expect(body.entities.every((e) => e.memory_count >= 1)).toBe(true);
    });

    test('negative: entityBoost:false persists zero entity rows', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: factLlm('John Smith works at Google'),
        entityBoost: false,
      });
      await memory.user('bob').remember('John Smith works at Google');
      const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::int AS n FROM entities`);
      expect(Number(rows[0]?.n)).toBe(0);
    });
  });
}
