/**
 * M2 — evolving entity summaries (on-demand), real ankane/pgvector:v0.5.1.
 *
 * Proves: (T1.2) `MemoryEntityStore.list` returns a deterministic `summary` — a
 * digest of the entity's currently-ACTIVE outgoing relations — computed
 * on-demand (zero LLM); it EVOLVES when a relation is superseded (M1); and it is
 * the empty string for an entity with no active relations. (T2.1) the REST
 * `GET /v1/scopes/:type/:id/entities` surfaces `summary`.
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Filters, Embedder, LLM } from '@usetheo/memory';
import { createLocalMemory, PgvectorStore, PgMemoryEntityStore, PgMemoryGraphStore, runMigrations } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'];
const ZERO_VEC = `[${new Array(MAX_EMBEDDING_DIM).fill(0).join(',')}]`;
const EMBED = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '_');

async function seedMemory(pool: pg.Pool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO memories (id, text, hash, embedding, payload, user_id, created_at)
     VALUES ($1,'t',$2,$3::vector,'{}'::jsonb,'u1',now())`,
    [id, randomUUID(), ZERO_VEC],
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

describe.skipIf(PG_URI === undefined || PG_URI === '')('M2 — evolving entity summaries (on-demand)', () => {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const entityStore = new PgMemoryEntityStore(pool);
  const graphStore = new PgMemoryGraphStore(pool);
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
  const summaryOf = async (name: string): Promise<string> => {
    const list = await entityStore.list({ workspaceId: 'default', filters: uf });
    return list.find((e) => e.name === name)?.summary ?? '<not-found>';
  };

  test('T1.2: summary is the active-relations digest, evolves on supersession, empty when no active relations', async () => {
    const m1 = await seedMemory(pool);
    await seedNodes(m1, ['Kendra', 'Adidas', 'Nike']);

    // no relations yet → empty summary (never null)
    expect(await summaryOf('Kendra')).toBe('');

    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Adidas')] });
    expect(await summaryOf('Kendra')).toContain('loves → Adidas');

    // supersede: loves Adidas → loves Nike; the summary EVOLVES (drops Adidas)
    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'loves', 'Nike')] });
    const evolved = await summaryOf('Kendra');
    expect(evolved).toContain('loves → Nike');
    expect(evolved).not.toContain('Adidas');

    // a leaf entity with no OUTGOING relations → empty summary
    expect(await summaryOf('Nike')).toBe('');
  });

  test('T2.1: REST GET /entities surfaces the summary', async () => {
    const m1 = await seedMemory(pool);
    await seedNodes(m1, ['Kendra', 'Berlin']);
    await graphStore.upsertEdges({ memoryId: m1, workspaceId: 'default', filters: uf, edges: [edge('Kendra', 'lives in', 'Berlin')] });

    const embedder: Embedder = { embed: async () => EMBED, embedBatch: async (t) => t.map(() => EMBED) };
    const llm: LLM = {
      generateResponse: async () => ({ memory: [] }),
      generateChat: async () => ({ role: 'assistant' as const, content: '' }),
    };
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm });
    const app = createServer({ memory, memoryEntityStore: entityStore, memoryGraphStore: graphStore });

    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/u1/entities'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: { id: string; summary: string }[] };
    const kendra = body.entities.find((e) => e.id === 'Kendra');
    expect(kendra?.summary).toContain('lives_in → Berlin');
  });
});
