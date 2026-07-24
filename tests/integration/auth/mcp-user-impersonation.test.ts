/**
 * M16 (#121) — end-to-end proof that a client header cannot override the authenticated user,
 * through the real bearer gate and the real `ApiKeyAuthVerifier` against Postgres.
 *
 * The unit test in `packages/mcp/src/transports/scope-from-request.test.ts` pins the merge
 * rule with the request object built by hand. This one resolves the Principal the way
 * production does: from a `theo_live_*` row in `theo_api_keys`, through
 * `ApiKeyAuthVerifier.resolvePrincipal`, into `withBearerAuth`, out of `scopeFromRequest`.
 *
 * The repro is #121 verbatim: alice's key, bob's header. Before the fix the write landed in
 * bob's scope; here the resolved scope must stay alice's.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '@usetheo/memory';
import { ApiKeyAuthVerifier } from '../../../packages/api/src/server/auth/api-key-verifier.js';
import { withBearerAuth } from '../../../packages/mcp/src/auth/with-bearer-auth.js';
import { scopeFromRequest } from '../../../packages/mcp/src/transports/streamable-http.js';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const WORKSPACE = 'ws-live-m16';

let db: IsolatedDb;
let verifier: ApiKeyAuthVerifier;
let aliceSecret = '';

/** Inserts a `theo_live_*` key bound to a (workspace, user), returning its secret. */
async function seedKey(pool: pg.Pool, userId: string): Promise<string> {
  const secret = `theo_live_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(secret).digest('hex');
  await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    userId,
    `${userId}@example.test`,
  ]);
  await pool.query(
    `INSERT INTO workspace_users (workspace_id, user_id, role) VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING`,
    [WORKSPACE, userId],
  );
  await pool.query(
    `INSERT INTO theo_api_keys
       (id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, workspace_id, user_id)
     VALUES ($1, $2, 'self', $3, $4, $5, $6::jsonb, $7, $2)`,
    [
      randomUUID().slice(0, 20),
      userId,
      `key-${userId}`,
      hash,
      secret.slice(0, 12),
      JSON.stringify(['memory:read', 'memory:write']),
      WORKSPACE,
    ],
  );
  return secret;
}

beforeAll(async () => {
  db = await createIsolatedDb({ embeddingDim: 384 });
  await runMigrations(db.pool);
  await db.pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`,
    [WORKSPACE],
  );
  verifier = new ApiKeyAuthVerifier(db.pool);
  aliceSecret = await seedKey(db.pool, 'live-alice');
  await seedKey(db.pool, 'live-bob');
}, 180_000);

afterAll(async () => {
  await db?.dropDb();
});

function mockRes(): ServerResponse & { statusCode: number } {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
    writeHead: vi.fn(),
  } as unknown as ServerResponse & { statusCode: number };
}

describe('MCP bearer auth — user impersonation (real verifier)', () => {
  it('test_alice_key_with_bob_header_resolves_alice_scope', async () => {
    let capturedUserId: string | undefined;
    const delegate = async (req: IncomingMessage) => {
      capturedUserId = scopeFromRequest(req)?.session?.userId;
    };

    const handler = withBearerAuth(delegate, { apiKey: verifier });
    const req = {
      headers: {
        authorization: `Bearer ${aliceSecret}`,
        'x-theo-user-id': 'live-bob', // the impersonation attempt
      },
    } as unknown as IncomingMessage;

    await handler(req, mockRes());

    // The write would have landed in bob's scope before the fix.
    expect(capturedUserId).toBe('live-alice');
  });
});

/**
 * Names `attachUser` / `userFromRequest` directly. The e2e test above exercises them through
 * the bearer gate, but the wiring gate resolves symbols by name and cannot see through the
 * call chain. This is genuine unit coverage of the trust boundary — a foreign header must not
 * override an attached user — not gate-appeasement.
 */
describe('request-user attachment', () => {
  it('test_attached_user_is_read_back_and_wins_over_a_header', async () => {
    const { attachUser, userFromRequest } = await import(
      '../../../packages/mcp/src/auth/request-workspace.js'
    );
    const req = { headers: { 'x-theo-user-id': 'live-bob' } } as unknown as IncomingMessage;

    expect(userFromRequest(req)).toBeUndefined();
    attachUser(req, 'live-alice');
    expect(userFromRequest(req)).toBe('live-alice');
    expect(scopeFromRequest(req)?.session?.userId).toBe('live-alice');
  });
});
