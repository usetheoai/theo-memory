/**
 * T3.1 — END-TO-END REST list endpoint returns real DB created_at per row.
 *
 * Path C composition discipline (per plan v1.2 absorption from /deps-audit):
 * composes Memory via `createLocalMemory({ vectorStore, embedder, llm })` with
 * an inline 384-dim ConstantEmbedder + DeterministicStubLLM. NEVER uses
 * `wireMemoryFromPool` which would pull `@xenova/transformers` → `onnxruntime-web`
 * → `protobufjs <7.5.5` CRITICAL CVSS 9.8 RCE chain into the test runtime.
 *
 * Honest TDD note (regression-sentinel pattern):
 * The chain RED was exercised at unit level during T2.1 (3 RED tests against
 * PgvectorStore.list) and T2.2 (5 RED tests against InMemoryVectorStore + getAll).
 * T3.1 is the END-TO-END integration sentinel locking the contract delivered by
 * T2.1+T2.2 (commits cf17aee + cea60b9). Per Inquebrável Rule 3 honesty: T3.1
 * GREENs on first run because the chain is now correct end-to-end.
 *
 * SEPA-honored design locks:
 * - Inline 384-dim Constant embedder (CRIT-1 — DeterministicStubEmbedder produces 1536, not 384)
 * - new DeterministicStubLLM() (CRIT-2 — stubLLM([]) does not exist)
 * - In-process app.fetch(Request) (MAJ-1 — no real HTTP server / port collision)
 * - PG_URI gate + TRUNCATE per test (MAJ-2)
 * - r1[0]!.id NOT r1.items[0].id (MAJ-3 — remember returns readonly MemoryItem[])
 *
 * EC-3 absorption (canonical write path): scoped.remember(text, {infer: false})
 * drives the 8-phase pipeline + INSERT honoring NOT NULL embedding/payload/hash
 * UNIQUE per scope. Direct SQL is used ONLY for the temporal UPDATE
 * (controlled timestamp manipulation that scoped.remember itself can't express).
 *
 * @see tests/integration/pgvector-store-list-temporal.test.ts (sibling sentinel for the SQL layer)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import type { Embedder } from '@usetheo/memory';
import { DeterministicStubLLM } from '@usetheo/memory/llms/stub';
import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

/** Default 1536-dim for shared DB — avoids dim-change conflicts in parallel. */
const EMBEDDING_DIM = 1536;

/** Inline 1536-dim Constant embedder for shared DB compatibility. */
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

describe.skipIf(PG_URI === '')('T3.1 — REST list temporal fidelity end-to-end', () => {
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

  test('REST list returns real DB created_at per row (NOT now() — themory-issue-4 regression sentinel)', async () => {
    // Given: 2 memories inserted via CANONICAL write path (EC-3 absorption).
    // scoped.remember() with infer:false bypasses LLM extraction and persists
    // text verbatim through the 8-phase pipeline, honoring all schema constraints
    // (NOT NULL embedding/payload/hash UNIQUE per scope).
    const scoped = (await createLocalMemoryForTest()).user('alice');
    const r1 = await scoped.remember('hello', { infer: false });
    const r2 = await scoped.remember('world', { infer: false });
    const id1 = r1[0]?.id;
    const id2 = r2[0]?.id;
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();

    // Direct SQL for the TEMPORAL UPDATE only — scoped.remember can't set custom
    // created_at; we need controlled timestamps to assert the fidelity contract.
    await pool.query(`UPDATE memories SET created_at = $1 WHERE id = $2`, [
      new Date('2026-01-01T10:00:00Z'),
      id1,
    ]);
    await pool.query(`UPDATE memories SET created_at = $1 WHERE id = $2`, [
      new Date('2026-01-02T20:00:00Z'),
      id2,
    ]);

    // When: REST list invoked end-to-end via in-process app.fetch.
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories'),
    );

    // Then: BOTH rows projected with createdAt matching UPDATEd values.
    // T2.1 ORDER BY created_at DESC means newer row (2026-01-02) at index 0.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; createdAt: string }[];
      nextCursor?: string;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.createdAt).toBe('2026-01-02T20:00:00.000Z');
    expect(body.items[1]?.createdAt).toBe('2026-01-01T10:00:00.000Z');
    // Confidence: assert they're NOT identical (would prove the pre-fix now() bug returned).
    expect(body.items[0]?.createdAt).not.toBe(body.items[1]?.createdAt);
  });

  /**
   * Helper: composes Memory via Path C primitives. Returns a fresh Memory per call
   * so the test can scope its remember() calls without sharing state.
   * Wraps the same composition used in beforeAll — but per-test instances avoid
   * order-of-test coupling per testing.md § Determinism.
   */
  async function createLocalMemoryForTest() {
    const vectorStore = new PgvectorStore(pool);
    return createLocalMemory({
      vectorStore,
      embedder: ConstantEmbedder,
      llm: new DeterministicStubLLM(),
    });
  }
});
