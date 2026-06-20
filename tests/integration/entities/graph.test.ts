/**
 * entity-relation-extraction-slice2 — PgMemoryGraphStore (T2.1) + GOAL (T4.1)
 * against real `ankane/pgvector:v0.5.1`.
 *
 * T2.1 store-layer proves: edges persist between resolved nodes; unresolvable
 * endpoints are skipped (no throw); `memoryCount = count(DISTINCT source_memory_id)`
 * aggregates across memories (EC-1); endpoint resolution is deterministic on a
 * duplicate normalized_key (EC-2, earliest node wins); concurrent same-triple
 * upsert yields ONE row (race).
 *
 * T4.1 GOAL proves the full chain: remember('John Smith works at Google') →
 * Phase 7 edge linking → GET /v1/scopes/user/:id/graph returns the edge.
 *
 * Gated by THEOMEM_PG_URI.
 *
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md § T2.1 + T4.1
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Embedder, LLM, Filters } from '@usetheo/memory';
import {
  createLocalMemory,
  PgvectorStore,
  PgMemoryEntityStore,
  PgMemoryGraphStore,
  runMigrations,
} from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'];
const ZERO_VEC = `[${new Array(MAX_EMBEDDING_DIM).fill(0).join(',')}]`;
const EMBED = new Array<number>(MAX_EMBEDDING_DIM).fill(0);

async function seedMemory(pool: pg.Pool, createdAt: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO memories (id, text, hash, embedding, payload, created_at)
     VALUES ($1,'t',$2,$3::vector,'{}'::jsonb,$4)`,
    [id, randomUUID(), ZERO_VEC, createdAt],
  );
  return id;
}

function edge(source: string, relation: string, target: string): {
  sourceName: string; relation: string; normalizedRelation: string;
  targetName: string; normalizedSourceKey: string; normalizedTargetKey: string;
} {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '_');
  return {
    sourceName: source, relation, normalizedRelation: norm(relation),
    targetName: target, normalizedSourceKey: norm(source), normalizedTargetKey: norm(target),
  };
}

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async () => EMBED),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => EMBED)),
});

const relationsLlm = (text: string): LLM => ({
  generateResponse: vi.fn(async () => ({
    memory: [{ id: '0', text }],
    relations: [{ source: 'John Smith', relationship: 'works at', destination: 'Google' }],
  })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('PgMemoryGraphStore (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const entityStore = new PgMemoryEntityStore(pool);
  const graphStore = new PgMemoryGraphStore(pool);
  const userFilters: Filters = { user_id: 'u1' };

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges RESTART IDENTITY CASCADE');
  });

  // Seed two entity nodes (John Smith + Google) in user scope u1, linked to `memoryId`.
  async function seedNodes(memoryId: string): Promise<void> {
    await entityStore.upsertAndLink({
      memoryId, workspaceId: 'default', filters: userFilters,
      entities: [
        { type: 'PROPER', name: 'John Smith', normalizedKey: 'john_smith', embedding: EMBED },
        { type: 'PROPER', name: 'Google', normalizedKey: 'google', embedding: EMBED },
      ],
    });
  }

  describe('PgMemoryGraphStore.upsertEdges + listEdges (T2.1)', () => {
    test('upsertEdges_persists_edge_between_existing_nodes', async () => {
      const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
      await seedNodes(m1);
      await graphStore.upsertEdges({
        memoryId: m1, workspaceId: 'default', filters: userFilters,
        edges: [edge('John Smith', 'works at', 'Google')],
      });
      const edges = await graphStore.listEdges({ workspaceId: 'default', filters: userFilters });
      expect(edges.length).toBe(1);
      expect(edges[0]?.source).toBe('John Smith');
      expect(edges[0]?.target).toBe('Google');
    });

    test('upsertEdges_skips_unresolvable_endpoint', async () => {
      const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
      await seedNodes(m1);
      await graphStore.upsertEdges({
        memoryId: m1, workspaceId: 'default', filters: userFilters,
        edges: [edge('John Smith', 'works at', 'Nonexistent Corp')],
      });
      const edges = await graphStore.listEdges({ workspaceId: 'default', filters: userFilters });
      expect(edges.length).toBe(0);
    });

    test('upsertEdges_aggregates_memory_count_across_memories (EC-1)', async () => {
      const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
      const m2 = await seedMemory(pool, '2026-06-02T00:00:00Z');
      await seedNodes(m1);
      await seedNodes(m2);
      await graphStore.upsertEdges({
        memoryId: m1, workspaceId: 'default', filters: userFilters,
        edges: [edge('John Smith', 'works at', 'Google')],
      });
      await graphStore.upsertEdges({
        memoryId: m2, workspaceId: 'default', filters: userFilters,
        edges: [edge('John Smith', 'works at', 'Google')],
      });
      const edges = await graphStore.listEdges({ workspaceId: 'default', filters: userFilters });
      expect(edges.length).toBe(1);
      const mc = edges[0]?.memoryCount;
      expect(mc).toBe(2);
    });

    test('resolveEntityId_deterministic_on_duplicate_key (EC-2)', async () => {
      // Two nodes, same normalized_key 'john_smith', different type, distinct created_at.
      const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
      await entityStore.upsertAndLink({
        memoryId: m1, workspaceId: 'default', filters: userFilters,
        entities: [{ type: 'PROPER', name: 'John Smith', normalizedKey: 'john_smith', embedding: EMBED }],
      });
      // force a later created_at on the COMPOUND duplicate
      await pool.query(
        `INSERT INTO entities (workspace_id, name, embedding, payload, type, normalized_key, user_id, created_at)
         VALUES ('default','John Smith',$1::vector,'{}'::jsonb,'COMPOUND','john_smith','u1','2026-06-05T00:00:00Z')`,
        [ZERO_VEC],
      );
      await entityStore.upsertAndLink({
        memoryId: m1, workspaceId: 'default', filters: userFilters,
        entities: [{ type: 'PROPER', name: 'Google', normalizedKey: 'google', embedding: EMBED }],
      });
      const earliest = await pool.query<{ id: string }>(
        `SELECT id FROM entities WHERE user_id='u1' AND normalized_key='john_smith' ORDER BY created_at ASC LIMIT 1`,
      );
      const earliestId = earliest.rows[0]?.id;
      // upsert an edge twice; both must resolve source to the SAME (earliest) node id.
      await graphStore.upsertEdges({
        memoryId: m1, workspaceId: 'default', filters: userFilters,
        edges: [edge('John Smith', 'works at', 'Google')],
      });
      const linked = await pool.query<{ source_entity_id: string }>(
        `SELECT source_entity_id FROM entity_edges WHERE user_id='u1' LIMIT 1`,
      );
      const first = linked.rows[0]?.source_entity_id;
      expect(first).toBe(earliestId);
    });

    test('upsertEdges_concurrent_same_triple_one_row (race)', async () => {
      const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
      await seedNodes(m1);
      const e = edge('John Smith', 'works at', 'Google');
      // concurrent same-triple upsert via Promise.all → exactly ONE row (ON CONFLICT)
      await Promise.all([
        graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: userFilters, edges: [e] }),
        graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: userFilters, edges: [e] }),
      ]);
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM entity_edges WHERE user_id='u1'`,
      );
      expect(Number(rows[0]?.n)).toBe(1);
    });
  });

  describe('PgMemoryGraphStore factory wiring (T3.2)', () => {
    test('factory_default_on_wires_edges', async () => {
      // createLocalMemory with NO explicit graph port → the factory wires
      // PgMemoryGraphStore by default (entityBoost on + PgvectorStore).
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: relationsLlm('John Smith works at Google'),
      });
      await memory.user('facwire').remember('John Smith works at Google');
      const edges = await graphStore.listEdges({
        workspaceId: 'default',
        filters: { user_id: 'facwire' },
      });
      expect(edges.length).toBeGreaterThan(0);
    });
  });

  describe('entity-relation-extraction-slice2 T4.1 — GOAL test vs real pgvector', () => {
    test('goal_remember_to_graph_edge', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: relationsLlm('John Smith works at Google'),
      });
      await memory.user('grapher').remember('John Smith works at Google');

      const app = createServer({
        memory,
        memoryEntityStore: new PgMemoryEntityStore(pool),
        memoryGraphStore: new PgMemoryGraphStore(pool),
      });
      const res = await app.fetch(new Request('http://localhost/v1/scopes/user/grapher/graph'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        nodes: { id: string }[];
        edges: { source: string; relation: string; target: string }[];
      };
      const e = body.edges.find((x) => x.source === 'John Smith' && x.target === 'Google');
      expect(e).toBeDefined();
      expect(e?.target).toBe('Google');
    });
  });
}
