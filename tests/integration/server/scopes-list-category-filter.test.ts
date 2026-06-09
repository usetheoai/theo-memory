/**
 * T4.1 — END-TO-END REST list endpoint honors the optional `?category=` filter.
 *
 * Composes Memory via Path C primitives (Constant384 embedder + DeterministicStubLLM)
 * to keep `@xenova/transformers` out of the test runtime — same precedent as
 * scopes-list-temporal-fidelity.test.ts.
 *
 * Eight scenarios per plan v1.2 TDD:
 *   1. ?category=a returns filtered subset (3 rows [a,a,b] → 2)
 *   2. category > 64 chars → 422 INVALID_QUERY
 *   3. empty category param → 422 INVALID_QUERY (zod min(1))
 *   4. category that matches NO row → 200 with items=[]
 *   5. no category param → 200 with ALL rows (backward compat)
 *   6. category + limit pagination — limit=2, category=a → 2 items + nextCursor
 *   7. EC-7 cursor + changed category does NOT throw (graceful subset OR empty)
 *   8. EC-3 SDK boundary — LocalScopedMemory.getAll({category:''}) equivalent to no-filter
 *
 * @see .claude/knowledge-base/plans/themory-category-filter-server-side-plan.md § T4.1 + EC-3 + EC-7
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import type { Embedder } from '../../../src/core/dip/embedder.js';
import { DeterministicStubLLM } from '../../../src/llms/stub.js';
import { createLocalMemory, PgvectorStore, runMigrations } from '../../../src/local/index.js';
import { createServer } from '../../../src/server/index.js';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const EMBEDDING_DIM = 384;

const Constant384Embedder: Embedder = {
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

describe.skipIf(PG_URI === '')('T4.1 — REST scopes list category filter end-to-end', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createServer>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let memory: any;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await runMigrations(pool, { embeddingDim: EMBEDDING_DIM });
    const vectorStore = new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM });
    memory = await createLocalMemory({
      vectorStore,
      embedder: Constant384Embedder,
      llm: new DeterministicStubLLM(),
      embeddingDim: EMBEDDING_DIM,
    });
    app = createServer({ memory });
  }, 30_000);

  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed(rows: ReadonlyArray<{ text: string; cat?: string }>): Promise<void> {
    const scoped = memory.user('alice');
    for (const row of rows) {
      const opts: { infer: false; category?: string } = { infer: false };
      if (row.cat !== undefined) opts.category = row.cat;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await scoped.remember(row.text, opts);
    }
  }

  test('1. ?category=a returns filtered subset (3 rows [a,a,b] → 2)', async () => {
    await seed([
      { text: 'one', cat: 'a' },
      { text: 'two', cat: 'a' },
      { text: 'three', cat: 'b' },
    ]);

    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?category=a'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; text: string }[] };
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i) => i.text).sort()).toEqual(['one', 'two']);
  });

  test('2. category > 64 chars → 422 INVALID_QUERY', async () => {
    const tooLong = 'x'.repeat(65);
    const res = await app.fetch(
      new Request(
        `http://localhost/v1/scopes/user/alice/memories?category=${encodeURIComponent(tooLong)}`,
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_QUERY');
  });

  test('3. empty ?category= → 422 INVALID_QUERY (zod min(1))', async () => {
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?category='),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_QUERY');
  });

  test('4. category matches NO row → 200 with items=[]', async () => {
    await seed([{ text: 'one', cat: 'a' }]);
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?category=does-not-exist'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  test('5. no ?category= → 200 with ALL rows (backward compat)', async () => {
    await seed([
      { text: 'a', cat: 'x' },
      { text: 'b', cat: 'y' },
      { text: 'c' }, // no category
    ]);
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(3);
  });

  test('6. category + limit pagination — limit=2, category=a → 2 items + nextCursor', async () => {
    await seed([
      { text: 'one', cat: 'a' },
      { text: 'two', cat: 'a' },
      { text: 'three', cat: 'a' },
      { text: 'other', cat: 'b' },
    ]);
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?category=a&limit=2'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string }[];
      nextCursor?: string;
    };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeDefined();
  });

  test('7. EC-7 — cursor + changed category does NOT throw (graceful empty OR coherent subset)', async () => {
    await seed([
      { text: 'a1', cat: 'a' },
      { text: 'a2', cat: 'a' },
      { text: 'b1', cat: 'b' },
    ]);
    // First page with category=a + small limit produces a cursor.
    const page1 = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?category=a&limit=1'),
    );
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as { items: unknown[]; nextCursor?: string };
    expect(body1.items).toHaveLength(1);

    // Same cursor, DIFFERENT category=b. Must NOT throw; returns whatever the
    // cursor-then-filter pipeline produces (consumer error documented per EC-7).
    const cursor = body1.nextCursor;
    if (cursor !== undefined) {
      const page2 = await app.fetch(
        new Request(
          `http://localhost/v1/scopes/user/alice/memories?category=b&cursor=${encodeURIComponent(cursor)}`,
        ),
      );
      expect(page2.status).toBe(200);
      // Response shape is preserved (items array present), value-of-items
      // is consumer-error territory — could be 0 or 1 b-row depending on
      // cursor ordering. The contract is "no throw + 200".
      const body2 = (await page2.json()) as { items: unknown[] };
      expect(Array.isArray(body2.items)).toBe(true);
    }
  });

  test('8. EC-3 SDK boundary — getAll({category:""}) equivalent to no-filter', async () => {
    await seed([
      { text: 'a', cat: 'x' },
      { text: 'b', cat: 'y' },
      { text: 'c' },
    ]);
    // Direct SDK call (bypasses REST zod). Empty string MUST behave as no-filter.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const empty = await memory.user('alice').getAll({ category: '' });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const undef = await memory.user('alice').getAll();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    expect(empty.length).toBe(undef.length);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(empty.length).toBe(3);
  });
});
