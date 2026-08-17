/**
 * REST e2e — multi-tenant-workspace-isolation § T3.1 (/review F-tests-1/2 + EC-4).
 *
 * The Memory-seam goal test (`workspace-isolation.test.ts`) proves isolation
 * through `Memory.withWorkspace`. THIS test closes the /review gap: it exercises
 * the ACTUAL HTTP path — `createServer` → `bearerAuth` middleware → Principal
 * injection → handler `workspaceBoundMemory` — with two real `theo_live_*` keys
 * bound to different workspaces, plus EC-4 (a body `workspaceId` → 400).
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
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
  async generateResponse(): Promise<string> {
    return Promise.resolve('[]');
  },
  async generateChat(_m: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ content: '[]', role: 'assistant' });
  },
};

/**
 * Duas escritas, dois pools, porque são duas naturezas: `workspaces` é escopada
 * (criar duas é atravessar) e `theo_api_keys` não é (é do caminho de
 * autenticação, que roda no papel de aplicação).
 */
async function seedKey(
  wsPool: pg.Pool,
  authPool: pg.Pool,
  token: string,
  workspaceId: string,
): Promise<void> {
  await wsPool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1,$1) ON CONFLICT (id) DO NOTHING`,
    [workspaceId],
  );
  await authPool.query(
    `INSERT INTO theo_api_keys (id, subject, tenant_id, workspace_id, key_name, key_hash, key_prefix, scopes)
     VALUES ($1, 'subj', 'self', $2, $3, $4, $5, $6::jsonb)`,
    [
      `apk-${randomUUID().slice(0, 16)}`,
      workspaceId,
      `key-${workspaceId}`,
      createHash('sha256').update(token).digest('hex'),
      token.slice(0, 12),
      JSON.stringify(['memory:read', 'memory:write']),
    ],
  );
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('workspace isolation REST e2e (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('workspace isolation — REST e2e (HTTP → middleware → Principal → handler)', () => {
    let pool: pg.Pool;
    /** Papel de aplicação — as tabelas de autenticação não têm RLS. */
    let authPool: pg.Pool;
    let dropDb: () => Promise<void>;
    let app: ReturnType<typeof createServer>;
    const tokenA = `theo_live_${randomUUID()}`;
    const tokenB = `theo_live_${randomUUID()}`;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      // Dois pools, dois trabalhos. O STORE atravessa: o servidor atende
      // requisições de ws-a e ws-b sobre a mesma conexão, e é o filtro da camada
      // REST que este teste mede. As tabelas de AUTENTICAÇÃO (`theo_api_keys`,
      // `users`) não são escopadas por workspace e pertencem ao caminho de
      // requisição — em produção quem as lê é o papel de aplicação, que é quem
      // as lê aqui.
      pool = iso.crossWorkspacePool('mede o isolamento da camada REST entre dois workspaces');
      authPool = iso.pool;
      dropDb = iso.dropDb;
      await seedKey(pool, authPool, tokenA, 'ws-a');
      await seedKey(pool, authPool, tokenB, 'ws-b');
      const memory: Memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: stubLlm,
      });
      app = createServer({ memory, authVerifier: new ApiKeyAuthVerifier(authPool) });
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
    });

    test('a recall scoped by Bearer key only returns the key workspace rows (cross-workspace HTTP isolation)', async () => {
      const userId = `u-${randomUUID()}`;
      // Identical remember + recall text → identical stub embedding → guaranteed
      // top hit, so the assertion isolates the WORKSPACE dimension, not ranking.
      const sharedText = 'workspace isolation canary phrase';
      // ws-A remembers via HTTP (workspace derived from the Bearer key, not the body).
      const rememberRes = await app.request('/v1/remember', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, text: sharedText, infer: false }),
      });
      expect(rememberRes.status).toBe(201);

      // Confirm the row landed in ws-a (workspace from the Bearer key).
      const stored = await pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM memories WHERE user_id = $1`,
        [userId],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]?.workspace_id).toBe('ws-a');

      // ws-B recall (its own Bearer key) for the same user → empty.
      const recallB = await app.request('/v1/recall', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, query: sharedText, threshold: 0 }),
      });
      expect(recallB.status).toBe(200);
      const bodyB = (await recallB.json()) as { results: unknown[] };
      expect(bodyB.results).toHaveLength(0);

      // ws-A recall → sees its own row.
      const recallA = await app.request('/v1/recall', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, query: sharedText, threshold: 0 }),
      });
      const bodyA = (await recallA.json()) as { results: unknown[] };
      expect(bodyA.results.length).toBeGreaterThanOrEqual(1);
    });

    test('a body workspaceId field is rejected with 400 (EC-4 — workspace comes from the credential, not the body)', async () => {
      const res = await app.request('/v1/remember', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'u1', text: 'x', infer: false, workspaceId: 'ws-b' }),
      });
      // .strict() on the body schema rejects the unknown key with a 4xx.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    test('an unknown Bearer key is rejected 401', async () => {
      const res = await app.request('/v1/recall', {
        method: 'POST',
        headers: { authorization: `Bearer theo_live_unknown`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'u1', query: 'x' }),
      });
      expect(res.status).toBe(401);
    });
  });
}
