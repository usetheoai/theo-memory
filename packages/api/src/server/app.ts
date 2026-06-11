/**
 * Hono app composer: mounts the 4 verbs under `/v1`, applies optional
 * bearer middleware, and ships a catch-all `app.onError` that returns the
 * sanitized 500 envelope (EC-10). Domain-error mapping (InvalidScope,
 * MemoryNotFound, etc.) lands in T1.6 — this task keeps the catch-all tight.
 *
 * @see Plan theo-memory-standalone-p0 § T1.2 + ADR D11 (DI factory shape)
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Tracer } from '@opentelemetry/api';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import type { AuthVerifier } from '@usetheo/memory/contract';
import { ContentTooLargeError } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';

import type { AuthPool } from './auth/api-key-verifier.js';
import { bearerAuth } from './auth/middleware.js';
import { requireScope } from './auth/scope-verifier.js';
import { mapDomainErrorToResponse } from './errors.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import {
  createKeyHandler,
  lineageKeyHandler,
  listKeysHandler,
  revokeKeyHandler,
  rotateKeyHandler,
} from './handlers/admin-keys.js';
import { forgetHandler } from './handlers/forget.js';
import { healthDbHandler, healthHandler } from './handlers/health.js';
import { recallHandler } from './handlers/recall.js';
import { reflectHandler } from './handlers/reflect.js';
import { rememberHandler } from './handlers/remember.js';
import { scopesHandler } from './handlers/scopes.js';
import {
  wellKnownOauthProtectedResourceHandler,
  type OidcDiscoveryConfig,
} from './handlers/well-known.js';
import { otelMiddleware } from './observability/otel-middleware.js';
import { registerAllPaths } from './openapi-registration.js';

/**
 * T1.1 + ADR D1 — admin REST sub-app configuration. When supplied, mounts
 * `/v1/admin/keys/*` under `requireScope({ requiredScope: 'memory:admin' })`.
 * Backward-compat: omit `adminApi` and the sub-app is NOT mounted (every
 * existing `createServer({ memory })` continues to boot identically).
 */
export interface AdminApiOptions {
  /** pg.Pool-shaped DB access for the 5 admin handlers + scope verifier. */
  readonly pool: AuthPool;
  /**
   * Single-use bootstrap admin token sourced from env per ADR D4 (NEVER a
   * CLI flag — would leak via `ps`). Bearer matching this exact value
   * bypasses scope check on first call; EC-3 self-revoke in
   * `createKeyHandler` atomically flips `admin_config.bootstrap_consumed`
   * after the first admin key is issued.
   */
  readonly bootstrapToken?: string;
}

/** ADR-0014 D6 — single-tenant OSS variant; subject is the constant `'self'`. */
const ADMIN_SUBJECT = 'self';

export interface CreateServerOptions {
  readonly memory: Memory;
  readonly authVerifier?: AuthVerifier;
  /**
   * Optional DB liveness probe injected by the composition root (CLI's
   * `themory server` subcommand at T2.3) without forcing `src/server/` to
   * import `pg` — DIP discipline per ADR D11 + `architecture.md § 3`.
   * Wraps a single `pool.query('SELECT 1')` in a 2s timeout (per EC-17).
   * When omitted, `GET /v1/health/db` returns 503 with `no_probe_configured`.
   */
  readonly dbProbe?: () => Promise<void>;
  /**
   * Optional OTel `Tracer` injected by the composition root. When omitted,
   * `trace.getTracer('@usetheo/memory/server', '0.1.0-alpha')` resolves to
   * the global no-op tracer — zero cost for consumers without an OTel
   * provider registered. DIP discipline per ADR D11; mirrors
   * `createLocalMemory({ tracer })`.
   */
  readonly tracer?: Tracer;
  /**
   * Optional readiness predicate consulted by `GET /v1/health` per EC-33.
   * Returns `true` once the composition root has finished warming critical
   * subsystems (typically: `createLocalMemory(...)` resolved). While the
   * probe returns `false`, `/v1/health` answers 503 `warming_up` so
   * orchestrators (Kubernetes readinessProbe, ECS health) do not route
   * traffic until the Memory factory has booted. When omitted, the gate
   * is a no-op and `/v1/health` answers 200 immediately (backward compat
   * for callers that pre-warm before invoking `createServer`).
   */
  readonly readinessProbe?: () => boolean;
  /**
   * T4.2 + ADR-0015 #4 — when supplied, exposes RFC 9728 metadata at
   * `/.well-known/oauth-protected-resource` so MCP clients can auto-discover
   * the OIDC issuer + supported scopes WITHOUT manual config. The endpoint
   * is auth-exempt (mounted BEFORE the bearer middleware) — clients fetch
   * it before having a token. When omitted, the well-known endpoint returns
   * 404 `OIDC_DISCOVERY_NOT_CONFIGURED` (honest no-OIDC signal).
   */
  readonly oidcDiscovery?: OidcDiscoveryConfig;
  /**
   * T1.1 + ADR D1 — opt-in admin REST sub-app. When supplied, mounts
   * `/v1/admin/keys/*` under `requireScope({ requiredScope: 'memory:admin' })`.
   * When omitted, admin routes return 404 (backward-compat for consumers
   * who don't need admin lifecycle).
   */
  readonly adminApi?: AdminApiOptions;
}

