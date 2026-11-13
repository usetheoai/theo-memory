/**
 * REST composition — cross-cutting middleware stage (M6 T1.1 SRP extraction).
 *
 * Mounts, in this exact order (load-bearing per EC-19/EC-21 + ADR D3):
 * openapi-doc registration → OTel span middleware → 1MB bodyLimit → CORS →
 * rate-limit route configs. Every piece here runs BEFORE any auth-exempt or
 * bearer-gated route (mounted by {@link registerRoutes}). Behavior is
 * byte-for-byte the pre-refactor `createApp` body — this module only relocates
 * it out of the composition root so `app.ts` stays under the file-size budget.
 *
 * @see Plan claude-code-memory-integration-plan § M6 T1.1
 */
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Tracer } from '@opentelemetry/api';
import { ContentTooLargeError } from '@usetheo/memory/contract';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import { mapDomainErrorToResponse } from '../errors.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { otelMiddleware } from '../observability/otel-middleware.js';
import { registerAllPaths } from '../openapi-registration.js';

// EC-19 — /v1/openapi.json MUST resolve auth-exempt even when THEMEMORY_API_KEY
// is configured. Codegen tools (openapi-generator, Postman, Swagger UI) fetch
// the spec BEFORE having credentials; register it first so it resolves ahead of
// the bearer middleware mounted later.
function registerOpenApiDoc(app: OpenAPIHono): void {
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
}

// fixes-cycle-1 T2.1 / F-rev-4 — cap request bodies at 1MB BEFORE bearer is
// consulted (order load-bearing per ADR D3 v1.1: OTel → bodyLimit → bearer).
// The onError builds the structured T1.6 envelope so 413 carries the same
// {code, message} shape as every other 4xx (the `-1` size is the unknown
// sentinel — hono does not surface the actual size at limit hit).
function registerBodyLimit(app: OpenAPIHono): void {
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
}

// red-team-full-system-fixes-cycle-1 T2.2 / ADR D3 — CORS mounted BEFORE bearer
// so OPTIONS preflight succeeds without auth. EC-2: origin='*' does NOT set
// credentials:true (Fetch spec); the production wildcard guard fails fast per
// OWASP A01:2021. EC-5: maxAge=86400 (24h) so browsers cache preflight.
function registerCors(app: OpenAPIHono): void {
  const corsOrigin = process.env['THEMORY_CORS_ORIGIN'] ?? '*';
  if (corsOrigin === '*' && process.env['NODE_ENV'] === 'production') {
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
}

// red-team-full-system-fixes-cycle-1 T2.1 / ADR D2 — write endpoints share one
// limiter (default 30/min), reads another (default 100/min). Health is exempt
// (mounted after this). DELETE is method-scoped so it does not disturb the GET
// read-limiter on the same `/v1/scopes/*` prefix.
function registerRateLimits(app: OpenAPIHono): void {
  app.post('/v1/remember', rateLimitMiddleware('write'));
  app.post('/v1/memory-jobs', rateLimitMiddleware('write'));
  app.post('/v1/memory-jobs/*/retry', rateLimitMiddleware('write'));
  app.get('/v1/memory-jobs/*', rateLimitMiddleware('read'));
  app.post('/v1/forget', rateLimitMiddleware('write'));
  app.post('/v1/reflect', rateLimitMiddleware('write'));
  app.post('/v1/recall', rateLimitMiddleware('read'));
  app.get('/v1/scopes/*', rateLimitMiddleware('read'));
  app.get('/v1/recall-traces/*', rateLimitMiddleware('read'));
  app.delete('/v1/scopes/*', rateLimitMiddleware('write'));
}

/**
 * Mount the cross-cutting middleware stage. OTel spans mount BEFORE everything
 * else so they capture all requests (including 401s + 413s); the remaining
 * stages preserve the exact pre-refactor ordering.
 */
export function registerMiddleware(app: OpenAPIHono, tracer?: Tracer): void {
  registerOpenApiDoc(app);
  app.use('/v1/*', otelMiddleware(tracer));
  registerBodyLimit(app);
  registerCors(app);
  registerRateLimits(app);
}
