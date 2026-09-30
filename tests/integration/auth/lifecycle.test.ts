/**
 * T5.1 — Goal-metric integration test for the FAANG-grade auth-lifecycle cycle.
 *
 * 12 scenarios per plan § T5.1 Deep Dive, covering:
 *   - Camada 2 OSS lifecycle (create / list / revoke / rotate / lineage)
 *   - Bootstrap-token self-revoke (EC-3)
 *   - Camada 3 OIDC dual-validation routing + cache (EC-5)
 *   - MCP streamable-HTTP auth + WWW-Authenticate (EC-10)
 *   - MCP stdio unchanged invariant
 *   - RFC 9728 well-known discovery endpoint
 *
 * Run against real `ankane/pgvector:v0.5.1` via docker-compose (gated by
 * THEOMEM_PG_URI env — when absent, describe.skip per testing.md pyramid).
 * OIDC introspection is stubbed via injected `IntrospectFn` per the
 * OidcAuthVerifier DIP shape (no real HTTP fixture needed — that's the
 * whole point of the DIP per T3.1 ADR D1).
 *
 */
import { Hono } from 'hono';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Memory } from '@usetheo/memory';
import { runMigrations } from '@usetheo/memory';
import {
  createJwtAccessTokenVerifier,
  loadResourceServerConfig,
} from '../../../packages/mcp/src/auth/oauth-resource-server.js';
import { connectStdio } from '../../../packages/mcp/src/transports/stdio.js';
import { connectStreamableHttp } from '../../../packages/mcp/src/transports/streamable-http.js';
import {
  ApiKeyAuthVerifier,
  type AuthPool,
} from '../../../packages/api/src/server/auth/api-key-verifier.js';
import { dualValidationAuth } from '../../../packages/api/src/server/auth/dual-validation.js';
import { OidcAuthVerifier } from '../../../packages/api/src/server/auth/oidc-verifier.js';
import { requireScope } from '../../../packages/api/src/server/auth/scope-verifier.js';
import {
  createKeyHandler,
  listKeysHandler,
  revokeKeyHandler,
  rotateKeyHandler,
  lineageKeyHandler,
} from '../../../packages/api/src/server/handlers/admin-keys.js';
import { createServer } from '@usetheo/memory-api';
import type { McpServer } from '../../../packages/mcp/src/server.js';

import { buildStubIntrospect, resetAuthTables } from './_helpers.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

// EC-17 CI guard (mirrors local-runtime.test.ts) — refuse-to-false-green
if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
  throw new Error(
    'EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/** to run; refusing to false-green skip',
  );
}

const BOOTSTRAP_TOKEN = 'bootstrap-secret-' + 'a'.repeat(32);
const SUBJECT = 'self';

// Minimal stub Memory consumed by createServer when we exercise the well-known
// endpoint. Same shape as src/server/__tests__/handlers.test.ts.
function stubMemory(): Memory {
  const scoped = {
    remember: vi.fn().mockResolvedValue([]),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'job-1', derivedCount: 0 }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  const stub = {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    history: vi.fn().mockResolvedValue([]),
    reset: vi.fn().mockResolvedValue(undefined),
    flushReflections: vi.fn().mockResolvedValue(undefined),
  };
  return stub as unknown as Memory;
}

function mockMcpServer(): McpServer {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;
}

/**
 * Build a Hono admin app wiring requireScope + the 5 admin handlers.
 * Mirrors what `themory server` would compose at runtime when the admin
 * surface is wired (current production composition keeps admin routes
 * out of `createApp()` per ADR D11 DIP discipline — the integration test
 * is the canonical wiring locus until the admin sub-app ships).
 */
function buildAdminApp(pool: AuthPool, opts: { bootstrapToken?: string } = {}): Hono {
  const app = new Hono();
  app.use(
    '/v1/admin/*',
    requireScope({
      pool,
      requiredScope: 'memory:admin',
      ...(opts.bootstrapToken !== undefined ? { bootstrapToken: opts.bootstrapToken } : {}),
    }),
  );
  app.post('/v1/admin/keys', async (c) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    const viaBootstrap = token === opts.bootstrapToken;
    return createKeyHandler(c, pool, SUBJECT, { viaBootstrapToken: viaBootstrap });
  });
  app.get('/v1/admin/keys/list', async (c) => listKeysHandler(c, pool, SUBJECT));
  app.delete('/v1/admin/keys/:id', async (c) => revokeKeyHandler(c, pool, SUBJECT));
  app.post('/v1/admin/keys/:id/rotate', async (c) => rotateKeyHandler(c, pool, SUBJECT));
  app.get('/v1/admin/keys/:id/lineage', async (c) => lineageKeyHandler(c, pool, SUBJECT));
  return app;
}

