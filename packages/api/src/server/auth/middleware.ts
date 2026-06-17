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
import type { AuthVerifier, Principal } from '@usetheo/memory/contract';
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import type { MiddlewareHandler } from 'hono';


import { BearerAuthVerifier, readApiKey } from './bearer-verifier.js';

const BEARER_SCHEME_RE = /^bearer\s+(.+)$/i;

/**
 * multi-tenant-workspace-isolation T2.1: the `default`-workspace Principal used
 * when no credential is configured (ADR D7 — single-tenant dev / no-key
 * deployments collapse to one workspace, which has no cross-tenant IDOR).
 */
const DEFAULT_PRINCIPAL: Principal = {
  workspaceId: DEFAULT_WORKSPACE_ID,
  scopes: ['memory:read', 'memory:write', 'memory:delete'],
};

/**
 * Resolve a Principal from a verifier. Prefers {@link AuthVerifier.resolvePrincipal}
 * (the credential→workspace path, ADR D2); falls back to the boolean
 * {@link AuthVerifier.verify} + `default` workspace for impls that only provide
 * the legacy method during the migration window.
 */
async function resolvePrincipalFrom(
  verifier: AuthVerifier,
  token: string,
): Promise<Principal | null> {
  if (verifier.resolvePrincipal !== undefined) {
    return verifier.resolvePrincipal(token);
  }
  return (await verifier.verify(token)) ? DEFAULT_PRINCIPAL : null;
}

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
      // multi-tenant-workspace-isolation T2.1 / ADR D7: no credential configured
      // → collapse to the `default` workspace Principal (NOT the old insecure
      // "auth disabled pass-through"). With one workspace there is no cross-tenant
      // IDOR, so single-tenant dev keeps working while every request is still
      // workspace-bound.
      c.set('principal', DEFAULT_PRINCIPAL);
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

    // multi-tenant-workspace-isolation T2.1: resolve "whose key?" and inject the
    // Principal so handlers scope every query by `principal.workspaceId` (ADR D3).
    const principal = await resolvePrincipalFrom(hoistedVerifier, token);
    if (principal === null) {
      return c.json(
        { code: 'UNAUTHORIZED', message: 'Invalid bearer token' },
        401,
        { 'WWW-Authenticate': 'Bearer' },
      );
    }
    c.set('principal', principal);
    await next();
    return;
  };
}
