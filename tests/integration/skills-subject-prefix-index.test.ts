/**
 * GOAL test (skills-subject-prefix-index M2 / SEC-1) — prove the cross-repo
 * skills prefix query is served by a `text_pattern_ops` index range scan,
 * NOT a Seq Scan over the shared `workspace_id='default'` partition.
 *
 * Two assertions, both vs real `ankane/pgvector:v0.5.1`:
 *   1. STRUCTURAL — the shipped index `idx_memories_skill_subject_prefix` uses
 *      the `text_pattern_ops` opclass on `agent_id` (read from `pg_indexes.indexdef`).
 *      Collation-independent: inspects the artifact, not the planner (EC-3).
 *   2. BEHAVIORAL — `EXPLAIN` of the exact cross-repo WHERE, under
 *      `enable_seqscan = off`, shows an `Index Cond` scan on the new index and
 *      NOT a `Seq Scan on memories`. The LIKE pattern is a LITERAL constant so
 *      the planner sees the prefix at plan time (EC-1: a bound `$param` could
 *      build a generic plan with no `Index Cond`). `enable_seqscan = off` makes
 *      the proof non-vacuous on a tiny seeded table (EC-2/EC-3).
 *
 * Production note (EC-4): `listSkillsBySubject` uses `pool.query(sql, params)`
 * (unnamed extended-protocol statement → custom plan per call), so the bound
 * `'{subject}:%'` value is known at plan time on every real call → the index is
 * used in production too, not only under the literal-pattern EXPLAIN.
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 * @see .claude/knowledge-base/plans/skills-subject-prefix-index-plan.md § T1.1
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_skills_subject_prefix_index';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;
const INDEX_NAME = 'idx_memories_skill_subject_prefix';

function craftedVec(text: string): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  v[(text.charCodeAt(0) || 0) % DIM] = 1;
  return v;
}

function craftedEmbedder(): Embedder {
  return {
    embed: async (t: string) => craftedVec(t),
    embedBatch: async (texts: readonly string[]) => texts.map((t) => craftedVec(t)),
  };
}

function stubLlm(): LLM {
  return {
    generateResponse: async () => ({ memory: [] }),
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

describe.skipIf(ROOT_PG_URI === '')('skills-subject-prefix-index GOAL — text_pattern_ops index serves the cross-repo prefix', () => {
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

    // A few real skills via the public API (the production write path).
    await memory.skills('alice:repo-a').add({ code: 'a1', description: 'alpha parser util', codeLanguage: 'typescript' });
    await memory.skills('alice:repo-b').add({ code: 'b1', description: 'beta csv loader', codeLanguage: 'typescript' });

    // Bulk-seed VOLUME so the behavioral EXPLAIN is deterministic and NON-VACUOUS:
    // on a tiny table the cost-based planner picks any index, masking usability.
    // ~2000 skill rows under workspace_id='default' (the shared partition that
    // holds every tenant under the gateway master key), of which only ~40 match
    // the `alice:%` prefix → the selective partial `text_pattern_ops` index is
    // unambiguously the cheapest path. This is exactly the SEC-1 "at scale"
    // scenario. ANALYZE gives the planner real stats. Raw INSERT (not the embed
    // pipeline) keeps it fast; the embedding value is irrelevant to a btree scan.
    await pool.query(`
      INSERT INTO memories (text, hash, embedding, payload, workspace_id, agent_id, kind, description, code, code_language)
      SELECT 'skill text ' || g,
             md5('skill-seed-' || g::text),
             '[1,0,0,0,0,0,0,0]'::vector,
             '{}'::jsonb,
             'default',
             CASE WHEN g % 50 = 0 THEN 'alice:repo-bulk' ELSE 'noise' || g::text || ':repo-x' END,
             'skill',
             'bulk description ' || g,
             'bulk code ' || g,
             'typescript'
      FROM generate_series(1, 2000) AS g
    `);
    await pool.query('ANALYZE memories');
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('ships idx_memories_skill_subject_prefix with the text_pattern_ops opclass on agent_id (structural)', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
      [INDEX_NAME],
    );
    expect(rows.length).toBe(1);
    const def = rows[0]?.indexdef ?? '';
    expect(def).toContain('text_pattern_ops');
    expect(def).toContain('agent_id');
    expect(def).toContain('workspace_id');
  });

  it('serves the cross-repo prefix query via an index range scan, not a Seq Scan (behavioral)', async () => {
    const client = await pool.connect();
    try {
      // Force the planner to reveal index usability regardless of table size.
      await client.query('SET enable_seqscan = off');
      // LITERAL prefix constant (EC-1): the planner must see the prefix at plan
      // time to rewrite LIKE into an index range. Controlled test value.
      const explain = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM memories
           WHERE t_invalid IS NULL AND kind = 'skill'
             AND workspace_id = 'default' AND agent_id LIKE 'alice:%'`,
      );
      const plan = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain(INDEX_NAME);
      expect(plan).toMatch(/Index Cond/);
      expect(plan).not.toMatch(/Seq Scan on memories/);
    } finally {
      client.release();
    }
  });
});
