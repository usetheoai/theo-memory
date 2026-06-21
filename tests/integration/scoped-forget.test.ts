/**
 * T1.1 RED — subject-scoped forget: PgvectorStore.deleteInScope(id, filters, hard).
 *
 * The scope-checked delete primitive that lets the gateway drop its O(scope)
 * IDOR pre-check: a memory is deleted ONLY when its workspace_id AND the bound
 * scope-tier column match `filters`. A cross-subject / cross-workspace id matches
 * 0 rows (→ MemoryNotFound → 404 upstream, no existence leak) and the other row
 * is NEVER touched. Soft path guards `t_invalid IS NULL` (EC-4 idempotent-404).
 * Hard path physically removes; entity-linked rows cascade (EC-1 — FKs are
 * ON DELETE CASCADE in 0018/0019, so no children-first logic).
 *
 * Gated by THEOMEM_PG_URI (absent → SKIP). Real ankane/pgvector:v0.5.1.
 *
 * @see .claude/knowledge-base/plans/themory-scoped-forget-and-retrieval-counter-plan.md § T1.1
 */
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM, PgvectorStore, createLocalMemory, runMigrations, MemoryNotFound } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T1.1 deleteInScope (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('T1.1 PgvectorStore.deleteInScope (scope-checked forget)', () => {
    const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
    const store = new PgvectorStore(pool);
    const EMB = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges, history RESTART IDENTITY CASCADE');
    });

    async function seed(opts: { user?: string; workspace?: string; suffix: string }): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, user_id, workspace_id)
         VALUES ($1, $2, $3::vector, $4, $5, $6) RETURNING id`,
        [
          `fact ${opts.suffix}`,
          `h-t1-1-${opts.suffix}-${Math.random().toString(36).slice(2)}`,
          JSON.stringify(EMB),
          JSON.stringify({ text: `fact ${opts.suffix}`, user_id: opts.user ?? null, workspace_id: opts.workspace ?? 'default' }),
          opts.user ?? null,
          opts.workspace ?? 'default',
        ],
      );
      return rows[0]!.id;
    }

    async function tInvalidOf(id: string): Promise<Date | null> {
      const { rows } = await pool.query<{ t_invalid: Date | null }>('SELECT t_invalid FROM memories WHERE id = $1', [id]);
      return rows.length === 0 ? null : rows[0]!.t_invalid;
    }
    async function exists(id: string): Promise<boolean> {
      const { rows } = await pool.query('SELECT 1 FROM memories WHERE id = $1', [id]);
      return rows.length > 0;
    }

    test('soft-deletes an owned memory in scope (returns true; t_invalid set)', async () => {
      const id = await seed({ user: 'alice', suffix: 'owned' });
      const matched = await store.deleteInScope(id, { user_id: 'alice', workspace_id: 'default' }, false);
      expect(matched).toBe(true);
      expect(await tInvalidOf(id)).not.toBeNull();
    });

    test('cross-subject forget matches 0 rows and the victim row SURVIVES live', async () => {
      const aliceId = await seed({ user: 'alice', suffix: 'victim' });
      const matched = await store.deleteInScope(aliceId, { user_id: 'bob', workspace_id: 'default' }, false);
      expect(matched).toBe(false); // → MemoryNotFound → 404 upstream
      expect(await tInvalidOf(aliceId)).toBeNull(); // untouched + still live
    });

    test('cross-workspace forget matches 0 rows and the victim row SURVIVES live', async () => {
      const id = await seed({ user: 'alice', workspace: 'w1', suffix: 'wsvictim' });
      const matched = await store.deleteInScope(id, { user_id: 'alice', workspace_id: 'w2' }, false);
      expect(matched).toBe(false);
      expect(await tInvalidOf(id)).toBeNull();
    });

    test('hard forget physically removes the in-scope row', async () => {
      const id = await seed({ user: 'alice', suffix: 'hard' });
      const matched = await store.deleteInScope(id, { user_id: 'alice', workspace_id: 'default' }, true);
      expect(matched).toBe(true);
      expect(await exists(id)).toBe(false);
    });

    test('EC-1: hard forget of an entity-linked memory succeeds via CASCADE', async () => {
      const id = await seed({ user: 'alice', suffix: 'linked' });
      // (a) memory_entities link (node provenance)
      const acme = await pool.query<{ id: string }>(
        `INSERT INTO entities (name, normalized_key, type, embedding, payload, workspace_id, user_id)
         VALUES ('Acme','acme','PROPER',$1::vector,'{}'::jsonb,'default','alice') RETURNING id`,
        [JSON.stringify(EMB)],
      );
      await pool.query('INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)', [id, acme.rows[0]!.id]);
      // (b) entity_edges row whose source_memory_id IS the target memory — the plan's
      // EC-1 names this second FK explicitly; it must cascade on hard delete too.
      const bob = await pool.query<{ id: string }>(
        `INSERT INTO entities (name, normalized_key, type, embedding, payload, workspace_id, user_id)
         VALUES ('Bob','bob','PROPER',$1::vector,'{}'::jsonb,'default','alice') RETURNING id`,
        [JSON.stringify(EMB)],
      );
      await pool.query(
        `INSERT INTO entity_edges (workspace_id, source_entity_id, target_entity_id, relation, normalized_relation, source_memory_id, user_id)
         VALUES ('default',$1,$2,'works at','works_at',$3,'alice')`,
        [acme.rows[0]!.id, bob.rows[0]!.id, id],
      );

      const matched = await store.deleteInScope(id, { user_id: 'alice', workspace_id: 'default' }, true);
      expect(matched).toBe(true);
      expect(await exists(id)).toBe(false);
      // both FK references cascaded — no orphan edge pointing at the deleted memory
      const edges = await pool.query('SELECT 1 FROM entity_edges WHERE source_memory_id = $1', [id]);
      expect(edges.rows).toHaveLength(0);
    });

    test('EC-4: double soft forget returns false (idempotent 404)', async () => {
      const id = await seed({ user: 'alice', suffix: 'double' });
      expect(await store.deleteInScope(id, { user_id: 'alice', workspace_id: 'default' }, false)).toBe(true);
      // second soft forget: row already carries t_invalid → 0 rows matched
      expect(await store.deleteInScope(id, { user_id: 'alice', workspace_id: 'default' }, false)).toBe(false);
    });
  });

  describe('T1.1 ScopedMemory.forget (scoped wrapper)', () => {
    const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
    const embedder: Embedder = {
      embed: vi.fn(async () => new Array<number>(MAX_EMBEDDING_DIM).fill(0)),
      embedBatch: vi.fn(async (t: readonly string[]) => t.map(() => new Array<number>(MAX_EMBEDDING_DIM).fill(0))),
    };
    const llm = (text: string): LLM => ({
      generateResponse: vi.fn(async () => ({ memory: [{ id: '0', text }] })),
      generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
    });

    afterAll(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await runMigrations(pool);
      await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges, history RESTART IDENTITY CASCADE');
    });

    test('memory.user(alice).forget(ownId) removes it from the scope (getAll excludes it)', async () => {
      const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm: llm('alice likes coffee') });
      const [item] = await memory.user('alice').remember('alice likes coffee');
      await memory.user('alice').forget(item!.id);
      const all = await memory.user('alice').getAll();
      expect(all.find((m) => m.id === item!.id)).toBeUndefined();
    });

    test('memory.user(bob).forget(aliceId) throws MemoryNotFound (cross-subject, no existence leak)', async () => {
      const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm: llm('alice secret') });
      const [item] = await memory.user('alice').remember('alice secret');
      await expect(memory.user('bob').forget(item!.id)).rejects.toBeInstanceOf(MemoryNotFound);
      // victim survives, still live
      const aliceAll = await memory.user('alice').getAll();
      expect(aliceAll.find((m) => m.id === item!.id)).toBeDefined();
    });
  });

  describe('T1.2 DELETE /v1/scopes/:type/:id/memories/:memId', () => {
    const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
    const embedder: Embedder = {
      embed: vi.fn(async () => new Array<number>(MAX_EMBEDDING_DIM).fill(0)),
      embedBatch: vi.fn(async (t: readonly string[]) => t.map(() => new Array<number>(MAX_EMBEDDING_DIM).fill(0))),
    };
    const llm = (text: string): LLM => ({
      generateResponse: vi.fn(async () => ({ memory: [{ id: '0', text }] })),
      generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
    });
    const UUID = '00000000-0000-4000-8000-000000000000';

    afterAll(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await runMigrations(pool);
      await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges, history RESTART IDENTITY CASCADE');
    });

    async function seedAlice(text: string): Promise<{ app: Awaited<ReturnType<typeof createServer>> | ReturnType<typeof createServer>; id: string }> {
      const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm: llm(text) });
      const [item] = await memory.user('alice').remember(text);
      const app = createServer({ memory });
      return { app, id: item!.id };
    }

    test('DELETE an owned memory returns 204 and removes it', async () => {
      const { app, id } = await seedAlice('alice fact one');
      const res = await app.fetch(new Request(`http://localhost/v1/scopes/user/alice/memories/${id}`, { method: 'DELETE' }));
      expect(res.status).toBe(204);
      const list = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/memories'));
      const body = (await list.json()) as { items: { id: string }[] };
      expect(body.items.find((m) => m.id === id)).toBeUndefined();
    });

    test('DELETE a cross-subject id returns 404 and leaves the victim row intact', async () => {
      const { app, id } = await seedAlice('alice fact two');
      const res = await app.fetch(new Request(`http://localhost/v1/scopes/user/bob/memories/${id}`, { method: 'DELETE' }));
      expect(res.status).toBe(404);
      // victim survives, still live in alice's scope (no existence leak, no wrong-row delete)
      const aliceList = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/memories'));
      const body = (await aliceList.json()) as { items: { id: string }[] };
      expect(body.items.find((m) => m.id === id)).toBeDefined();
    });

    test('DELETE a non-UUID memId returns 422', async () => {
      const { app } = await seedAlice('alice fact three');
      const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/memories/not-a-uuid', { method: 'DELETE' }));
      expect(res.status).toBe(422);
    });

    test('DELETE with a bad scope type returns 404', async () => {
      const { app } = await seedAlice('alice fact four');
      const res = await app.fetch(new Request(`http://localhost/v1/scopes/bogus/alice/memories/${UUID}`, { method: 'DELETE' }));
      expect(res.status).toBe(404);
    });

    test('DELETE ?hard=true physically removes the row', async () => {
      const { app, id } = await seedAlice('alice fact five');
      const res = await app.fetch(new Request(`http://localhost/v1/scopes/user/alice/memories/${id}?hard=true`, { method: 'DELETE' }));
      expect(res.status).toBe(204);
      const { rows } = await pool.query('SELECT 1 FROM memories WHERE id = $1', [id]);
      expect(rows.length).toBe(0);
    });

    test('DELETE ?hard=false stays soft (row survives with t_invalid set)', async () => {
      const { app, id } = await seedAlice('alice fact six');
      const res = await app.fetch(new Request(`http://localhost/v1/scopes/user/alice/memories/${id}?hard=false`, { method: 'DELETE' }));
      expect(res.status).toBe(204);
      const { rows } = await pool.query<{ t_invalid: Date | null }>('SELECT t_invalid FROM memories WHERE id = $1', [id]);
      expect(rows.length).toBe(1);
      expect(rows[0]!.t_invalid).not.toBeNull();
    });

    test('OpenAPI spec registers the DELETE scoped-forget path', async () => {
      const { app } = await seedAlice('alice fact seven');
      const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
      const spec = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
      expect(spec.paths['/v1/scopes/{type}/{id}/memories/{memId}']?.['delete']).toBeDefined();
    });
  });
}
