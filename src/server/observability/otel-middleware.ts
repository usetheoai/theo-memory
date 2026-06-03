/**
 * OTel span middleware for REST handlers (T1.5).
 *
 * Wraps every `/v1/*` request in a span named `rest.v1.<verb>` per EC-21.
 * Tracer comes from DI via `CreateServerOptions.tracer` — when absent, the
 * `trace.getTracer(...)` no-op resolves so callers without observability
 * still pay zero cost.
 *
 * EC-22 absorption: every interaction with the tracer is wrapped in narrow
 * try/catch swallowing OTel-specific errors. A broken exporter or SDK
 * misconfiguration MUST NOT break the request — observability is fail-quiet.
 *
 * @see Plan theo-memory-standalone-p0 § T1.5 + ADR D11 + EC-21 + EC-22
 */
import type { Tracer } from '@opentelemetry/api';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'hono';

function deriveSpanName(method: string, path: string): string {
  // Matches the 6 routes mounted in app.ts. Order matters: more specific
  // prefixes before generics.
  if (method === 'POST' && path.startsWith('/v1/remember')) return 'rest.v1.remember';
  if (method === 'POST' && path.startsWith('/v1/recall')) return 'rest.v1.recall';
  if (method === 'POST' && path.startsWith('/v1/forget')) return 'rest.v1.forget';
  if (method === 'POST' && path.startsWith('/v1/reflect')) return 'rest.v1.reflect';
  if (method === 'GET' && path.startsWith('/v1/health/db')) return 'rest.v1.health.db';
  if (method === 'GET' && path.startsWith('/v1/health')) return 'rest.v1.health';
  if (method === 'GET' && path.startsWith('/v1/scopes/')) return 'rest.v1.scopes.list';
  return `rest.v1.${method.toLowerCase()}`;
}

export function otelMiddleware(tracer?: Tracer): MiddlewareHandler {
  const resolved = tracer ?? trace.getTracer('@usetheo/memory/server', '0.1.0-alpha');
  return async (c, next) => {
    const spanName = deriveSpanName(c.req.method, c.req.path);
    let span;
    try {
      span = resolved.startSpan(spanName);
    } catch {
      // OTel tracer misbehaved — fail-quiet, proceed without observability.
      await next();
      return;
    }
    try {
      await next();
      const status = c.res.status;
      try {
        span.setAttribute('http.status_code', status);
        span.setAttribute('http.method', c.req.method);
        span.setAttribute('http.route', c.req.path);
        if (status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
      } catch {
        // span.setAttribute / setStatus failed — fail-quiet (EC-22).
      }
    } catch (err) {
      // Handler threw — record the exception, mark span ERROR, re-throw so
      // Hono's onError returns the sanitized 500 envelope per EC-10.
      try {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('http.method', c.req.method);
        span.setAttribute('http.route', c.req.path);
      } catch {
        // EC-22 fail-quiet.
      }
      try {
        span.end();
      } catch {
        // EC-22 fail-quiet.
      }
      throw err;
    }
    try {
      span.end();
    } catch {
      // EC-22 fail-quiet — exporter sync throw absorbed here.
    }
  };
}
