/**
 * skills-write-surface T2.4 — real-pgvector proof for the skills WRITE surface.
 *
 * Drives the REST handlers (POST/DELETE) via `createServer` against real
 * `ankane/pgvector:v0.5.1`:
 *   1. POST a skill -> 201; GET listing shows it
 *   2. POST the same description -> 409 (dedup-collision, D1)
 *   3. DELETE -> 204; GET listing no longer shows it
 *   4. EC-W2: two concurrent identical POSTs -> exactly one 201 + one 409
 *   5. EC-W3: DELETE of a non-skill memory id -> 404 (scope-isolated forget)
 *
 * Gated by THEOMEM_PG_URI (EC-17: CI=true with absent env fails loudly).
 *
 * @see .claude/knowledge-base/plans/skills-write-surface-plan.md § T2.4
 */
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Embedder } from '@usetheo/memory';
import { createLocalMemory, PgvectorStore, StubLLM } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
  throw new Error('EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/skills/** to run');
}

function descriptionVector(description: string): readonly number[] {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  let h = 0;
  for (let i = 0; i < description.length; i += 1) {
    h = (h * 31 + description.charCodeAt(i)) >>> 0;
  }
  v[h % 64] = 1;
  return v;
}

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async (text: string) => descriptionVector(text)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map((t) => descriptionVector(t))),
});

const VALID = { code: 'export const deploy = () => {};', description: 'deploy the service', codeLanguage: 'typescript' };

function postReq(repoId: string, body: unknown): Request {
  return new Request(`http://localhost/v1/scopes/skill/${repoId}/skills`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('skills write surface (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, history CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  async function buildApp() {
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: fixedEmbedder(),
      llm: new StubLLM(),
    });
    return createServer({ memory });
  }

  describe('skills-write-surface T2.4 — POST/DELETE against real pgvector', () => {
    test('POST 201 -> listing shows it; duplicate description -> 409; DELETE 204 -> gone', async () => {
      const app = await buildApp();

      const created = await app.fetch(postReq('repo-acme', VALID));
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string; hash: string };
      expect(typeof id).toBe('string');

      const list1 = await app.fetch(new Request('http://localhost/v1/scopes/skill/repo-acme/skills'));
      const body1 = (await list1.json()) as { skills: { id: string; description: string }[] };
      expect(body1.skills.map((s) => s.id)).toContain(id);

      // D1 — same description collides on UNIQUE(hash) -> 409.
      const dup = await app.fetch(postReq('repo-acme', { ...VALID, code: 'different code' }));
      expect(dup.status).toBe(409);

      const del = await app.fetch(
        new Request(`http://localhost/v1/scopes/skill/repo-acme/skills/${id}`, { method: 'DELETE' }),
      );
      expect(del.status).toBe(204);

      const list2 = await app.fetch(new Request('http://localhost/v1/scopes/skill/repo-acme/skills'));
      const body2 = (await list2.json()) as { skills: { id: string }[] };
      expect(body2.skills.map((s) => s.id)).not.toContain(id);
    });

    test('EC-W2: two concurrent identical POSTs -> exactly one 201 and one 409', async () => {
      const app = await buildApp();
      const [a, b] = await Promise.all([
        app.fetch(postReq('repo-acme', VALID)),
        app.fetch(postReq('repo-acme', { ...VALID, code: 'race code' })),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
    });

    test('EC-W3: DELETE of a non-skill memory id -> 404 (scope-isolated forget)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: new StubLLM(),
      });
      const app = createServer({ memory });
      // Create a plain user memory (kind != skill) verbatim.
      const userMems = await memory.user('alice').remember('a plain user fact', { infer: false });
      const userMemId = userMems[0]?.id;
      expect(typeof userMemId).toBe('string');

      const del = await app.fetch(
        new Request(`http://localhost/v1/scopes/skill/repo-acme/skills/${userMemId as string}`, {
          method: 'DELETE',
        }),
      );
      expect(del.status).toBe(404);
    });
  });
}
