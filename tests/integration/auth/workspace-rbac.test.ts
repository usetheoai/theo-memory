/**
 * THE GOAL TEST (Slice 2) — RBAC last-owner invariant + anti-escalation guard.
 *
 * Against real pgvector:
 *   - the last-owner invariant is ATOMIC: two concurrent owner-demotions →
 *     exactly one succeeds, one returns last_owner, and ≥ 1 owner remains
 *     (proves the FOR UPDATE row-lock serializes the TOCTOU window);
 *   - the key-mint anti-escalation guard: minting a key bound to a member who
 *     outranks the caller → 403; bound to a non-member → 422; bound to a
 *     lower/equal member → 200.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';

import { createApp } from '../../../packages/api/src/server/app.js';
import { ApiKeyAuthVerifier } from '../../../packages/api/src/server/auth/api-key-verifier.js';
import { createPostgresMembersRepository } from '../../../packages/api/src/server/store/members-store-pg.js';
import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const emptyJsonLlm: LLM = {
  generateResponse: () => Promise.resolve('[]'),
  generateChat: (_m: readonly Message[]): Promise<LLMResponse> =>
    Promise.resolve({ content: '[]', role: 'assistant' }),
};

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function seedUser(pool: pg.Pool, ws: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    userId,
    `${userId}@x.local`,
  ]);
  await pool.query(
    `INSERT INTO workspace_users (workspace_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [ws, userId, role],
  );
}

async function seedKey(pool: pg.Pool, token: string, ws: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO theo_api_keys
       (id, subject, tenant_id, workspace_id, user_id, key_name, key_hash, key_prefix, scopes)
     VALUES ($1, 'self', 'self', $2, $3, 'k', $4, $5, '["memory:read","memory:write","memory:delete","memory:admin"]'::jsonb)`,
    [`apk-${randomUUID().slice(0, 16)}`, ws, userId, hashOf(token), token.slice(0, 12)],
  );
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('RBAC GOAL TEST (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('THE GOAL TEST — RBAC last-owner + anti-escalation', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let memory: Memory;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('wsrbac');
      dropDb = iso.dropDb;
      memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
      });
      await pool.query(`INSERT INTO workspaces (id, name) VALUES ('wsrbac', 'wsrbac') ON CONFLICT (id) DO NOTHING`);
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM workspace_users WHERE workspace_id = 'wsrbac'`);
    });

    test('two concurrent owner-demotions → exactly one last_owner; ≥1 owner remains (D3 FOR UPDATE)', async () => {
      const repo = createPostgresMembersRepository(pool);
      await seedUser(pool, 'wsrbac', 'o1', 'owner');
      await seedUser(pool, 'wsrbac', 'o2', 'owner');

      // Fire both demotions concurrently. Without the FOR UPDATE lock both read
      // owners=2 and both demote → 0 owners. With it, the second serializes and
      // sees owners=1 → last_owner.
      const [r1, r2] = await Promise.all([
        repo.setRole('wsrbac', 'o1', 'member'),
        repo.setRole('wsrbac', 'o2', 'member'),
      ]);

      const okCount = [r1, r2].filter((r) => r.ok).length;
      const lastOwnerCount = [r1, r2].filter((r) => !r.ok && r.reason === 'last_owner').length;
      expect(okCount).toBe(1);
      expect(lastOwnerCount).toBe(1);

      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM workspace_users WHERE workspace_id = 'wsrbac' AND role = 'owner'`,
      );
      expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
    });

    test('demoting the only owner → last_owner (control)', async () => {
      const repo = createPostgresMembersRepository(pool);
      await seedUser(pool, 'wsrbac', 'solo', 'owner');
      const res = await repo.setRole('wsrbac', 'solo', 'member');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('last_owner');
    });

    describe('anti-escalation guard on key mint (D4)', () => {
      function appWith(): ReturnType<typeof createApp> {
        return createApp({
          memory,
          authVerifier: new ApiKeyAuthVerifier(pool),
          adminApi: { pool },
          membersRepository: createPostgresMembersRepository(pool),
        });
      }

      test('admin minting a key bound to an OWNER member → 403', async () => {
        await seedUser(pool, 'wsrbac', 'u-admin', 'admin');
        await seedUser(pool, 'wsrbac', 'u-owner', 'owner');
        const adminTok = `theo_live_${randomUUID()}`;
        await seedKey(pool, adminTok, 'wsrbac', 'u-admin');
        const res = await appWith().request('/v1/admin/keys', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'k', scopes: ['memory:read'], user_id: 'u-owner' }),
        });
        expect(res.status).toBe(403);
        expect((await res.json())).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
      });

      test('admin minting a key bound to a non-member → 422', async () => {
        await seedUser(pool, 'wsrbac', 'u-admin', 'admin');
        const adminTok = `theo_live_${randomUUID()}`;
        await seedKey(pool, adminTok, 'wsrbac', 'u-admin');
        const res = await appWith().request('/v1/admin/keys', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'k', scopes: ['memory:read'], user_id: 'ghost-user' }),
        });
        expect(res.status).toBe(422);
        expect((await res.json())).toMatchObject({ code: 'USER_NOT_MEMBER' });
      });

      test('admin minting a key bound to a MEMBER (lower rank) → 200', async () => {
        await seedUser(pool, 'wsrbac', 'u-admin', 'admin');
        await seedUser(pool, 'wsrbac', 'u-mem', 'member');
        const adminTok = `theo_live_${randomUUID()}`;
        await seedKey(pool, adminTok, 'wsrbac', 'u-admin');
        const res = await appWith().request('/v1/admin/keys', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'k', scopes: ['memory:read'], user_id: 'u-mem' }),
        });
        expect(res.status).toBe(200);
        const created = (await res.json()) as { secret?: string };
        expect(created.secret).toMatch(/^theo_live_/);
      });

      // Regression for the /review BLOCKER (F-dom-auth-1 / F-dom-db-1): a key
      // minted by a NON-default-workspace admin MUST carry that admin's
      // workspace_id, not the schema default 'default'. Before the fix the
      // INSERT omitted workspace_id, cross-tenant-misplacing every minted key.
      test('a key minted by a wsrbac admin carries workspace_id=wsrbac (BLOCKER regression)', async () => {
        await seedUser(pool, 'wsrbac', 'u-admin', 'admin');
        const adminTok = `theo_live_${randomUUID()}`;
        await seedKey(pool, adminTok, 'wsrbac', 'u-admin');
        const res = await appWith().request('/v1/admin/keys', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'minted', scopes: ['memory:read'] }),
        });
        expect(res.status).toBe(200);
        const created = (await res.json()) as { id: string };
        const { rows } = await pool.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM theo_api_keys WHERE id = $1`,
          [created.id],
        );
        expect(rows[0]?.workspace_id).toBe('wsrbac');
      });

      // F-dom-auth-2 (default-deny): a caller key whose bound user has NO
      // membership row resolves to the least-privileged 'member' — NEVER 'owner'
      // (the pre-fix code initialized callerRole to 'owner'). So such a caller
      // cannot mint a key bound to an owner.
      test('a caller with no membership row is default-deny member; cannot bind a key to an owner', async () => {
        await seedUser(pool, 'wsrbac', 'u-owner', 'owner');
        // Key exists (passes requireScope) but its user has no workspace_users row
        // → role-join yields NULL → default-deny 'member'. Insert the bare user
        // (FK theo_api_keys.user_id → users.id) WITHOUT a membership row.
        await pool.query(
          `INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          ['user-without-membership', 'no-member@x.local'],
        );
        const noMemberTok = `theo_live_${randomUUID()}`;
        await seedKey(pool, noMemberTok, 'wsrbac', 'user-without-membership');
        const res = await appWith().request('/v1/admin/keys', {
          method: 'POST',
          headers: { Authorization: `Bearer ${noMemberTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'k', scopes: ['memory:read'], user_id: 'u-owner' }),
        });
        expect(res.status).toBe(403);
        expect((await res.json())).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
      });
    });
  });
}
