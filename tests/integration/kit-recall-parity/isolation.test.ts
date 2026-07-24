/**
 * M14 Phase 5 — kit-recall-parity isolation HARD GATE (real ankane/pgvector:v0.5.1).
 *
 * The DoD bullet-6 gate: the new MCP surfaces (get_memory, list_entities, update_memory,
 * delete_entities) enforce the `(workspace, user)` boundary — identity comes from the
 * Principal server-side (ADR-M14-1), NEVER from a tool argument. Proves BOTH axes the M8
 * hardening established:
 *   - cross-TENANT: user in workspace A reads/updates/deletes ZERO of workspace B's data;
 *   - cross-USER:   user X in workspace A reads/updates/deletes ZERO of user Y's data (same ws).
 * Plus the theo-cloud#252 scenario: delete_entities without a confirmed user ABORTS.
 *
 * A cross-tenant/cross-user leak here is a BLOCKER, never a caveat — this test is never relaxed.
 * Gated by THEOMEM_PG_URI (absent → SKIP).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, PgMemoryEntityStore, MAX_EMBEDDING_DIM } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';
import { withScope } from '@usetheo/memory-agent-core';
import { dispatch } from '../../../packages/mcp/src/tools/dispatch.js';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<string> {
    return Promise.resolve('[]');
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ content: '[]', role: 'assistant' });
  },
};

const VEC = `[${Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1).join(',')}]`;

/** A (workspace, user) principal — flat for seeding, `ctxOf` builds the withScope shape. */
type Principal = { workspaceId: string; userId: string };
const ctxOf = (p: Principal) => ({ workspaceId: p.workspaceId, session: { userId: p.userId } }) as const;

