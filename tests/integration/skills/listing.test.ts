/**
 * dashboard-phase2b-skills-browse T2.2 — real-pgvector proof for the read-only
 * skills listing (`ScopedSkillMemory.getAll`).
 *
 * Proves the listing against real `ankane/pgvector:v0.5.1`:
 *   1. add 2 skills to a repo → getAll() returns both with hash+description+code
 *   2. supersede one → getAll() default excludes it; includeSuperseded includes it
 *   3. cross-repo isolation — repoA.getAll() never returns a repoB skill
 *
 * Closes the T1.1 Medium risk: decodeSkillPayload over VectorStore.list output
 * must project the skill columns correctly against the REAL store (the same
 * class of latent bug the Phase 2A entities/metrics work surfaced).
 *
 * Gated by THEOMEM_PG_URI (EC-17: CI=true with absent env fails loudly).
 *
 * @see .claude/knowledge-base/plans/dashboard-phase2b-skills-browse-plan.md § T2.2
 */
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Embedder } from '@usetheo/memory';
import { createLocalMemory, PgvectorStore, StubLLM } from '@usetheo/memory';

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

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('skills getAll listing (THEOMEM_PG_URI not set)', () => {
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

  describe('dashboard-phase2b-skills-browse T2.2 — getAll() against real pgvector', () => {
    test('lists the repo skills with hash + description + code', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: new StubLLM(),
      });
      const skills = memory.skills('repo-acme');
      const a = await skills.add({
        code: 'export const deploy = () => {};',
        description: 'deploy the service',
        codeLanguage: 'typescript',
      });
      const b = await skills.add({
        code: 'export const rollback = () => {};',
        description: 'rollback the service',
        codeLanguage: 'typescript',
      });

      const all = await skills.getAll();

      const ids = all.map((s) => s.id).sort();
      expect(ids).toEqual([a.id, b.id].sort());
      const deploy = all.find((s) => s.id === a.id);
      expect(deploy?.hash).toBe(a.hash);
      expect(deploy?.description).toBe('deploy the service');
      expect(deploy?.code).toBe('export const deploy = () => {};');
      expect(deploy?.codeLanguage).toBe('typescript');
      expect(deploy?.kind).toBe('skill');
    });

    test('superseded skills are excluded by default, included with includeSuperseded', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: new StubLLM(),
      });
      const store = new PgvectorStore(pool);
      const skills = memory.skills('repo-acme');
      const head = await skills.add({
        code: 'new',
        description: 'deploy strategy head',
        codeLanguage: 'typescript',
      });
      const old = await skills.add({
        code: 'old',
        description: 'deploy strategy old',
        codeLanguage: 'typescript',
      });
      await store.markSuperseded([old.id], head.id);

      const headOnly = await skills.getAll();
      expect(headOnly.map((s) => s.id)).toContain(head.id);
      expect(headOnly.map((s) => s.id)).not.toContain(old.id);

      const withSuperseded = await skills.getAll({ includeSuperseded: true });
      expect(withSuperseded.map((s) => s.id)).toContain(old.id);
    });

    test('F-1: getAll returns the STORED created_at, not the decode-time now()', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: new StubLLM(),
      });
      const skills = memory.skills('repo-acme');
      const a = await skills.add({
        code: 'x',
        description: 'a skill with a known past creation time',
        codeLanguage: 'typescript',
      });
      // Force a known PAST created_at directly in the store. The OLD buggy
      // getAll (decodeSkillPayload hardcoded new Date()) would return ~now;
      // the fixed getAll must return this stored value.
      await pool.query(`UPDATE memories SET created_at = $1 WHERE id = $2`, [
        '2020-01-02T03:04:05.000Z',
        a.id,
      ]);

      const all = await skills.getAll();
      const found = all.find((s) => s.id === a.id);
      expect(found?.createdAt.toISOString()).toBe('2020-01-02T03:04:05.000Z');
    });

    test('cross-repo isolation — repoA.getAll() never returns a repoB skill', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: new StubLLM(),
      });
      const alpha = memory.skills('repo-alpha');
      const beta = memory.skills('repo-beta');
      const alphaSkill = await alpha.add({
        code: 'a',
        description: 'alpha-only skill',
        codeLanguage: 'typescript',
      });
      await beta.add({ code: 'b', description: 'beta-only skill', codeLanguage: 'typescript' });

      const fromAlpha = await alpha.getAll();
      expect(fromAlpha.map((s) => s.id)).toEqual([alphaSkill.id]);
    });
  });
}
