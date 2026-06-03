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

import type { AuthVerifier } from '../core/dip/auth-verifier.js';
import type { Memory } from '../core/memory-store.js';

import { bearerAuth } from './auth/middleware.js';
import { mapDomainErrorToResponse } from './errors.js';
import { forgetHandler } from './handlers/forget.js';
import { healthDbHandler, healthHandler } from './handlers/health.js';
import { recallHandler } from './handlers/recall.js';
import { reflectHandler } from './handlers/reflect.js';
import { rememberHandler } from './handlers/remember.js';
import { scopesHandler } from './handlers/scopes.js';
import { otelMiddleware } from './observability/otel-middleware.js';
import { registerAllPaths } from './openapi-registration.js';

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
}

export function createApp(options: CreateServerOptions): OpenAPIHono {
  const { memory, authVerifier, dbProbe, tracer, readinessProbe } = options;
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

  // OTel span middleware mounts BEFORE bearer so spans capture all requests
  // (including 401s). Scope `/v1/*` so /v1/openapi.json itself also gets a
  // span without polluting unrelated routes (none today; safe-guards future
  // additions). Per T1.5 + EC-21 + EC-22.
  app.use('/v1/*', otelMiddleware(tracer));
  app.use('/v1/*', bearerAuth(authVerifier));

  app.get('/v1/health', (c) => healthHandler(c, readinessProbe));
  app.get('/v1/health/db', (c) => healthDbHandler(c, dbProbe));
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
