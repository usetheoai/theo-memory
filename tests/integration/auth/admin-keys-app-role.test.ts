/**
 * The admin key API and API-key authentication, run as the role production runs as.
 *
 * `themory server` refuses to boot on a superuser (0032 + the request-pool guard), so
 * in production every admin route and every credential lookup runs as `themory_app`:
 * NOSUPERUSER, NOBYPASSRLS, subject to the FORCE ROW LEVEL SECURITY policies on
 * `workspaces` and `workspace_users`. Those policies admit a row only when
 * `app.workspace_id` names its workspace.
 *
 * The admin routes run BEFORE any request scope exists, on the raw pool. Every test
 * that exercised them ran as the owner or a superuser, which bypasses the policies —
 * so minting a key 500ed in production (#227) while the suite stayed green, and a key
 * bound to a member resolved to the default-deny role because the membership JOIN
 * saw no rows.
 *
 * This file wires the server the way `run-server.ts` does: the admin API and the
 * verifier on the application-role pool, the stores on `tenantScopedPool` over it.
 * Fixtures that must write scoped rows use `poolPinnedTo(ws)`; nothing under test
 * uses the setup pool.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createLocalMemory, PgvectorStore, tenantScopedPool } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';
import { ApiKeyAuthVerifier } from '../../../packages/api/src/server/auth/api-key-verifier.js';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

/** Generated per run: a fixture, not a credential, and never a literal in the tree. */
const BOOTSTRAP_TOKEN = `bootstrap-${randomUUID()}`;
/** Where a bootstrap-minted key lands: the caller's workspace, which bootstrap resolves to `default`. */
const BOOTSTRAP_WORKSPACE = 'default';

const stubLlm: LLM = {
  generateResponse: () => Promise.resolve('[]'),
  generateChat: (_m: readonly Message[]): Promise<LLMResponse> =>
    Promise.resolve({ content: '[]', role: 'assistant' }),
};

interface MintedKey {
  readonly id: string;
  readonly secret: string;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('admin keys as themory_app (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('admin keys and key authentication as the application role (#227)', () => {
    let db: IsolatedDb;
    let app: ReturnType<typeof createServer>;
    let verifier: ApiKeyAuthVerifier;
    /**
     * The bootstrap mint response, taken once: the token is single-use, so every test
     * that needs an admin caller shares the first key rather than depending on which
     * test happened to run first.
     */
    let bootstrapMint: Promise<{ status: number; body: unknown }> | undefined;

    function mintFirstAdmin(): Promise<{ status: number; body: unknown }> {
      bootstrapMint ??= post('/v1/admin/keys', BOOTSTRAP_TOKEN, {
        name: 'first-admin',
        scopes: ['memory:admin', 'memory:read', 'memory:write'],
      }).then(async (res) => ({ status: res.status, body: await res.json() }));
      return bootstrapMint;
    }

    async function adminSecret(): Promise<string> {
      const { status, body } = await mintFirstAdmin();
      expect(status).toBe(200);
      return (body as MintedKey).secret;
    }

    async function post(path: string, token: string, body: unknown): Promise<Response> {
      return app.request(path, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    async function mint(token: string, body: unknown): Promise<MintedKey> {
      const res = await post('/v1/admin/keys', token, body);
      expect(res.status).toBe(200);
      return (await res.json()) as MintedKey;
    }

    beforeAll(async () => {
      db = await createIsolatedDb();
      const role = await db.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      // The whole file is worthless if this is not true, so it is asserted, not assumed.
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

      const memory: Memory = await createLocalMemory({
        vectorStore: new PgvectorStore(tenantScopedPool(db.pool)),
        embedder: new DeterministicStubEmbedder(),
        llm: stubLlm,
      });
      verifier = new ApiKeyAuthVerifier(db.pool);
      app = createServer({
        memory,
        authVerifier: verifier,
        adminApi: { pool: db.pool, bootstrapToken: BOOTSTRAP_TOKEN },
      });
    }, 30_000);

    afterAll(async () => {
      await db?.dropDb();
    });

    test('the bootstrap token mints the first admin key', async () => {
      const { status, body } = await mintFirstAdmin();

      expect(status).toBe(200);
      expect((body as MintedKey).secret).toMatch(/^theo_live_/);
    });

    test('an admin key mints a key in its own workspace', async () => {
      const minted = await mint(await adminSecret(), { name: 'second', scopes: ['memory:read'] });

      const principal = await verifier.resolvePrincipal(minted.secret);
      expect(principal?.workspaceId).toBe(BOOTSTRAP_WORKSPACE);
    });

    /**
     * A key bound to a member who is then promoted to owner. Minted while the member
     * is a plain member, because the unbound admin caller resolves to the default-deny
     * role and may not mint for someone who outranks it.
     */
    async function mintOwnerBoundKey(): Promise<MintedKey> {
      const userId = `usr-${randomUUID().slice(0, 12)}`;
      const scoped = db.poolPinnedTo(BOOTSTRAP_WORKSPACE);
      await db.pool.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [userId, `${userId}@example.test`]);
      await scoped.query(
        `INSERT INTO workspace_users (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
        [BOOTSTRAP_WORKSPACE, userId],
      );
      const bound = await mint(await adminSecret(), { name: `bound-${userId}`, scopes: ['memory:read'], user_id: userId });
      await scoped.query(
        `UPDATE workspace_users SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`,
        [BOOTSTRAP_WORKSPACE, userId],
      );
      return bound;
    }

    test('a key bound to an owner member authenticates with the owner role', async () => {
      const bound = await mintOwnerBoundKey();

      const principal = await verifier.resolvePrincipal(bound.secret);

      expect(principal?.role).toBe('owner');
    });

    test('an owner key lists the workspace members', async () => {
      const bound = await mintOwnerBoundKey();

      const res = await app.request('/v1/members', { headers: { authorization: `Bearer ${bound.secret}` } });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { members: unknown[] };
      expect(body.members.length).toBeGreaterThanOrEqual(1);
    });

    test('a minted key remembers and recalls through the REST API', async () => {
      const client = await mint(await adminSecret(), { name: 'client', scopes: ['memory:read', 'memory:write'] });
      const userId = `u-${randomUUID()}`;
      const text = 'application role round-trip canary';

      const remembered = await post('/v1/remember', client.secret, { userId, text, infer: false });
      expect(remembered.status).toBe(201);
      const recalled = await post('/v1/recall', client.secret, { userId, query: text, threshold: 0 });

      expect(recalled.status).toBe(200);
      const body = (await recalled.json()) as { results: { text?: string; memory?: string }[] };
      expect(body.results.length).toBeGreaterThanOrEqual(1);
    });

    test('list, rotate, lineage and revoke answer as the application role', async () => {
      const key = await mint(await adminSecret(), { name: 'lifecycle', scopes: ['memory:read'] });
      const auth = { authorization: `Bearer ${await adminSecret()}` };

      const listed = await app.request('/v1/admin/keys/list', { headers: auth });
      expect(listed.status).toBe(200);
      const rotated = await app.request(`/v1/admin/keys/${key.id}/rotate`, { method: 'POST', headers: auth });
      expect(rotated.status).toBe(200);
      const lineage = await app.request(`/v1/admin/keys/${key.id}/lineage`, { headers: auth });
      expect(lineage.status).toBe(200);
      const revoked = await app.request(`/v1/admin/keys/${key.id}`, { method: 'DELETE', headers: auth });
      expect(revoked.status).toBe(204);
    });
  });
}