function jsonOf(r: { content: readonly unknown[] }): Record<string, unknown> {
  const first = r.content[0] as { text?: string } | undefined;
  return first && typeof first.text === 'string' ? (JSON.parse(first.text) as Record<string, unknown>) : {};
}
function textOf(r: { content: readonly unknown[] }): string {
  const first = r.content[0] as { text?: string } | undefined;
  return first && typeof first.text === 'string' ? first.text : '';
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M14 Phase 5 kit-recall-parity isolation (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M14 Phase 5 — kit-recall-parity (workspace, user) isolation HARD GATE', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let base: Memory;
    let store: PgMemoryEntityStore;

    // Two workspaces (A, B); two users in A (X, Y). The attacker is always (A, X).
    const B: Principal = { workspaceId: 'tn-B', userId: 'user-B' };
    const AX: Principal = { workspaceId: 'tn-A', userId: 'user-X' };
    const AY: Principal = { workspaceId: 'tn-A', userId: 'user-Y' };

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.pool;
      dropDb = iso.dropDb;
      base = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
      });
      store = new PgMemoryEntityStore(pool);
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges, history RESTART IDENTITY CASCADE');
    });

    const deps = () => ({ memoryFactory: () => base, memoryEntityStore: store });

    /** Seed a memory directly in a given (workspace,user) scope; returns its id. */
    async function seedMemory(p: Principal, text: string): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, workspace_id, user_id)
         VALUES ($1,$2,$3,$4::vector,$5,$6,$7)`,
        [id, text, `h-${id}`, VEC, JSON.stringify({ text, workspace_id: p.workspaceId, user_id: p.userId }), p.workspaceId, p.userId],
      );
      return id;
    }

    /** Seed an entity (node) + its memory link in a given (workspace,user) scope. */
    async function seedEntity(p: Principal, name: string): Promise<void> {
      const memId = await seedMemory(p, `mem for ${name}`);
      const entId = randomUUID();
      await pool.query(
        `INSERT INTO entities (id, name, embedding, payload, workspace_id, user_id, normalized_key, type)
         VALUES ($1,$2,$3::vector,$4,$5,$6,$7,$8)`,
        [entId, name, VEC, JSON.stringify({}), p.workspaceId, p.userId, name.toLowerCase(), 'PERSON'],
      );
      await pool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1,$2)`, [memId, entId]);
    }

    test('get_memory — (A,X) reads ZERO of (B) and ZERO of (A,Y) [cross-tenant AND cross-user]', async () => {
      const bId = await seedMemory(B, 'Tenant B secret BRAVO-7788');
      const ayId = await seedMemory(AY, 'User Y secret YANKEE-4455');

      // Cross-tenant: A,X must not read B's row.
      const crossTenant = await withScope(ctxOf(AX), () => dispatch('get_memory', { id: bId }, deps()));
      expect(textOf(crossTenant)).toMatch(/No memory found/);

      // Cross-user (same workspace): A,X must not read A,Y's row.
      const crossUser = await withScope(ctxOf(AX), () => dispatch('get_memory', { id: ayId }, deps()));
      expect(textOf(crossUser)).toMatch(/No memory found/);

      // Control: the owner DOES read its own row (proves the seed landed + get works in-scope).
      const own = await withScope(ctxOf(AY), () => dispatch('get_memory', { id: ayId }, deps()));
      expect(textOf(own)).toMatch(/YANKEE-4455/);
    });

    test('list_entities — (A,X) lists ZERO of (B) and ZERO of (A,Y)', async () => {
      await seedEntity(B, 'Bravo');
      await seedEntity(AY, 'Yankee');
      await seedEntity(AX, 'Xray');

      const res = await withScope(ctxOf(AX), () => dispatch('list_entities', {}, deps()));
      const entities = (jsonOf(res)['entities'] as Array<{ id?: string }>) ?? [];
      const names = entities.map((e) => e.id);
      expect(names).toContain('Xray'); // own entity visible
      expect(names).not.toContain('Bravo'); // cross-tenant hidden
      expect(names).not.toContain('Yankee'); // cross-user hidden
    });

    test('update_memory — (A,X) cannot replace (B) nor (A,Y) rows; targets survive intact', async () => {
      const bId = await seedMemory(B, 'Tenant B original CHARLIE');
      const ayId = await seedMemory(AY, 'User Y original DELTA');

      // A,X attempts to update B's and A,Y's memories — the ADD-only remember lands in A,X's
      // OWN scope, but the forget of the foreign id must NOT delete the target (workspace/user gate).
      await withScope(ctxOf(AX), () => dispatch('update_memory', { id: bId, content: 'hijack B attempt long enough' }, deps())).catch(
        () => undefined,
      );
      await withScope(ctxOf(AX), () => dispatch('update_memory', { id: ayId, content: 'hijack AY attempt long enough' }, deps())).catch(
        () => undefined,
      );

      // Both targets survive with their original text (nothing was forgotten cross-boundary).
      const bSurvives = await pool.query('SELECT text FROM memories WHERE id=$1 AND t_invalid IS NULL', [bId]);
      const aySurvives = await pool.query('SELECT text FROM memories WHERE id=$1 AND t_invalid IS NULL', [ayId]);
      expect(bSurvives.rows[0]?.text).toBe('Tenant B original CHARLIE');
      expect(aySurvives.rows[0]?.text).toBe('User Y original DELTA');
    });

    test('delete_entities — (A,X) deletes ZERO of (B) and (A,Y); targets survive', async () => {
      await seedEntity(B, 'Zeta');
      await seedEntity(AY, 'Zeta');

      // A,X deletes 'Zeta' — but there is no Zeta in (A, user-X); B's and A,Y's survive.
      const res = await withScope(ctxOf(AX), () => dispatch('delete_entities', { name: 'Zeta' }, deps()));
      expect(jsonOf(res)['entities_removed']).toBe(0);

      const remaining = await pool.query(
        `SELECT workspace_id, user_id FROM entities WHERE name='Zeta' ORDER BY workspace_id, user_id`,
      );
      // Both foreign Zetas still there (2 rows): (tn-A,user-Y) and (tn-B,user-B).
      expect(remaining.rows).toHaveLength(2);
    });

    test('delete_entities #252 — no confirmed user in scope → ABORTS (never an open-scope wipe)', async () => {
      await seedEntity(AY, 'Omega');
      // A workspace-scope with NO user (workspace-admin-like) must NOT delete: the surface aborts
      // (dispatch converts the scope-gate throw into an isError result) and NOTHING is removed.
      const res = await withScope({ workspaceId: 'tn-A' }, () => dispatch('delete_entities', { name: 'Omega' }, deps()));
      expect(res.isError).toBe(true);
      // The entity is untouched — the guard fired before any delete (the #252 property).
      const still = await pool.query(`SELECT 1 FROM entities WHERE name='Omega'`);
      expect(still.rows).toHaveLength(1);
    });
  });
}