interface CreatedKey {
  readonly id: string;
  readonly secret: string;
  readonly key_prefix: string;
  readonly scopes: readonly string[];
}

async function createAdminKey(
  app: Hono,
  bearer: string,
  name: string,
  scopes: readonly string[] = ['memory:admin'],
): Promise<CreatedKey> {
  const res = await app.request('/v1/admin/keys', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreatedKey;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T5.1 auth lifecycle (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  // Apply migrations once before the suite (idempotent; runMigrations handles
  // the orphan-schema detection per src/local/index.ts § runMigrations).
  // Auth tables don't carry vectors — default 1536 dim is fine here.
  // beforeAll equivalent via top-level await would be cleaner but vitest does
  // not support it; using a sentinel promise instead.
  const migrationReady = runMigrations(pool);

  afterAll(async () => {
    await migrationReady;
    await pool.query('TRUNCATE TABLE theo_api_keys, admin_config RESTART IDENTITY CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await migrationReady;
    await resetAuthTables(pool);
  });

  describe('T5.1 — auth lifecycle goal-metric (12 scenarios)', () => {
    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 1 — create_key_returns_secret_once_then_prefix_only
    // ────────────────────────────────────────────────────────────────────────
    test('1. create returns secret ONCE; list returns key_prefix only (no secret leak)', async () => {
      const app = buildAdminApp(pool, { bootstrapToken: BOOTSTRAP_TOKEN });
      const created = await createAdminKey(app, BOOTSTRAP_TOKEN, 'initial-admin');

      expect(created.secret).toMatch(/^theo_live_/);
      expect(created.key_prefix).toHaveLength(12);
      expect(created.scopes).toContain('memory:admin');

      const listRes = await app.request('/v1/admin/keys/list', {
        headers: { authorization: `Bearer ${created.secret}` },
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { keys: { key_prefix: string; secret?: string }[] };
      expect(listBody.keys).toHaveLength(1);
      // CRITICAL: list MUST NOT echo the secret back. Stripe-shape canonical.
      expect(listBody.keys[0]?.secret).toBeUndefined();
      expect(listBody.keys[0]?.key_prefix).toBe(created.key_prefix);
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 2 — revoke_key_immediately_invalidates_subsequent_call
    // ────────────────────────────────────────────────────────────────────────
    test('2. revoke → subsequent ApiKeyAuthVerifier.verify(secret) returns false', async () => {
      const app = buildAdminApp(pool, { bootstrapToken: BOOTSTRAP_TOKEN });
      const adminKey = await createAdminKey(app, BOOTSTRAP_TOKEN, 'rev-target');

      // Create a second admin key so we still have authority after revoking the first
      const adminTwo = await createAdminKey(app, adminKey.secret, 'admin-two');

      const verifier = new ApiKeyAuthVerifier(pool);
      expect(await verifier.verify(adminKey.secret)).toBe(true);

      const revRes = await app.request(`/v1/admin/keys/${adminKey.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${adminTwo.secret}` },
      });
      expect(revRes.status).toBe(204);

      // POST-REVOKE — verifier rejects the revoked key
      expect(await verifier.verify(adminKey.secret)).toBe(false);
      // adminTwo still works
      expect(await verifier.verify(adminTwo.secret)).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 3 — rotate_key_with_grace_window
    // ────────────────────────────────────────────────────────────────────────
    test('3. rotate: both keys work briefly; after grace expiry, old fails', async () => {
      const app = buildAdminApp(pool, { bootstrapToken: BOOTSTRAP_TOKEN });
      const oldKey = await createAdminKey(app, BOOTSTRAP_TOKEN, 'rotate-target');

      const rotateRes = await app.request(`/v1/admin/keys/${oldKey.id}/rotate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${oldKey.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ grace_window_hours: 24 }),
      });
      expect(rotateRes.status).toBe(200);
      const rotated = (await rotateRes.json()) as { id: string; secret: string };

      const verifier = new ApiKeyAuthVerifier(pool);
      // During grace window: BOTH keys valid
      expect(await verifier.verify(oldKey.secret)).toBe(true);
      expect(await verifier.verify(rotated.secret)).toBe(true);

      // Simulate grace expiry by forcing expires_at into the past
      await pool.query(
        `UPDATE theo_api_keys SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [oldKey.id],
      );

      // POST-EXPIRY — old fails, new still valid
      expect(await verifier.verify(oldKey.secret)).toBe(false);
      expect(await verifier.verify(rotated.secret)).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 4 — lineage_walks_chain (recursive CTE)
    // ────────────────────────────────────────────────────────────────────────
    test('4. lineage walks the rotation chain — root first, current last', async () => {
      const app = buildAdminApp(pool, { bootstrapToken: BOOTSTRAP_TOKEN });
      const root = await createAdminKey(app, BOOTSTRAP_TOKEN, 'lineage-root');

      const rot1Res = await app.request(`/v1/admin/keys/${root.id}/rotate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${root.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ grace_window_hours: 24 }),
      });
      const rot1 = (await rot1Res.json()) as { id: string; secret: string };

      const rot2Res = await app.request(`/v1/admin/keys/${rot1.id}/rotate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${rot1.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ grace_window_hours: 24 }),
      });
      const rot2 = (await rot2Res.json()) as { id: string };

      const lineageRes = await app.request(`/v1/admin/keys/${rot2.id}/lineage`, {
        headers: { authorization: `Bearer ${rot1.secret}` },
      });
      expect(lineageRes.status).toBe(200);
      const lineageBody = (await lineageRes.json()) as { lineage: { id: string }[] };

      const ids = lineageBody.lineage.map((r) => r.id);
      expect(ids).toHaveLength(3);
      expect(ids[0]).toBe(root.id); // root first (oldest created_at)
      expect(ids[2]).toBe(rot2.id); // current last (newest created_at)
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 5 — scope_check_admin_required
    // ────────────────────────────────────────────────────────────────────────
    test('5. read-only key on /v1/admin/* → 403 SCOPE_INSUFFICIENT', async () => {
      const app = buildAdminApp(pool, { bootstrapToken: BOOTSTRAP_TOKEN });
      // First create an admin key via bootstrap so we can issue a non-admin
      const admin = await createAdminKey(app, BOOTSTRAP_TOKEN, 'admin');
      const readOnly = await createAdminKey(app, admin.secret, 'read-only', ['memory:read']);

      const res = await app.request('/v1/admin/keys/list', {
        headers: { authorization: `Bearer ${readOnly.secret}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('SCOPE_INSUFFICIENT');
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 6 — bootstrap_token_bypasses_first_call_only (EC-3 absorption)
    // ────────────────────────────────────────────────────────────────────────
    test('6. bootstrap token consumed after first admin-key create; subsequent attempts blocked', async () => {
      const app = buildAdminApp(pool, { bootstrapToken: BOOTSTRAP_TOKEN });

      // First use: succeeds, creates the initial admin key
      const firstRes = await app.request('/v1/admin/keys', {
        method: 'POST',
        headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'first-admin', scopes: ['memory:admin'] }),
      });
      expect(firstRes.status).toBe(200);

      // Second use: bootstrap_consumed=true now; createKeyHandler's tx path
      // detects this and returns 401 BOOTSTRAP_CONSUMED.
      const secondRes = await app.request('/v1/admin/keys', {
        method: 'POST',
        headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'second-attempt', scopes: ['memory:admin'] }),
      });
      expect(secondRes.status).toBe(401);
      const body = (await secondRes.json()) as { code: string };
      expect(body.code).toBe('BOOTSTRAP_CONSUMED');
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 7 — oidc_dual_mode routes theo_live to apiKey verifier
    // ────────────────────────────────────────────────────────────────────────
    test('7. dualValidationAuth: theo_live_ token routes to ApiKeyAuthVerifier (not OIDC)', async () => {
      const adminApp = buildAdminApp(pool, { bootstrapToken: BOOTSTRAP_TOKEN });
      const admin = await createAdminKey(adminApp, BOOTSTRAP_TOKEN, 'dual-mode-admin');

      const apiKeyVerifier = new ApiKeyAuthVerifier(pool);
      const introspectStub = buildStubIntrospect({});
      const oidcVerifier = new OidcAuthVerifier({ introspect: introspectStub });

      const app = new Hono();
      app.use('/v1/*', dualValidationAuth({ apiKey: apiKeyVerifier, oidc: oidcVerifier }));
      app.get('/v1/test', (c) => c.json({ ok: true }, 200));

      const res = await app.request('/v1/test', {
        headers: { authorization: `Bearer ${admin.secret}` },
      });
      expect(res.status).toBe(200);
      // OIDC introspect MUST NOT have been called — routing locked at prefix
      expect(introspectStub).not.toHaveBeenCalled();
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 8 — oidc_dual_mode routes JWT to oidc verifier
    // ────────────────────────────────────────────────────────────────────────
    test('8. dualValidationAuth: JWT-shape token routes to OidcAuthVerifier', async () => {
      const apiKeyVerifier = new ApiKeyAuthVerifier(pool);
      const JWT_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
      const introspectStub = buildStubIntrospect({
        [JWT_TOKEN]: { active: true, sub: 'alice', scope: 'memory:read' },
      });
      const oidcVerifier = new OidcAuthVerifier({ introspect: introspectStub });

      const app = new Hono();
      app.use('/v1/*', dualValidationAuth({ apiKey: apiKeyVerifier, oidc: oidcVerifier }));
      app.get('/v1/test', (c) => c.json({ ok: true }, 200));

      const res = await app.request('/v1/test', {
        headers: { authorization: `Bearer ${JWT_TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(introspectStub).toHaveBeenCalledTimes(1);
      expect(introspectStub).toHaveBeenCalledWith(JWT_TOKEN, expect.any(AbortSignal));
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 9 — oidc_introspect_caches_within_ttl
    // ────────────────────────────────────────────────────────────────────────
    test('9. OidcAuthVerifier caches: 2nd verify within TTL = 1 introspection round-trip total', async () => {
      const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.cache-test.sig';
      const introspectStub = buildStubIntrospect({
        [JWT_TOKEN]: { active: true, sub: 'alice' },
      });
      // 60s TTL — well above the 2 sequential verifies we issue here
      const verifier = new OidcAuthVerifier({ introspect: introspectStub, cacheTtlSeconds: 60 });

      const r1 = await verifier.verify(JWT_TOKEN);
      const r2 = await verifier.verify(JWT_TOKEN);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      // Critical: only ONE round-trip to introspect — second is cache hit
      expect(introspectStub).toHaveBeenCalledTimes(1);
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 10 — mcp_streamable_http requires Bearer; 401 envelope EC-10
    // ────────────────────────────────────────────────────────────────────────
    test('10. MCP streamable-http without Bearer → 401 + WWW-Authenticate naming the resource metadata (usetheoai/theo#477)', async () => {
      // The MCP transport is an OAuth resource server now; API keys and introspection were
      // removed from it. The challenge must point the client at the RFC 9728 document.
      const config = loadResourceServerConfig({
        THEO_MCP_RESOURCE: 'https://memory.example.com/mcp/memory',
        THEO_OAUTH_ISSUER: 'https://auth.example.com/',
      });
      const handle = await connectStreamableHttp(mockMcpServer(), {
        port: 0,
        host: '127.0.0.1',
        oauth: { config, verifier: createJwtAccessTokenVerifier(config), logWarn: () => undefined },
      });
      try {
        const addr = handle.address();
        const port =
          addr !== null && typeof addr === 'object' ? (addr as { port: number }).port : handle.port;
        const res = await fetch(`http://127.0.0.1:${String(port)}/mcp`, { method: 'POST' });
        expect(res.status).toBe(401);
        const wwwAuth = res.headers.get('www-authenticate') ?? '';
        expect(wwwAuth).toMatch(/^Bearer\s+error="invalid_token"/);
        expect(wwwAuth).toMatch(/error_description="[^"]+"/);
        expect(wwwAuth).toContain(
          'resource_metadata="https://memory.example.com/.well-known/oauth-protected-resource/mcp/memory"',
        );
      } finally {
        await handle.close();
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 11 — mcp_stdio unchanged (no Bearer required)
    // ────────────────────────────────────────────────────────────────────────
    test('11. MCP stdio surface accepts no auth knob (structural invariant per ADR-0015 #1)', () => {
      // The structural sentinel: connectStdio has no `bearerAuth` parameter
      // because StdioServerTransport has no notion of HTTP headers. This
      // invariant guards against future refactors that try to add auth
      // into the stdio path. ADR-0015 #1 locks stdio as "single-client
      // local; scope binding via env vars per existing cli-scope.ts; no
      // Bearer required".
      expect(typeof connectStdio).toBe('function');
      expect(connectStdio.length).toBeLessThanOrEqual(1);
    });

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO 12 — well-known oauth-protected-resource resolves when OIDC enabled
    // ────────────────────────────────────────────────────────────────────────
    test('12. RFC 9728: /.well-known/oauth-protected-resource resolves when oidcDiscovery configured', async () => {
      const app = createServer({
        memory: stubMemory(),
        oidcDiscovery: {
          issuer: 'https://auth.example.com',
          resource: 'https://memory.example.com',
          resourceName: 'TheMemory MCP',
          scopesSupported: ['memory:read', 'memory:write', 'memory:delete', 'memory:admin'],
        },
      });
      const res = await app.fetch(
        new Request('http://localhost/.well-known/oauth-protected-resource'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        resource: string;
        authorization_servers: string[];
        scopes_supported: string[];
        bearer_methods_supported: string[];
      };
      expect(body.resource).toBe('https://memory.example.com');
      expect(body.authorization_servers).toEqual(['https://auth.example.com']);
      expect(body.scopes_supported).toContain('memory:admin');
      expect(body.bearer_methods_supported).toContain('header');
    });
  });
}
