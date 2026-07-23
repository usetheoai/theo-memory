/**
 * M13 T3.1 integration — reextract engine vs real pgvector (deterministic LLM stub).
 *
 * Mirrors the graphiti test regime (blueprint Q7): LLM STUB + REAL DB for the
 * merge/supersede mechanics, exact-equality asserts. Covers the plan's EC-1
 * (scope inheritance), EC-3 (existing semantic identity) and the E2E supersede.
 *
 * TRUNCATEs shared tables — run sequentially with the other entity suites.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { runMigrations, PgMemoryEntityStore, PgMemoryGraphStore } from '@usetheo/memory';
import type { LLM } from '@usetheo/memory';

import { runReextract, type ReextractOptions } from '../../packages/cli/src/reextract/engine.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const DIM = 1536;
const ZERO_VEC = `[${new Array(DIM).fill(0).join(',')}]`;

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('reextract engine (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const entityStore = new PgMemoryEntityStore(pool);
  const graphStore = new PgMemoryGraphStore(pool);
  const embedder = {
    embed: async () => new Array<number>(DIM).fill(0.1),
    embedBatch: async (t: readonly string[]) => t.map(() => new Array<number>(DIM).fill(0.1)),
  };

  function stubLlm(entities: readonly { name: string; type: string }[]): LLM {
    return {
      generateResponse: vi.fn(async () => ({ memory: [], entities })),
      generateChat: vi.fn(),
    } as unknown as LLM;
  }

  function opts(overrides: Partial<ReextractOptions> = {}): ReextractOptions {
    return { dryRun: false, resume: false, concurrency: 2, chunkSize: 25, chunkMaxBytes: 512 * 1024, ...overrides };
  }

  function freshCheckpoint(): string {
    return join(mkdtempSync(join(tmpdir(), 'reextract-int-')), 'cp.json');
  }

  async function seedMemory(scope: { user?: string; session?: string }, text: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO memories (id, text, hash, embedding, payload, workspace_id, user_id, session_id)
       VALUES ($1,$2,$3,$4::vector,'{}'::jsonb,'ws1',$5,$6)`,
      [id, text, randomUUID(), ZERO_VEC, scope.user ?? null, scope.session ?? null],
    );
    return id;
  }

  async function seedLinkedEntity(memoryId: string, name: string, type: string, user: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO entities (name, embedding, payload, workspace_id, user_id, type, normalized_key)
       VALUES ($1,$2::vector,'{}','ws1',$3,$4,$5) RETURNING id`,
      [name, ZERO_VEC, user, type, name.toLowerCase().replace(/\s+/g, '_')],
    );
    const id = rows[0]!.id;
    await pool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1,$2)`, [memoryId, id]);
    return id;
  }

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges RESTART IDENTITY CASCADE');
  });

  describe('reextract engine E2E (T3.1)', () => {
    test('test_reextract_end_to_end_supersedes_mechanism_entities', async () => {
      // Given a memory linked to the mechanism-labeled entity 'codex' (PROPER)
      const m1 = await seedMemory({ user: 'alice' }, 'Paulo reviewed the codex integration yesterday');
      const oldId = await seedLinkedEntity(m1, 'codex', 'PROPER', 'alice');

      // When the engine runs for real with an LLM stub emitting the semantic type
      const llm = stubLlm([{ name: 'codex', type: 'PRODUCT' }]);
      const deps = { pool, llm, embedder, memoryEntityStore: entityStore, memoryGraphStore: graphStore, checkpointPath: freshCheckpoint() };
      const report = await runReextract(deps, opts());

      // Then: a PRODUCT entity exists, OLD carries superseded_by, link repointed
      expect(report.processed).toBe(1);
      expect(report.entitiesSuperseded).toBe(1);
      const { rows: sem } = await pool.query<{ id: string; type: string }>(
        `SELECT id, type FROM entities WHERE normalized_key = 'codex' AND superseded_by IS NULL`,
      );
      expect(sem).toHaveLength(1);
      expect(sem[0]?.type).toBe('PRODUCT');
      const { rows: oldRow } = await pool.query<{ superseded_by: string | null }>(
        `SELECT superseded_by FROM entities WHERE id = $1`, [oldId]);
      expect(oldRow[0]?.superseded_by).toBe(sem[0]?.id);
      const { rows: links } = await pool.query<{ entity_id: string }>(
        `SELECT entity_id FROM memory_entities WHERE memory_id = $1`, [m1]);
      expect(links.map((l) => l.entity_id)).toContain(sem[0]?.id);
      expect(links.map((l) => l.entity_id)).not.toContain(oldId);

      // Re-run is a no-op: the memory has no mechanism links left (idempotent D3)
      const second = await runReextract({ ...deps, checkpointPath: freshCheckpoint() }, opts());
      expect(second.entitiesSuperseded).toBe(0);
    });

    test('test_reextracted_entity_inherits_source_memory_scope', async () => {
      // EC-1: SESSION-tier memory (ws1, alice, s1) → new entity carries EXACTLY that scope
      const m1 = await seedMemory({ user: 'alice', session: 's1' }, 'Session note about the Theo dashboard rollout');
      const llm = stubLlm([{ name: 'Theo dashboard', type: 'PRODUCT' }]);
      await runReextract(
        { pool, llm, embedder, memoryEntityStore: entityStore, memoryGraphStore: graphStore, checkpointPath: freshCheckpoint() },
        opts(),
      );
      const { rows } = await pool.query<{ workspace_id: string; user_id: string | null; session_id: string | null; agent_id: string | null }>(
        `SELECT workspace_id, user_id, session_id, agent_id FROM entities WHERE normalized_key = 'theo_dashboard'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ workspace_id: 'ws1', user_id: 'alice', session_id: 's1', agent_id: null });
      void m1;
    });

    test('test_supersede_targets_existing_semantic_identity', async () => {
      // EC-3: the semantic identity ALREADY exists via another memory → supersede
      // points at IT; the entity count never grows (no third row).
      const mOther = await seedMemory({ user: 'alice' }, 'Other memory that already produced the semantic row');
      const existingSemantic = await seedLinkedEntity(mOther, 'codex', 'PRODUCT', 'alice');
      const m1 = await seedMemory({ user: 'alice' }, 'Old memory still linked to the mechanism-labeled row');
      const oldId = await seedLinkedEntity(m1, 'codex', 'PROPER', 'alice');

      const llm = stubLlm([{ name: 'codex', type: 'PRODUCT' }]);
      const report = await runReextract(
        { pool, llm, embedder, memoryEntityStore: entityStore, memoryGraphStore: graphStore, checkpointPath: freshCheckpoint() },
        opts(),
      );
      expect(report.entitiesSuperseded).toBe(1);
      const { rows: all } = await pool.query<{ id: string }>(
        `SELECT id FROM entities WHERE normalized_key = 'codex'`,
      );
      expect(all).toHaveLength(2); // OLD + the pre-existing semantic row — never a third
      const { rows: oldRow } = await pool.query<{ superseded_by: string | null }>(
        `SELECT superseded_by FROM entities WHERE id = $1`, [oldId]);
      expect(oldRow[0]?.superseded_by).toBe(existingSemantic);
    });

    test('test_dry_run_writes_nothing_to_db', async () => {
      const m1 = await seedMemory({ user: 'alice' }, 'A memory without any graph at all today');
      const llm = stubLlm([{ name: 'Graphless', type: 'CONCEPT' }]);
      const report = await runReextract(
        { pool, llm, embedder, memoryEntityStore: entityStore, memoryGraphStore: graphStore, checkpointPath: freshCheckpoint() },
        opts({ dryRun: true }),
      );
      expect(report.targets).toBe(1);
      expect(report.llmCalls).toBe(0);
      const { rows } = await pool.query(`SELECT 1 FROM entities`);
      expect(rows).toHaveLength(0);
      void m1;
    });
  });
}
