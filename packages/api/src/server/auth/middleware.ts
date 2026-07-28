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
import type { AuthVerifier, Principal, WorkspaceRole } from '@usetheo/memory/contract';
import { DEFAULT_OWNER_USER_ID, DEFAULT_WORKSPACE_ID, roleSatisfies } from '@usetheo/memory/contract';
import type { Context, MiddlewareHandler } from 'hono';


import { BearerAuthVerifier, readApiKey } from './bearer-verifier.js';
import { scopeSatisfies } from './scope-hierarchy.js';

const BEARER_SCHEME_RE = /^bearer\s+(.+)$/i;

/**
 * multi-tenant-workspace-isolation T2.1 + RBAC T1.1: the `default`-workspace
 * Principal used when no credential is configured (ADR D7 — single-tenant dev /
 * no-key deployments collapse to one workspace, which has no cross-tenant IDOR).
 * Acts as the seeded `default-owner` member with the `owner` role so management
 * routes keep working in single-tenant mode.
 */
const DEFAULT_PRINCIPAL: Principal = {
  workspaceId: DEFAULT_WORKSPACE_ID,
  userId: DEFAULT_OWNER_USER_ID,
  role: 'owner',
  scopes: ['memory:read', 'memory:write', 'memory:delete'],
};

/**
 * Read the Principal injected by {@link bearerAuth}. Falls back to the
 * `default`-workspace owner when no Principal is present (auth middleware not
 * mounted, e.g. a unit test hitting a handler directly).
 */
export function getPrincipal(c: Context): Principal {
  return (c.get('principal') as Principal | undefined) ?? DEFAULT_PRINCIPAL;
}

/**
 * RBAC T2.1: gate a route on a minimum workspace role. Mounted AFTER
 * {@link bearerAuth} so 401 (bad credential) always precedes 403 (insufficient
 * role). A member hitting a management route gets 403 `INSUFFICIENT_ROLE`.
 *
 */
export function requireRole(min: WorkspaceRole): MiddlewareHandler {
  return async (c, next) => {
    const { role } = getPrincipal(c);
    if (!roleSatisfies(role, min)) {
      return c.json(
        { code: 'INSUFFICIENT_ROLE', message: `Required role "${min}" not held by this credential.`, required: min, actual: role },
        403,
      );
    }
    await next();
    return;
  };
}

/**
 * Gate a data route on a required scope, checked against the Principal already
 * resolved by {@link bearerAuth}. Mounted AFTER `bearerAuth` so 401 (bad
 * credential) always precedes 403 (insufficient scope). Mirrors
 * {@link requireRole} but for the scope axis: the data verbs require
 * `memory:write` / `memory:read` / `memory:delete` per the verb, honoring the
 * implication hierarchy ({@link scopeSatisfies}). Because `memory:platform-admin`
 * implies ONLY `memory:admin` (key lifecycle), the gateway's provisioning
 * credential is 403 on every data verb — least privilege (NIST AC-6): the
 * platform key mints per-tenant keys, it never reads or writes tenant data.
 *
 * @see usetheoai/theo-memory#77
 */
export function requireScopeOnPrincipal(required: string): MiddlewareHandler {
  return async (c, next) => {
    const { scopes } = getPrincipal(c);
    if (!scopeSatisfies(scopes, required)) {
      return c.json(
        {
          code: 'INSUFFICIENT_SCOPE',
          message: `Required scope "${required}" not held by this credential.`,
          required,
          actual: scopes,
        },
        403,
      );
    }
    await next();
    return;
  };
}

/**
 * Resolve a Principal from a verifier. Prefers {@link AuthVerifier.resolvePrincipal}
 * (the credential→workspace path, ADR D2); falls back to the boolean
 * {@link AuthVerifier.verify} + `default` workspace for impls that only provide
 * the legacy method during the migration window.
 */
async function resolvePrincipalFrom(
  verifier: AuthVerifier,
  token: string,
  requireCredential: boolean,
): Promise<Principal | null> {
  if (verifier.resolvePrincipal !== undefined) {
    return verifier.resolvePrincipal(token);
  }
  // Model B (ADR D4): in fail-closed multi-tenant mode a verify-only verifier
  // (no workspace resolution) MUST NOT collapse to the privileged DEFAULT_PRINCIPAL
  // — that would put every credential in the `default` owner workspace. Reject.
  if (requireCredential) return null;
  return (await verifier.verify(token)) ? DEFAULT_PRINCIPAL : null;
}

/**
 * Model B (ADR D4, EC-4): parse `THEMEMORY_REQUIRE_CREDENTIAL`. Only the literal
 * `"true"` (case-insensitive) or `"1"` enable fail-closed mode; everything else
 * (including empty / whitespace / unset) leaves the legacy single-tenant default.
 */
export function parseRequireCredentialEnv(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1';
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
export function bearerAuth(
  verifier?: AuthVerifier,
  opts: { readonly requireCredential?: boolean } = {},
): MiddlewareHandler {
  // T4.2 — hoist verifier construction to middleware creation time (not per-request).
  const apiKey = readApiKey();
  const hoistedVerifier = verifier ?? (apiKey !== undefined ? new BearerAuthVerifier(apiKey) : null);
  const requireCredential = opts.requireCredential === true;

  return async (c, next) => {
    if (hoistedVerifier === null) {
      // Model B (ADR D4): fail-closed multi-tenant mode forbids the no-credential
      // DEFAULT_PRINCIPAL collapse — a misconfigured multi-tenant deployment MUST
      // reject rather than silently grant the `default` owner workspace.
      if (requireCredential) {
        return c.json(
          { code: 'CREDENTIAL_REQUIRED', message: 'A credential is required (multi-tenant mode).' },
          401,
          { 'WWW-Authenticate': 'Bearer' },
        );
      }
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
    // RBAC T1.1 / ADR D5 — FAIL CLOSED: the role resolution now hits the DB
    // (LEFT JOIN workspace_users). If the auth backend is down, return an
    // explicit 503; NEVER fall through to a privileged default Principal. The
    // Principal is set ONLY on a successful, non-null resolution.
    let principal: Principal | null;
    try {
      principal = await resolvePrincipalFrom(hoistedVerifier, token, requireCredential);
    } catch {
      return c.json(
        { code: 'SERVICE_UNAVAILABLE', message: 'Authentication backend unavailable' },
        503,
      );
    }
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
