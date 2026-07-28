/**
 * M1 — edge-level bi-temporal validity + automatic invalidation (store layer,
 * real ankane/pgvector:v0.5.1).
 *
 * Proves: (T1.3) supersession — a new (source, relation, target) invalidates a
 * PRIOR active edge with the same (scope, source, relation) but a different
 * target, and re-asserting the active triple is idempotent; (T1.2) forget-
 * propagation — `invalidateEdgesByMemory` invalidates the edges a memory
 * produced; (T2.1) `listEdges` returns only active edges by default, with an
 * opt-in `includeSuperseded`; (T1.4) graph traversal hop-2 excludes a superseded
 * edge and honors `asOf`. Invalidate-not-delete (history preserved).
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Filters, Embedder, LLM } from '@usetheo/memory';
import {
  createLocalMemory,
  PgvectorStore,
  PgMemoryEntityStore,
  PgMemoryGraphStore,
  PgGraphExpansionStore,
  runMigrations,
} from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'];
const ZERO_VEC = `[${new Array(MAX_EMBEDDING_DIM).fill(0).join(',')}]`;
const EMBED = new Array<number>(MAX_EMBEDDING_DIM).fill(0);

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '_');

async function seedMemory(pool: pg.Pool, createdAt: string): Promise<string> {
  const id = randomUUID();
  // user_id = 'u1' so the graph expansion's memory-scope filter (COALESCE match)
  // includes these rows — the traversal scopes CANDIDATE memories by `filters`.
  await pool.query(
    `INSERT INTO memories (id, text, hash, embedding, payload, user_id, created_at)
     VALUES ($1,'t',$2,$3::vector,'{}'::jsonb,'u1',$4)`,
    [id, randomUUID(), ZERO_VEC, createdAt],
  );
  return id;
}

function edge(source: string, relation: string, target: string) {
  return {
    sourceName: source,
    relation,
    normalizedRelation: norm(relation),
    targetName: target,
    normalizedSourceKey: norm(source),
    normalizedTargetKey: norm(target),
  };
}

describe.skipIf(PG_URI === undefined || PG_URI === '')('M1 — edge validity + invalidation (store layer)', () => {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const entityStore = new PgMemoryEntityStore(pool);
  const graphStore = new PgMemoryGraphStore(pool);
  const expansion = new PgGraphExpansionStore(pool);
  const uf: Filters = { user_id: 'u1' };

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges RESTART IDENTITY CASCADE');
  });

  async function seedNodes(memoryId: string, names: readonly string[]): Promise<void> {
    await entityStore.upsertAndLink({
      memoryId,
      workspaceId: 'default',
      filters: uf,
      entities: names.map((n) => ({ type: 'PROPER' as const, name: n, normalizedKey: norm(n), embedding: EMBED })),
    });
  }

  test('T1.3: a contradicting edge supersedes the prior; re-asserting the active triple is idempotent', async () => {
    const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
    await seedNodes(m1, ['Kendra', 'Adidas', 'Nike']);

    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Adidas')] });
    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Nike')] });

    // active-only default: Adidas superseded, Nike active
    const active = await graphStore.listEdges({ workspaceId: 'default', filters: uf });
    expect(active.map((e) => e.target)).toEqual(['Nike']);
    // includeSuperseded: both, history preserved (invalidate-not-delete)
    const all = await graphStore.listEdges({ workspaceId: 'default', filters: uf, includeSuperseded: true });
    expect(all.map((e) => e.target).sort()).toEqual(['Adidas', 'Nike']);
    // M1 gap-close: the audit view distinguishes active vs superseded per edge.
    expect(all.find((e) => e.target === 'Nike')?.active).toBe(true);
    expect(all.find((e) => e.target === 'Adidas')?.active).toBe(false);
    // the Adidas edge carries t_invalid
    const inv = await pool.query<{ c: string }>(
      `SELECT count(*) c FROM entity_edges ee JOIN entities te ON te.id = ee.target_entity_id
        WHERE te.name = 'Adidas' AND ee.t_invalid IS NOT NULL`,
    );
    expect(Number(inv.rows[0]!.c)).toBe(1);

    // idempotent: re-asserting the SAME active triple does not create a new supersession
    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Nike')] });
    const active2 = await graphStore.listEdges({ workspaceId: 'default', filters: uf });
    expect(active2.map((e) => e.target)).toEqual(['Nike']);
  });

  test('T1.2: invalidateEdgesByMemory invalidates the edges a memory produced (history preserved)', async () => {
    const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
    await seedNodes(m1, ['Kendra', 'Adidas']);
    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Adidas')] });
    expect((await graphStore.listEdges({ workspaceId: 'default', filters: uf })).length).toBe(1);

    await graphStore.invalidateEdgesByMemory(m1);

    expect((await graphStore.listEdges({ workspaceId: 'default', filters: uf })).length).toBe(0);
    expect((await graphStore.listEdges({ workspaceId: 'default', filters: uf, includeSuperseded: true })).length).toBe(1);
  });

  test('T1.4: hop-2 traversal excludes a superseded edge; asOf before invalidation still traverses it', async () => {
    const mA = await seedMemory(pool, '2026-06-01T00:00:00Z'); // linked to Kendra (the seed)
    const mC = await seedMemory(pool, '2026-06-02T00:00:00Z'); // linked to Nike (reachable via the edge)
    await seedNodes(mA, ['Kendra']);
    await seedNodes(mC, ['Nike']);
    await graphStore.upsertEdges({ memoryId: mA, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Nike')] });

    const seed = { seedMemoryIds: [mA], filters: { workspace_id: 'default', user_id: 'u1' } as Filters, hops: 2 as const, limit: 10 };

    // hop-2 from A reaches the Nike entity via the edge → C surfaces
    const before = await expansion.expandByEntities(seed);
    expect(before.map((r) => r.result.id)).toContain(mC);

    // invalidate the edge → hop-2 must NOT traverse it → C excluded
    await graphStore.invalidateEdgesByMemory(mA);
    const after = await expansion.expandByEntities(seed);
    expect(after.map((r) => r.result.id)).not.toContain(mC);

    // asOf before the edge's t_invalid → edge active at that instant → C surfaces again
    const et = await pool.query<{ t_valid: string; t_invalid: string }>(
      `SELECT t_valid, t_invalid FROM entity_edges LIMIT 1`,
    );
    const mid = new Date((new Date(et.rows[0]!.t_valid).getTime() + new Date(et.rows[0]!.t_invalid).getTime()) / 2);
    const asOf = await expansion.expandByEntities({
      seedMemoryIds: [mA],
      filters: { workspace_id: 'default', user_id: 'u1', asOf: mid },
      hops: 2,
      limit: 10,
    });
    expect(asOf.map((r) => r.result.id)).toContain(mC);
  });

  test('T2.1: REST GET /graph shows active edges by default; ?includeSuperseded=true surfaces the retired edge', async () => {
    const m1 = await seedMemory(pool, '2026-06-01T00:00:00Z');
    await seedNodes(m1, ['Kendra', 'Adidas', 'Nike']);
    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Adidas')] });
    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Nike')] });

    const embedder: Embedder = { embed: async () => EMBED, embedBatch: async (t) => t.map(() => EMBED) };
    const llm: LLM = {
      generateResponse: async () => ({ memory: [] }),
      generateChat: async () => ({ role: 'assistant' as const, content: '' }),
    };
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm });
    const app = createServer({ memory, memoryEntityStore: entityStore, memoryGraphStore: graphStore });

    const activeRes = await app.fetch(new Request('http://localhost/v1/scopes/user/u1/graph'));
    const active = (await activeRes.json()) as { edges: { target: string }[] };
    expect(active.edges.map((e) => e.target)).toEqual(['Nike']); // superseded Adidas hidden

    const allRes = await app.fetch(new Request('http://localhost/v1/scopes/user/u1/graph?includeSuperseded=true'));
    const all = (await allRes.json()) as { edges: { target: string }[] };
    expect(all.edges.map((e) => e.target).sort()).toEqual(['Adidas', 'Nike']); // audit view
  });

  test('T1.2 fail-soft: forget() still succeeds (memory soft-deleted) when edge invalidation throws', async () => {
    const id = await seedMemory(pool, '2026-06-01T00:00:00Z');
    // A graph store whose invalidateEdgesByMemory ALWAYS throws — forget must not
    // propagate it (best-effort; the memory soft-delete already succeeded).
    const throwingGraph = {
      upsertEdges: async () => undefined,
      invalidateEdgesByMemory: async () => {
        throw new Error('edge invalidation boom');
      },
      listEdges: async () => [],
    };
    const embedder: Embedder = { embed: async () => EMBED, embedBatch: async (t) => t.map(() => EMBED) };
    const llm: LLM = {
      generateResponse: async () => ({ memory: [] }),
      generateChat: async () => ({ role: 'assistant' as const, content: '' }),
    };
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder,
      llm,
      memoryGraphStore: throwingGraph,
    });

    // forget must resolve (NOT throw) despite the graph store throwing
    await expect(memory.user('u1').forget(id)).resolves.toBeUndefined();
    // and the memory IS soft-deleted (t_invalid set) — the primary op is durable
    const r = await pool.query<{ t_invalid: string | null }>(`SELECT t_invalid FROM memories WHERE id = $1`, [id]);
    expect(r.rows[0]!.t_invalid).not.toBeNull();
  });
});
