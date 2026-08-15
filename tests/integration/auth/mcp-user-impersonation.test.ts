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
/** Atravessa workspaces de propósito — ver `_helpers/isolated-db.ts`. */
/** Papel contido, fixado no workspace deste arquivo. */
let scopedPool: pg.Pool;
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
  // Um workspace, dois usuários — e o eixo de usuário NÃO é uma policy: alice e
  // bob compartilham o workspace, então a policy admite os dois e só o código os
  // separa. É esse código que este arquivo mede, sobre o papel contido fixado no
  // workspace do teste.
  scopedPool = db.poolPinnedTo(WORKSPACE);
  // Migrations são DDL: papel de setup, nunca o de requisição.
  await runMigrations(db.setupPool);
  await db.crossWorkspacePool('cria a linha do workspace deste arquivo').query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`,
    [WORKSPACE],
  );
  verifier = new ApiKeyAuthVerifier(scopedPool);
  aliceSecret = await seedKey(scopedPool, 'live-alice');
  await seedKey(scopedPool, 'live-bob');
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

  it('test_key_with_blank_user_id_is_rejected_not_downgraded', async () => {
    // /review Finding 3: a user-BOUND key row with a corrupt empty user_id must fail closed
    // (401), never silently downgrade to header-trust. Reachable via direct DB write /
    // migration backfill, not the mint handler.
    const secret = `theo_live_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(secret).digest('hex');
    // A user row with an empty id satisfies the FK; the corrupt state the issue describes is a
    // key BOUND to it (user_id = '') rather than null. Reachable by direct write / backfill.
    await scopedPool.query(`INSERT INTO users (id, email) VALUES ('', 'blank@example.test') ON CONFLICT DO NOTHING`);
    await scopedPool.query(
      `INSERT INTO theo_api_keys
         (id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, workspace_id, user_id)
       VALUES ($1, 'blank', 'self', 'blank', $2, $3, $4::jsonb, $5, '')`,
      [randomUUID().slice(0, 20), hash, secret.slice(0, 12), JSON.stringify(['memory:read']), WORKSPACE],
    );

    const delegate = vi.fn(async () => {});
    const handler = withBearerAuth(delegate, { apiKey: verifier });
    const res = mockRes();
    await handler(
      { headers: { authorization: `Bearer ${secret}`, 'x-theo-user-id': 'live-bob' } } as unknown as IncomingMessage,
      res,
    );

    expect(delegate).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('test_platform_admin_key_marks_the_request_gateway_trusted', async () => {
    // /review Finding 2: a workspace-level key MAY act-as-user, but ONLY when it carries
    // memory:platform-admin — the scope only the theo-cloud gateway credential holds. Then and
    // only then does markGatewayTrusted fire, so `X-Theo-User-Id` is honoured.
    const { isGatewayTrusted } = await import('../../../packages/mcp/src/auth/request-workspace.js');
    const secret = `theo_live_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(secret).digest('hex');
    // Workspace-level (user_id NULL) key bearing platform-admin — the gateway credential shape.
    await scopedPool.query(
      `INSERT INTO theo_api_keys
         (id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, workspace_id, user_id)
       VALUES ($1, 'gw', 'self', 'gw', $2, $3, $4::jsonb, $5, NULL)`,
      [randomUUID().slice(0, 20), hash, secret.slice(0, 12), JSON.stringify(['memory:platform-admin']), WORKSPACE],
    );

    let gatewayTrusted = false;
    let resolvedUser: string | undefined;
    const delegate = async (req: IncomingMessage) => {
      gatewayTrusted = isGatewayTrusted(req);
      resolvedUser = scopeFromRequest(req)?.session?.userId;
    };
    await withBearerAuth(delegate, { apiKey: verifier })(
      { headers: { authorization: `Bearer ${secret}`, 'x-theo-user-id': 'end-user' } } as unknown as IncomingMessage,
      mockRes(),
    );

    expect(gatewayTrusted).toBe(true);
    expect(resolvedUser).toBe('end-user'); // the gateway's injected user is honoured
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