export function createApp(options: CreateServerOptions): OpenAPIHono {
  const { memory, authVerifier, dbProbe, tracer, readinessProbe, oidcDiscovery, adminApi } = options;

  // EC-1 absorption — pool runtime guard. TS allows `adminApi: { pool: undefined as any }`
  // via cast escape OR consumer JS may pass `{ adminApi: {} }` without types. Fail synchronously
  // at boot with a clear error rather than crashing deep in the first admin request.
  if (adminApi !== undefined && (!adminApi.pool || typeof adminApi.pool.query !== 'function')) {
    throw new Error(
      `createServer: adminApi.pool is required when adminApi is supplied; got typeof pool=${typeof adminApi.pool}`,
    );
  }

  const app = new OpenAPIHono();

  // EC-19 absorption — /v1/openapi.json MUST resolve auth-exempt even when
  // THEMEMORY_API_KEY is configured. Codegen tools (openapi-generator,
  // Postman, Swagger UI) fetch the spec BEFORE having credentials. Mount
  // BEFORE the bearer middleware so the route resolves first (Hono executes
  // middleware along the matched path; ordering here is load-bearing per
  // SEPA pre-RED iter 5 CRITICAL).
  registerAllPaths(app.openAPIRegistry);
  app.doc('/v1/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: '@usetheo/memory REST API',
      version: '0.1.0-alpha',
      description:
        'Standalone REST distribution surface for TheMemory — 4 verbs ' +
        '(remember/recall/forget/reflect) + health + paginated scope listing.',
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
  });

  // OTel span middleware mounts BEFORE everything else so spans capture all
  // requests (including 401s + 413s). Scope `/v1/*` so /v1/openapi.json
  // itself also gets a span without polluting unrelated routes. Per T1.5 +
  // EC-21 + EC-22.
  app.use('/v1/*', otelMiddleware(tracer));

  // fixes-cycle-1 T2.1 / F-rev-4 absorption: bodyLimit middleware caps
  // request bodies at 1MB BEFORE bearer is consulted. Order is load-bearing
  // per ADR D3 v1.1: OTel → bodyLimit → bearer. EC-1 absorption: the
  // onError callback constructs the structured T1.6 envelope via
  // mapDomainErrorToResponse(new ContentTooLargeError(...)) so 413 carries
  // the same {code, message} shape as every other 4xx response (consumers
  // parsing 4xx envelopes uniformly would break with the default plain 413).
  // The `-1` actualSize sentinel signals the actual size is unknown at limit
  // hit (hono does not surface it).
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: 1_000_000,
      onError: (c) => {
        const { status, body } = mapDomainErrorToResponse(
          new ContentTooLargeError(1_000_000, -1),
        );
        return c.json(body, status as Parameters<typeof c.json>[1]);
      },
    }),
  );

  // red-team-full-system-fixes-cycle-1 T2.2 / ADR D3 — CORS middleware.
  // Mounted BEFORE bearer so OPTIONS preflight succeeds without auth.
  // EC-2: when origin='*', hono/cors does NOT set credentials:true (Fetch spec).
  // EC-5: maxAge=86400 (24h) so browsers cache preflight.
  const corsOrigin = process.env['THEMORY_CORS_ORIGIN'] ?? '*';
  if (corsOrigin === '*' && process.env['NODE_ENV'] === 'production') {
    // T1.2 — fail-fast in production per OWASP A01:2021 (ADR D2, EC-2).
    // Guard fires ONLY when NODE_ENV === 'production'; test/dev/undefined are permissive.
    throw new Error(
      'THEMORY_CORS_ORIGIN must be set when NODE_ENV=production. ' +
        'Wildcard CORS in production is a security misconfiguration (OWASP A01:2021).',
    );
  }
  app.use(
    '/v1/*',
    cors({
      origin: corsOrigin,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    }),
  );

  // red-team-full-system-fixes-cycle-1 T2.1 / ADR D2 — rate-limit middleware.
  // Write endpoints share one limiter (default 30/min); read endpoints share
  // another (default 100/min). Health is exempt (mounted before this).
  app.post('/v1/remember', rateLimitMiddleware('write'));
  app.post('/v1/forget', rateLimitMiddleware('write'));
  app.post('/v1/reflect', rateLimitMiddleware('write'));
  app.post('/v1/recall', rateLimitMiddleware('read'));
  app.get('/v1/scopes/*', rateLimitMiddleware('read'));

  // Health endpoints (T3.5 absorption — surfaced by the docker-compose
  // healthcheck round-trip): orchestrator liveness/readiness probes do not
  // carry credentials, so `/v1/health` + `/v1/health/db` MUST be
  // auth-exempt even when THEMEMORY_API_KEY is configured. Mount BEFORE
  // the bearer middleware so the routes resolve first along the matched
  // path (same load-bearing ordering as `/v1/openapi.json` per EC-19).
  // Mirrors RFC 9110 + OWASP `/healthz` convention — gated health
  // endpoints break Kubernetes / docker-compose `--wait` readiness gates.
  app.get('/v1/health', (c) => healthHandler(c, readinessProbe));
  app.get('/v1/health/db', (c) => healthDbHandler(c, dbProbe));

  // T4.2 / ADR-0015 #4 — RFC 9728 discovery endpoint MUST be auth-exempt.
  // MCP clients fetch it BEFORE having a token. Mount BEFORE bearer
  // middleware AND outside the `/v1/*` prefix per the RFC 9728 well-known
  // URI pattern. Returns 404 when no oidcDiscovery configured (handler
  // owns the 404 envelope — see well-known.ts).
  app.get(
    '/.well-known/oauth-protected-resource',
    wellKnownOauthProtectedResourceHandler(oidcDiscovery),
  );

  // T1.1 + ADR D1 + EC-7 absorption — admin sub-app MUST mount BEFORE the
  // generic `/v1/*` bearerAuth middleware. Hono executes middleware along the
  // matched path; if generic bearer fires first on `/v1/admin/*`, it rejects
  // theo_live_* admin keys that don't match THEMEMORY_API_KEY env var.
  // requireScope owns its own Bearer extraction + theo_api_keys SHA-256 lookup,
  // bypassing the env-secret comparison. EC-7 sentinel test 5 protects this.
  if (adminApi !== undefined) {
    const adminBootstrap = adminApi.bootstrapToken;
    app.use(
      '/v1/admin/*',
      requireScope({
        pool: adminApi.pool,
        requiredScope: 'memory:admin',
        ...(adminBootstrap !== undefined ? { bootstrapToken: adminBootstrap } : {}),
      }),
    );
    app.post('/v1/admin/keys', (c) => {
      // viaBootstrapToken detection mirrors the integration test's `buildAdminApp` pattern —
      // when the Bearer equals the bootstrap token, createKeyHandler runs the atomic-tx
      // path (BEGIN → INSERT → markBootstrapConsumedTx → COMMIT) per EC-3 absorption.
      const header = c.req.header('authorization') ?? c.req.header('Authorization') ?? '';
      const token = header.replace(/^Bearer\s+/i, '');
      const viaBootstrap =
        adminBootstrap !== undefined && adminBootstrap.length > 0 && token === adminBootstrap;
      return createKeyHandler(c, adminApi.pool, ADMIN_SUBJECT, { viaBootstrapToken: viaBootstrap });
    });
    app.get('/v1/admin/keys/list', (c) => listKeysHandler(c, adminApi.pool, ADMIN_SUBJECT));
    app.delete('/v1/admin/keys/:id', (c) => revokeKeyHandler(c, adminApi.pool, ADMIN_SUBJECT));
    app.post('/v1/admin/keys/:id/rotate', (c) =>
      rotateKeyHandler(c, adminApi.pool, ADMIN_SUBJECT),
    );
    app.get('/v1/admin/keys/:id/lineage', (c) =>
      lineageKeyHandler(c, adminApi.pool, ADMIN_SUBJECT),
    );
  }

  app.use('/v1/*', bearerAuth(authVerifier));

  app.get('/v1/scopes/:type/:id/memories', (c) => scopesHandler(c, memory));

  app.post('/v1/remember', (c) => rememberHandler(c, memory));
  app.post('/v1/recall', (c) => recallHandler(c, memory));
  app.post('/v1/forget', (c) => forgetHandler(c, memory));
  app.post('/v1/reflect', (c) => reflectHandler(c, memory));

  app.onError((err, c) => {
    // T1.6 — domain-error mapping (EC-10 / EC-23 / EC-24 absorbed inside
    // mapDomainErrorToResponse). Pure-function mapper keeps Hono Context
    // decoupled and reusable for non-HTTP transports.
    const { status, body } = mapDomainErrorToResponse(err);
    return c.json(body, status as Parameters<typeof c.json>[1]);
  });

  return app;
}
