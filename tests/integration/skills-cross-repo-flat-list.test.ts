/**
 * GOAL test (skills-cross-repo-flat-list T3.1) — tenant-safe cross-repo skills
 * listing against real `ankane/pgvector:v0.5.1`.
 *
 * Seeds skills under the gateway's `{subject}:{repoId}` agent_id namespacing:
 * `alice:repo-a` (2) + `alice:repo-b` (1) + `bob:repo-c` (1). A flat list for
 * subject `alice` MUST return EXACTLY the 3 alice skills (correct per-row
 * `repoId`) and NONE of bob's — tenant isolation enforced by the `agent_id`
 * prefix scan (ADR D1), proven on the real DB (Princípio 3).
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_skills_cross_repo_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

function craftedVec(text: string): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  // deterministic non-zero vector keyed by first char (skills listing does not
  // rank by similarity — any valid embedding works).
  v[(text.charCodeAt(0) || 0) % DIM] = 1;
  return v;
}

function craftedEmbedder(): Embedder {
  return {
    embed: async (t: string) => craftedVec(t),
    embedBatch: async (texts: readonly string[]) => texts.map((t) => craftedVec(t)),
  };
}

/** Skills do not invoke the LLM on add; provide a minimal stub for the factory. */
function stubLlm(): LLM {
  return {
    generateResponse: async () => ({ memory: [] }),
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

describe.skipIf(ROOT_PG_URI === '')('skills-cross-repo-flat-list GOAL — tenant-isolated cross-repo listing', () => {
  let pool: pg.Pool;
  let memory: Memory;

  beforeAll(async () => {
    const adminPool = new pg.Pool({ connectionString: ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres') });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: DIM });
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    memory = await createLocalMemory({ vectorStore, embedder: craftedEmbedder(), llm: stubLlm(), embeddingDim: DIM });

    // Gateway namespaces repo as `{subject}:{repoId}` → agent_id.
    await memory.skills('alice:repo-a').add({ code: 'a1', description: 'alpha parser util', codeLanguage: 'typescript' });
    await memory.skills('alice:repo-a').add({ code: 'a2', description: 'alpha writer util', codeLanguage: 'typescript' });
    await memory.skills('alice:repo-b').add({ code: 'b1', description: 'beta csv loader', codeLanguage: 'typescript' });
    await memory.skills('bob:repo-c').add({ code: 'c1', description: 'gamma retry helper', codeLanguage: 'typescript' });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('lists exactly the subject skills across repos with correct repoId, isolating other tenants', async () => {
    const page = await memory.listSkillsBySubject('alice');
    expect(page.total).toBe(3);
    expect(page.skills.length).toBe(3);
    expect(new Set(page.skills.map((s) => s.repoId))).toEqual(new Set(['repo-a', 'repo-b']));
    // bob's skill must NOT leak
    expect(page.skills.some((s) => s.repoId === 'repo-c')).toBe(false);
    expect(page.skills.some((s) => s.description.includes('gamma'))).toBe(false);
    expect(page.skills.every((s) => s.kind === 'skill')).toBe(true);
  });

  it('a strict-prefix subject does not leak (the ":" delimiter prevents overlap)', async () => {
    await memory.skills('al:repo-x').add({ code: 'x', description: 'short prefix skill', codeLanguage: 'typescript' });
    const page = await memory.listSkillsBySubject('al');
    expect(page.total).toBe(1);
    expect(page.skills[0]?.repoId).toBe('repo-x');
    expect(page.skills.some((s) => s.description.includes('alpha'))).toBe(false);
  });

  it('empty subject scope returns [] with total 0', async () => {
    const page = await memory.listSkillsBySubject('nobody');
    expect(page).toEqual({ skills: [], total: 0 });
  });

  it('q filter narrows by description; offset/limit paginate', async () => {
    const filtered = await memory.listSkillsBySubject('alice', { q: 'csv' });
    expect(filtered.total).toBe(1);
    expect(filtered.skills[0]?.repoId).toBe('repo-b');

    const first = await memory.listSkillsBySubject('alice', { limit: 2, offset: 0 });
    expect(first.skills.length).toBe(2);
    expect(first.total).toBe(3);
    const second = await memory.listSkillsBySubject('alice', { limit: 2, offset: 2 });
    expect(second.skills.length).toBe(1);
    expect(second.total).toBe(3);
    // offset beyond the end → empty page, real total preserved
    const beyond = await memory.listSkillsBySubject('alice', { limit: 2, offset: 99 });
    expect(beyond.skills).toEqual([]);
    expect(beyond.total).toBe(3);
  });

  it('LIKE-wildcard subject does not broaden the match (escaped)', async () => {
    // subject 'alice%' must NOT match 'alice:...' rows (the % is escaped to a literal).
    const page = await memory.listSkillsBySubject('alice%');
    expect(page.total).toBe(0);
  });
});
