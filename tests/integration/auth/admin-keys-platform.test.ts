/**
 * REST e2e — Model B slice 1: platform-admin workspace-targeted mint + the
 * cross-workspace isolation the gateway relies on (per-key, provider-enforced).
 *
 * Exercises the ACTUAL HTTP path: createServer → requireScope (admin gate, which
 * a memory:platform-admin key satisfies via scopeSatisfies) → createKeyHandler
 * with an explicit workspace_id → auto-provision + bind. Then proves a key bound
 * to ws-A cannot read ws-B's memories (the confused-deputy defense-in-depth).
 *
 * Run against real ankane/pgvector:v0.5.1 (gated by THEOMEM_PG_URI).
 *
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';
import { ApiKeyAuthVerifier } from '../../../packages/api/src/server/auth/api-key-verifier.js';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const stubLlm: LLM = {
  generateResponse: () => Promise.resolve('[]'),
  generateChat: (_m: readonly Message[]): Promise<LLMResponse> =>
    Promise.resolve({ content: '[]', role: 'assistant' }),
};

/**
 * Seed a platform-admin key bound to a control-plane workspace.
 *
 * Dois pools porque são duas naturezas: `workspaces` é escopada (semeada pelo
 * pool de travessia) e `theo_api_keys` não é (papel de aplicação).
 */
async function seedPlatformKey(pool: pg.Pool, wsPool: pg.Pool, token: string): Promise<void> {
  await wsPool.query(`INSERT INTO workspaces (id, name) VALUES ('ws-platform','ws-platform') ON CONFLICT (id) DO NOTHING`);
  await pool.query(
    `INSERT INTO theo_api_keys (id, subject, tenant_id, workspace_id, key_name, key_hash, key_prefix, scopes)
     VALUES ($1, 'platform', 'self', 'ws-platform', 'platform-key', $2, $3, $4::jsonb)`,
    [
      `apk-${randomUUID().slice(0, 16)}`,
      createHash('sha256').update(token).digest('hex'),
      token.slice(0, 12),
      JSON.stringify(['memory:platform-admin']),
    ],
  );
}

