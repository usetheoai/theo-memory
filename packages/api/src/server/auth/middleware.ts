/**
 * Hono bearer middleware factory.
 *
 * Absorbs EC-1 (env reader passthrough/fail-closed), EC-2 (case-insensitive
 * `Bearer` scheme per RFC 6750 § 2.1), EC-3 (token verbatim — no trim),
 * and EC-4 indirectly (via {@link BearerAuthVerifier.verify}).
 *
 * @see Plan theo-memory-standalone-p0 § T1.1 + ADR D3 amended (2026-06-03)
 * @see Plan theo-memory-standalone-p0 § ADR D11 — server consumes via DI;
 *      this middleware accepts an optional `AuthVerifier` override for
 *      future OAuth/JWT swap without surface change.
 */
import type { MiddlewareHandler } from 'hono';

import type { AuthVerifier } from '@usetheo/memory/contract';

import { BearerAuthVerifier, readApiKey } from './bearer-verifier.js';

const BEARER_SCHEME_RE = /^bearer\s+(.+)$/i;

/**
 * Build the bearer-auth middleware. When `THEMEMORY_API_KEY` is `undefined`
 * the middleware passes through (auth disabled — alpha mode). When the env
 * value is empty/whitespace-only OR a real token, the middleware enforces
 * bearer auth with `WWW-Authenticate: Bearer` on 401.
 *
 * @param verifier — optional override for testing or future OAuth/JWT impls.
 *   When omitted, a {@link BearerAuthVerifier} is constructed from the env.
 */
export function bearerAuth(verifier?: AuthVerifier): MiddlewareHandler {
  // T4.2 — hoist verifier construction to middleware creation time (not per-request).
  const apiKey = readApiKey();
  const hoistedVerifier = verifier ?? (apiKey !== undefined ? new BearerAuthVerifier(apiKey) : null);

  return async (c, next) => {
    if (hoistedVerifier === null) {
      // apiKey was undefined at construction time — auth disabled (alpha mode).
      await next();
      return;
    }

    const authHeader = c.req.header('authorization') ?? c.req.header('Authorization');
    if (authHeader === undefined) {
      return c.json(
        { code: 'UNAUTHORIZED', message: 'Bearer token required' },
        401,
        { 'WWW-Authenticate': 'Bearer' },
      );
    }

    const match = BEARER_SCHEME_RE.exec(authHeader);
    if (match === null) {
      return c.json(
        { code: 'UNAUTHORIZED', message: 'Bearer scheme expected' },
        401,
        { 'WWW-Authenticate': 'Bearer' },
      );
    }
    const token = match[1] ?? '';

    const ok = await hoistedVerifier.verify(token);
    if (!ok) {
      return c.json(
        { code: 'UNAUTHORIZED', message: 'Invalid bearer token' },
        401,
        { 'WWW-Authenticate': 'Bearer' },
      );
    }
    await next();
    return;
  };
}
