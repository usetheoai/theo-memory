/**
 * T2.1 — ApiKeyAuthVerifier.resolvePrincipal (credential -> workspace).
 *
 * Plan multi-tenant-workspace-isolation § T2.1 / ADR D2 + EC-2.
 * Seeds keys directly in theo_api_keys (with a known SHA-256 hash) and asserts
 * resolvePrincipal returns { workspaceId, scopes } for an active key, and null
 * for a revoked / expired key (EC-2). Also asserts the env BearerAuthVerifier
 * bridges to the default workspace.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

import { ApiKeyAuthVerifier } from '../../../packages/api/src/server/auth/api-key-verifier.js';
import { BearerAuthVerifier } from '../../../packages/api/src/server/auth/bearer-verifier.js';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function seedKey(
  pool: pg.Pool,
  opts: { token: string; workspaceId: string; scopes: readonly string[]; revoked?: boolean; expired?: boolean },
): Promise<void> {
  // Ensure the workspace exists (FK).
  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [
    opts.workspaceId,
  ]);
  await pool.query(
    `INSERT INTO theo_api_keys
       (id, subject, tenant_id, workspace_id, key_name, key_hash, key_prefix, scopes, revoked_at, expires_at)
     VALUES ($1, 'test-subject', 'self', $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      `apk-${randomUUID().slice(0, 16)}`,
      opts.workspaceId,
      'test-key',
      hashOf(opts.token),
      opts.token.slice(0, 12),
      JSON.stringify(opts.scopes),
      opts.revoked === true ? new Date(Date.now() - 1000) : null,
      opts.expired === true ? new Date(Date.now() - 1000) : null,
    ],
  );
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('principal resolution (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('ApiKeyAuthVerifier.resolvePrincipal — credential -> workspace', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let verifier: ApiKeyAuthVerifier;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.pool;
      dropDb = iso.dropDb;
      verifier = new ApiKeyAuthVerifier(pool);
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    test('an active key resolves to its workspaceId + scopes', async () => {
      const token = `theo_live_${randomUUID()}`;
      await seedKey(pool, { token, workspaceId: 'ws-acme', scopes: ['memory:read', 'memory:write'] });

      const principal = await verifier.resolvePrincipal(token);
      expect(principal).not.toBeNull();
      expect(principal?.workspaceId).toBe('ws-acme');
      expect(principal?.scopes).toEqual(['memory:read', 'memory:write']);
    });

    test('a revoked key resolves to null (EC-2)', async () => {
      const token = `theo_live_${randomUUID()}`;
      await seedKey(pool, { token, workspaceId: 'ws-acme', scopes: ['memory:read'], revoked: true });
      await expect(verifier.resolvePrincipal(token)).resolves.toBeNull();
    });

    test('an expired key resolves to null (EC-2)', async () => {
      const token = `theo_live_${randomUUID()}`;
      await seedKey(pool, { token, workspaceId: 'ws-acme', scopes: ['memory:read'], expired: true });
      await expect(verifier.resolvePrincipal(token)).resolves.toBeNull();
    });

    test('an unknown token resolves to null', async () => {
      await expect(verifier.resolvePrincipal(`theo_live_${randomUUID()}`)).resolves.toBeNull();
    });

    test('the env BearerAuthVerifier bridges a matching token to the default workspace (ADR D7)', async () => {
      const bearer = new BearerAuthVerifier('env-secret-token');
      const principal = await bearer.resolvePrincipal('env-secret-token');
      expect(principal?.workspaceId).toBe('default');
      await expect(bearer.resolvePrincipal('wrong')).resolves.toBeNull();
    });
  });
}