function mint(app: ReturnType<typeof createServer>, platformToken: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { authorization: `Bearer ${platformToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('Model B platform mint (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('Model B — platform-admin workspace-targeted mint (REST e2e)', () => {
    let pool: pg.Pool;
    /** Só para criar a linha de `workspaces`, que é escopada. */
    let wsSeed: pg.Pool;
    let dropDb: () => Promise<void>;
    let app: ReturnType<typeof createServer>;
    const platformToken = `theo_live_${randomUUID()}${randomUUID()}`;
    const BOOTSTRAP_TOKEN = 'bootstrap-token-32-chars-minimum!!';

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      // O CAMINHO DE PLATAFORMA NÃO TEM PAPEL PRÓPRIO, e este arquivo é onde
      // isso aparece. A mint auto-provisiona o workspace-alvo (escrita
      // escopada, exige travessia) E grava em `theo_api_keys` (não escopada,
      // sem grant para o papel de travessia). Nenhum dos dois papéis existentes
      // cobre as duas coisas: o de aplicação não atravessa, o de travessia não
      // alcança a tabela de chaves.
      //
      // Enquanto não houver um papel de administração, este teste roda no pool
      // de setup — que é o que ele já fazia antes do #196, então não é regressão;
      // é a lacuna ficando visível. Registrada em #197.
      pool = iso.setupPool;
      wsSeed = iso.setupPool;
      dropDb = iso.dropDb;
      await seedPlatformKey(pool, wsSeed, platformToken);
      const memory: Memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: stubLlm,
      });
      app = createServer({
        memory,
        authVerifier: new ApiKeyAuthVerifier(pool),
        adminApi: { pool, bootstrapToken: BOOTSTRAP_TOKEN },
      });
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    test('platform-admin mints into a new workspace, auto-provisioning it', async () => {
      const res = await mint(app, platformToken, {
        name: 'gw-tn-alpha',
        scopes: ['memory:read', 'memory:write', 'memory:delete'],
        workspace_id: 'tn-alpha',
      });
      expect(res.status).toBe(200);
      const ws = await pool.query<{ id: string }>(`SELECT id FROM workspaces WHERE id = 'tn-alpha'`);
      expect(ws.rows).toHaveLength(1);
      const key = await pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM theo_api_keys WHERE key_name = 'gw-tn-alpha'`,
      );
      expect(key.rows[0]?.workspace_id).toBe('tn-alpha');
    });

    test('auto-provision is idempotent under concurrency (one workspaces row)', async () => {
      const wsId = 'tn-concurrent';
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          mint(app, platformToken, {
            name: `gw-${wsId}-${String(i)}`,
            scopes: ['memory:read'],
            workspace_id: wsId,
          }),
        ),
      );
      for (const r of results) expect(r.status).toBe(200);
      const ws = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM workspaces WHERE id = $1`, [wsId]);
      expect(ws.rows[0]?.n).toBe('1');
    });

    test('END-TO-END confused-deputy closure: keys MINTED via the platform path isolate cross-workspace', async () => {
      // HIGH (/review): drive the data path with keys produced by the REAL mint
      // path (not side-loaded), so the full chain mint → workspace-bind → isolate
      // is proven as one flow. Mint K_A (tn-x) and K_B (tn-y) via the platform key.
      const mintKey = async (ws: string): Promise<string> => {
        const res = await mint(app, platformToken, {
          name: `gw-${ws}`,
          scopes: ['memory:read', 'memory:write', 'memory:delete'],
          workspace_id: ws,
        });
        expect(res.status).toBe(200);
        return ((await res.json()) as { secret: string }).secret;
      };
      const secretA = await mintKey('tn-x');
      const secretB = await mintKey('tn-y');
      const userId = `u-${randomUUID()}`;
      const sharedText = 'cross workspace canary minted';
      // tn-y remembers via its minted key.
      const rememberB = await app.request('/v1/remember', {
        method: 'POST',
        headers: { authorization: `Bearer ${secretB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, text: sharedText, infer: false }),
      });
      expect(rememberB.status).toBe(201);
      // tn-x recall for the same user+text → empty (provider-enforced isolation
      // from the credential the platform mint bound it to).
      const recallA = await app.request('/v1/recall', {
        method: 'POST',
        headers: { authorization: `Bearer ${secretA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, query: sharedText, threshold: 0 }),
      });
      expect(recallA.status).toBe(200);
      expect(((await recallA.json()) as { results: unknown[] }).results).toHaveLength(0);
      // tn-y recall → sees its own row (proves the canary is findable in its ws).
      const recallB = await app.request('/v1/recall', {
        method: 'POST',
        headers: { authorization: `Bearer ${secretB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, query: sharedText, threshold: 0 }),
      });
      expect(((await recallB.json()) as { results: unknown[] }).results.length).toBeGreaterThan(0);
    });

    test('cross-workspace forget cannot delete another workspace memory (scoped-forget → 404)', async () => {
      // HIGH (/review): extend isolation proof beyond read to the mutating verb.
      const secretA = ((await (await mint(app, platformToken, { name: 'fa', scopes: ['memory:read', 'memory:write', 'memory:delete'], workspace_id: 'tn-fa' })).json()) as { secret: string }).secret;
      const secretB = ((await (await mint(app, platformToken, { name: 'fb', scopes: ['memory:read', 'memory:write', 'memory:delete'], workspace_id: 'tn-fb' })).json()) as { secret: string }).secret;
      const userId = `u-${randomUUID()}`;
      const r = await app.request('/v1/remember', {
        method: 'POST',
        headers: { authorization: `Bearer ${secretB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, text: 'forget canary', infer: false }),
      });
      expect(r.status).toBe(201);
      const memId = ((await r.json()) as { items: { id: string }[] }).items[0]?.id;
      expect(memId).toBeTruthy();
      // tn-A tries to scoped-forget tn-B's memory id → 404 (no existence leak).
      const del = await app.request(`/v1/scopes/user/${userId}/memories/${memId as string}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${secretA}` },
      });
      expect(del.status).toBe(404);
      // Confirm it still exists in tn-B.
      const stillThere = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM memories WHERE id = $1 AND workspace_id = 'tn-fb' AND t_invalid IS NULL`,
        [memId],
      );
      expect(stillThere.rows[0]?.n).toBe('1');
    });

    test('EC-3: bootstrap-token mint with a target workspace_id provisions + binds', async () => {
      // Bootstrap is implicit platform-admin (first-key bootstrap, possibly the
      // gateway platform key). It must be able to target + provision a workspace.
      const res = await app.request('/v1/admin/keys', {
        method: 'POST',
        headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bootstrap-platform', scopes: ['memory:platform-admin'], workspace_id: 'tn-bootstrap' }),
      });
      expect(res.status).toBe(200);
      const ws = await pool.query<{ id: string }>(`SELECT id FROM workspaces WHERE id = 'tn-bootstrap'`);
      expect(ws.rows).toHaveLength(1);
      const key = await pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM theo_api_keys WHERE key_name = 'bootstrap-platform'`,
      );
      expect(key.rows[0]?.workspace_id).toBe('tn-bootstrap');
    });

    test('EC-5: a memory:platform-admin key passes the memory:admin-gated lifecycle route (not 403)', async () => {
      // Proves the scopeSatisfies implication flows through requireScope end-to-end:
      // the gateway's platform key can list/rotate/revoke the keys it minted.
      const res = await app.request('/v1/admin/keys/list', {
        method: 'GET',
        headers: { authorization: `Bearer ${platformToken}` },
      });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);
    });
  });
}
