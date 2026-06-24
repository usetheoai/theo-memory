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
 * @see .claude/knowledge-base/plans/model-b-platform-admin-mint-plan.md § T1.2 / T1.3 (ADR D1/D3)
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

/** Seed a platform-admin key bound to a control-plane workspace. */
async function seedPlatformKey(pool: pg.Pool, token: string): Promise<void> {
  await pool.query(`INSERT INTO workspaces (id, name) VALUES ('ws-platform','ws-platform') ON CONFLICT (id) DO NOTHING`);
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
    let dropDb: () => Promise<void>;
    let app: ReturnType<typeof createServer>;
    const platformToken = `theo_live_${randomUUID()}${randomUUID()}`;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.pool;
      dropDb = iso.dropDb;
      await seedPlatformKey(pool, platformToken);
      const memory: Memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: stubLlm,
      });
      app = createServer({ memory, authVerifier: new ApiKeyAuthVerifier(pool), adminApi: { pool } });
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

    test('cross-workspace: a key bound to ws-A cannot read ws-B memories (provider-enforced)', async () => {
      // Mint two per-tenant keys via the platform credential.
      const tokenA = `theo_live_${randomUUID()}${randomUUID()}`;
      const tokenB = `theo_live_${randomUUID()}${randomUUID()}`;
      // The admin mint returns a generated secret; but to drive the data path with a
      // KNOWN token, seed the per-workspace keys directly (the mint path is covered above).
      for (const [tok, ws] of [[tokenA, 'tn-a'], [tokenB, 'tn-b']] as const) {
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1,$1) ON CONFLICT (id) DO NOTHING`, [ws]);
        await pool.query(
          `INSERT INTO theo_api_keys (id, subject, tenant_id, workspace_id, key_name, key_hash, key_prefix, scopes)
           VALUES ($1, 'subj', 'self', $2, $3, $4, $5, $6::jsonb)`,
          [
            `apk-${randomUUID().slice(0, 16)}`,
            ws,
            `key-${ws}`,
            createHash('sha256').update(tok).digest('hex'),
            tok.slice(0, 12),
            JSON.stringify(['memory:read', 'memory:write']),
          ],
        );
      }
      const userId = `u-${randomUUID()}`;
      const sharedText = 'cross workspace canary';
      // ws-B remembers.
      const rememberB = await app.request('/v1/remember', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, text: sharedText, infer: false }),
      });
      expect(rememberB.status).toBe(201);
      // ws-A recall for the same user + text → empty (different workspace key).
      const recallA = await app.request('/v1/recall', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, query: sharedText, threshold: 0 }),
      });
      expect(recallA.status).toBe(200);
      const bodyA = (await recallA.json()) as { results: unknown[] };
      expect(bodyA.results).toHaveLength(0);
    });
  });
}
