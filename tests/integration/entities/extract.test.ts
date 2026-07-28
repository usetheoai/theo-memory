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
 * v0.10.1 item-2 fix (2026-06-20): the `infer:false` verbatim fast-path now ALSO
 * runs Phase 7 (shared linkEntities helper) — verbatim writes surface entities
 * too. The earlier KNOWN LIMITATION (Phase 7 ran on infer:true only) is closed;
 * `test('item-2: infer:false ...')` is the regression guard.
 *
 * Gated by THEOMEM_PG_URI.
 *
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
        llm: factLlm('I saw John Smith again today'),
      });
      await memory.user('alice').remember('I saw John Smith again today');

      // Read side: wire the port into the server.
      const app = createServer({ memory, memoryEntityStore: new PgMemoryEntityStore(pool) });
      const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entities: { id: string; memory_count: number }[] };
      const names = body.entities.map((e) => e.id);
      expect(names).toContain('John Smith');
      expect(body.entities.every((e) => e.memory_count >= 1)).toBe(true);
    });

    test('F-M4: two distinct memories both surface "John Smith" in the listing (multi-memory chain)', async () => {
      // Sequence-LLM: a clean controlled fact per call so each remember() persists
      // a DISTINCT memory (different hash) mentioning John Smith.
      const facts = ['I saw John Smith on Monday', 'I saw John Smith on Friday'];
      let call = 0;
      const seqLlm: LLM = {
        generateResponse: vi.fn(async () => {
          const text = facts[call] ?? facts[0];
          call += 1;
          return { memory: [{ id: '0', text }] };
        }),
        generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
      };
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: seqLlm,
      });
      await memory.user('carol').remember('I saw John Smith on Monday');
      await memory.user('carol').remember('I saw John Smith on Friday');

      const app = createServer({ memory, memoryEntityStore: new PgMemoryEntityStore(pool) });
      const res = await app.fetch(new Request('http://localhost/v1/scopes/user/carol/entities'));
      const body = (await res.json()) as { entities: { id: string; memory_count: number }[] };
      // "John Smith" is surfaced end-to-end across the two memories. The exact
      // dedup-to-one-row + memory_count contract is proven deterministically at
      // the store layer (list.test.ts) — asserting "exactly one row" HERE would be
      // brittle because the `compromise` POS tagger non-deterministically labels
      // "John Smith" PROPER vs COMPOUND across calls, and EC-1 (type-in-identity)
      // then keeps those as distinct nodes by design. The robust end-to-end
      // invariant is that John Smith surfaces and the two memories are accounted for.
      const jsNodes = body.entities.filter((e) => e.id === 'John Smith');
      expect(jsNodes.length).toBeGreaterThanOrEqual(1);
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(DISTINCT me.memory_id)::int AS n
           FROM memory_entities me JOIN entities e ON e.id = me.entity_id
          WHERE e.user_id='carol' AND e.normalized_key='john_smith'`,
      );
      expect(Number(rows[0]?.n)).toBe(2); // both memories linked to the John Smith node(s)
    });

    test('item-2: infer:false (verbatim) does NOT extract inline — graph comes from the reextract backfill', async () => {
      // Phase A D1 (multilingual-entity-extraction, upstream parity): the verbatim
      // path persists the raw text and runs NO inline entity extraction — the
      // 83%-noise incident came from the EN-only heuristic firing here. The
      // graph for verbatim/imported memories is produced by the M13
      // `themory reextract` backfill (tests/integration/reextract.test.ts).
      // This pin previously asserted the PRE-Phase-A behavior and had been
      // failing since D1 shipped; updated as part of M13 T1.1.
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: factLlm('unused on infer:false'),
      });
      await memory.user('dave').remember('I saw John Smith at Google', { infer: false });

      const app = createServer({ memory, memoryEntityStore: new PgMemoryEntityStore(pool) });
      const res = await app.fetch(new Request('http://localhost/v1/scopes/user/dave/entities'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entities: { id: string; memory_count: number }[] };
      const names = body.entities.map((e) => e.id);
      expect(names).not.toContain('John Smith');
    });

    test('negative: entityBoost:false persists zero entity rows', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: factLlm('John Smith works at Google'),
        entityBoost: false,
      });
      await memory.user('bob').remember('I saw John Smith again today');
      // Scoped to user_id='bob' — robust to other integration files sharing the DB.
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM entities WHERE user_id='bob'`,
      );
      expect(Number(rows[0]?.n)).toBe(0);
    });
  });
}
