/**
 * T4.1 GOAL TEST — 6 e2e scenarios for theo-memory-faang-auth-lifecycle-fixes-cycle-1.
 *
 * Closes both deferrals from parent cycle end-to-end:
 *   1. Admin REST wired via createServer({ adminApi }) round-trips correctly
 *   2. CLI `themory keys` round-trips against running server
 *   3. revoke invalidates subsequent verifier calls
 *   4. createOauth4webapiIntrospect against stub RFC 7662 issuer validates active token
 *   5. dualValidationAuth routes theo_live_ → apikey, JWT → real OIDC adapter
 *   6. well-known endpoint serves correct metadata when oidcDiscovery configured
 *
 * EC-10 absorption: afterEach hook closes ALL spawned listeners via
 * Promise.allSettled — prevents EADDRINUSE cascade if a scenario crashes.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-fixes-cycle-1-plan.md § T4.1
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Memory } from '../../../src/core/memory-store.js';
import { runMigrations } from '../../../src/local/index.js';
import { ApiKeyAuthVerifier } from '../../../src/server/auth/api-key-verifier.js';
import { dualValidationAuth } from '../../../src/server/auth/dual-validation.js';
import { createOauth4webapiIntrospect } from '../../../src/server/auth/oidc-introspect-oauth4webapi.js';
import { OidcAuthVerifier } from '../../../src/server/auth/oidc-verifier.js';
import { createServer } from '../../../src/server/index.js';
import { runKeysCreate, runKeysList } from '../../../src/agent-tools/run-keys.js';

import { resetAuthTables } from './_helpers.js';
import { startStubIssuer, type StubIssuerHandle } from './_stub-issuer.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
  throw new Error(
    'EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/** to run; refusing to false-green skip',
  );
}

const BOOTSTRAP_TOKEN = 'bootstrap-fixes-cycle-1-' + 'z'.repeat(32);

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

interface HttpHandle {
  readonly port: number;
  close(): Promise<void>;
}

async function spawnHonoOnPort(app: Hono | ReturnType<typeof createServer>): Promise<HttpHandle> {
  return new Promise((resolve) => {
    const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info: { port: number }) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((done) => {
            // @ts-expect-error @hono/node-server returns http.Server-like
            listener.close(() => done());
          }),
      });
    });
  });
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T4.1 fixes-cycle-1 e2e (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const migrationReady = runMigrations(pool, { embeddingDim: 384 });

  // EC-10 — collect handles spawned in each test for guaranteed cleanup
  const handles: { httpHandles: HttpHandle[]; stubIssuers: StubIssuerHandle[] } = {
    httpHandles: [],
    stubIssuers: [],
  };

  afterAll(async () => {
    await migrationReady;
    await pool.query('TRUNCATE TABLE theo_api_keys, admin_config RESTART IDENTITY CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await migrationReady;
    await resetAuthTables(pool);
    handles.httpHandles = [];
    handles.stubIssuers = [];
  });

  afterEach(async () => {
    // EC-10: Promise.allSettled — never let one cleanup failure block others
    await Promise.allSettled([
      ...handles.httpHandles.map((h) => h.close()),
      ...handles.stubIssuers.map((s) => s.close()),
    ]);
  });

  describe('T4.1 fixes-cycle-1 GOAL TEST — 6 e2e scenarios', () => {
    test('1. themory_server_with_adminApi_serves_admin_keys_routes — POST /v1/admin/keys returns 200 with bootstrap', async () => {
      const app = createServer({
        memory: stubMemory(),
        adminApi: { pool, bootstrapToken: BOOTSTRAP_TOKEN },
      });
      const handle = await spawnHonoOnPort(app);
      handles.httpHandles.push(handle);

      const res = await fetch(`http://127.0.0.1:${String(handle.port)}/v1/admin/keys`, {
        method: 'POST',
        headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'e2e-test-key', scopes: ['memory:admin'] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; secret: string; key_prefix: string };
      expect(body.id).toMatch(/^apk-[0-9a-f]{16}$/);
      expect(body.secret).toMatch(/^theo_live_/);
    });

    test('2. themory_keys_cli_create_then_list_round_trips_against_running_server', async () => {
      const app = createServer({
        memory: stubMemory(),
        adminApi: { pool, bootstrapToken: BOOTSTRAP_TOKEN },
      });
      const handle = await spawnHonoOnPort(app);
      handles.httpHandles.push(handle);

      const stdout: string[] = [];
      const stderr: string[] = [];
      const ctx = {
        baseUrl: `http://127.0.0.1:${String(handle.port)}`,
        bearerToken: BOOTSTRAP_TOKEN,
        writeStdout: (s: string) => stdout.push(s),
        writeStderr: (s: string) => stderr.push(s),
      };

      const createCode = await runKeysCreate(ctx, {
        name: 'cli-round-trip',
        scopes: ['memory:admin'],
      });
      expect(createCode).toBe(0);
      // Show-once secret was printed
      expect(stdout.join('')).toMatch(/theo_live_/);

      // Extract created admin key from stdout
      const createOutput = stdout.join('');
      const adminSecretMatch = createOutput.match(/theo_live_[A-Za-z0-9_-]{40,}/);
      expect(adminSecretMatch).not.toBeNull();
      const adminSecret = adminSecretMatch![0];

      // Now LIST with the admin key
      const listCtx = { ...ctx, bearerToken: adminSecret };
      const listStdout: string[] = [];
      listCtx.writeStdout = (s: string) => listStdout.push(s);
      const listCode = await runKeysList(listCtx);
      expect(listCode).toBe(0);
      const listOutput = listStdout.join('');
      expect(listOutput).toContain('cli-round-trip');
    });

    test('3. revoke_invalidates_subsequent_auth_via_real_verifier_path', async () => {
      // Create a key via bootstrap, verify it works, then revoke + verify rejected
      const app = createServer({
        memory: stubMemory(),
        adminApi: { pool, bootstrapToken: BOOTSTRAP_TOKEN },
      });
      const handle = await spawnHonoOnPort(app);
      handles.httpHandles.push(handle);

      const createRes = await fetch(`http://127.0.0.1:${String(handle.port)}/v1/admin/keys`, {
        method: 'POST',
        headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'rev-target', scopes: ['memory:admin'] }),
      });
      const created = (await createRes.json()) as { id: string; secret: string };

      const verifier = new ApiKeyAuthVerifier(pool);
      expect(await verifier.verify(created.secret)).toBe(true);

      // Revoke via /v1/admin/keys/:id — using bootstrap Bearer (still valid since bootstrap_consumed
      // flips only when create+admin-scope; subsequent bootstrap reads return 401, but DELETE just
      // needs admin scope which bootstrap implicitly has via requireScope bypass)
      const revRes = await fetch(`http://127.0.0.1:${String(handle.port)}/v1/admin/keys/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${created.secret}` }, // use just-created key for self-revoke
      });
      expect(revRes.status).toBe(204);

      // POST-REVOKE — verifier rejects
      expect(await verifier.verify(created.secret)).toBe(false);
    });

    test('4. createOauth4webapiIntrospect_against_stubbed_issuer_validates_active_token', async () => {
      const VALID_TOKEN = 'valid-oidc-jwt-test-token';
      const issuer = await startStubIssuer({
        activeTokens: { [VALID_TOKEN]: { sub: 'alice', scope: 'memory:read' } },
      });
      handles.stubIssuers.push(issuer);

      const introspect = await createOauth4webapiIntrospect({
        issuer: issuer.issuerUrl,
        clientId: 'theo-memory-test',
        clientSecret: 'test-client-secret',
        allowInsecure: true, // stub issuer runs on http://127.0.0.1; oauth4webapi blocks HTTP by default
      });

      const ac = new AbortController();
      const validResult = await introspect(VALID_TOKEN, ac.signal);
      expect(validResult.active).toBe(true);
      expect(validResult.sub).toBe('alice');

      const invalidResult = await introspect('some-revoked-token', ac.signal);
      expect(invalidResult.active).toBe(false);
    });

    test('5. dualValidationAuth_routes_theo_live_to_apikey_and_jwt_to_real_oauth4webapi_path', async () => {
      // Setup: real adapter against stub issuer + real ApiKeyAuthVerifier against pgvector
      const JWT_TOKEN = 'jwt-shape-token-for-dual-test';
      const issuer = await startStubIssuer({
        activeTokens: { [JWT_TOKEN]: { sub: 'oidc-user' } },
      });
      handles.stubIssuers.push(issuer);

      // Provision an admin key via direct INSERT (skip bootstrap; faster)
      const { createHash } = await import('node:crypto');
      const adminToken = `theo_live_${'q'.repeat(40)}`;
      const adminHash = createHash('sha256').update(adminToken).digest('hex');
      await pool.query(
        `INSERT INTO theo_api_keys (id, subject, tenant_id, key_name, key_hash, key_prefix, scopes)
         VALUES ($1, 'self', 'self', 'dual-test', $2, $3, $4)`,
        ['apk-' + 'a'.repeat(16), adminHash, adminToken.slice(0, 12), JSON.stringify(['memory:read'])],
      );

      const apiKey = new ApiKeyAuthVerifier(pool);
      const introspect = await createOauth4webapiIntrospect({
        issuer: issuer.issuerUrl,
        clientId: 'theo-memory-test',
        clientSecret: 'test-client-secret',
        allowInsecure: true, // stub issuer over HTTP
      });
      const oidc = new OidcAuthVerifier({ introspect });

      const app = new Hono();
      app.use('/v1/*', dualValidationAuth({ apiKey, oidc }));
      app.get('/v1/probe', (c) => c.json({ ok: true }, 200));

      // theo_live_ path → ApiKeyAuthVerifier SHA-256 lookup → 200
      const r1 = await app.request('/v1/probe', { headers: { authorization: `Bearer ${adminToken}` } });
      expect(r1.status).toBe(200);

      // JWT-shape path → OIDC introspect against stub → 200
      const r2 = await app.request('/v1/probe', { headers: { authorization: `Bearer ${JWT_TOKEN}` } });
      expect(r2.status).toBe(200);

      // unknown token → both reject → 401
      const r3 = await app.request('/v1/probe', { headers: { authorization: `Bearer unknown-token-xxx` } });
      expect(r3.status).toBe(401);
    });

    test('6. well_known_resolves_when_oidcDiscovery_propagated_via_createServer', async () => {
      const issuer = await startStubIssuer({ activeTokens: {} });
      handles.stubIssuers.push(issuer);

      const app = createServer({
        memory: stubMemory(),
        oidcDiscovery: {
          issuer: issuer.issuerUrl,
          resource: 'http://localhost:8080',
          resourceName: 'TheMemory test',
          scopesSupported: ['memory:read', 'memory:write', 'memory:delete', 'memory:admin'],
        },
      });
      const handle = await spawnHonoOnPort(app);
      handles.httpHandles.push(handle);

      const res = await fetch(`http://127.0.0.1:${String(handle.port)}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        resource: string;
        authorization_servers: string[];
        scopes_supported: string[];
        bearer_methods_supported: string[];
      };
      expect(body.resource).toBe('http://localhost:8080');
      expect(body.authorization_servers).toEqual([issuer.issuerUrl]);
      expect(body.scopes_supported).toContain('memory:admin');
      expect(body.bearer_methods_supported).toContain('header');
    });
  });
}
