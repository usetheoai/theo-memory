/**
 * Scope verifier middleware — gates `/v1/admin/keys/*` (and other
 * scope-sensitive endpoints) to keys carrying a required scope.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.2 + ADR D7.
 *
 * Compatible only with `theo_live_*` keys: hashes the token, joins
 * against `theo_api_keys.scopes` JSONB, and checks the required scope
 * against the row. Bootstrap admin token (D7) bypasses scope check —
 * it IS admin by definition (its purpose is to bootstrap the first
 * admin key when admin_config.bootstrap_consumed is still false; the
 * EC-3 self-revoke logic is T2.2.1's responsibility, gated upstream).
 *
 * Returns:
 *   - 401 AUTH_REQUIRED      — no Authorization header
 *   - 401 INVALID_API_KEY    — token not found / inactive
 *   - 403 SCOPE_INSUFFICIENT — token found but lacks required scope
 *
 * NOT a replacement for the upstream Bearer middleware — this verifier
 * REQUIRES `theo_live_*` shape; OIDC tokens (T3.1) take a different path.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T2.2
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import type { AuthPool } from './api-key-verifier.js';

const PREFIX = 'theo_live_';

const SELECT_SCOPES_BY_HASH_SQL = `\
SELECT scopes FROM theo_api_keys
 WHERE key_hash = $1
   AND revoked_at IS NULL
   AND (expires_at IS NULL OR expires_at > NOW())
   AND tenant_id = 'self'
 LIMIT 1`;

export interface RequireScopeOptions {
  readonly pool: AuthPool;
  readonly requiredScope: string;
  /**
   * Optional bootstrap admin token (env-sourced per ADR D7). When set,
   * a Bearer matching this exact value bypasses scope check (granted as
   * implicit admin). Comparison uses `timingSafeEqual` per RFC 6750 +
   * OWASP REST API security guide (matches the existing
   * BearerAuthVerifier EC-4 length-check-before-compare discipline).
   */
  readonly bootstrapToken?: string;
}

/**
 * Extract Bearer token from an Authorization header — case-insensitive
 * scheme name per RFC 6750 § 2.1. Mirrors the existing middleware in
 * `./middleware.ts` so the two stay aligned.
 */
function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}

/**
 * Constant-time string compare with length pre-check (per EC-4 of
 * `bearer-verifier.ts` — `timingSafeEqual` throws RangeError on
 * different-length buffers).
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return timingSafeEqual(bufA, bufB);
}

export function requireScope(opts: RequireScopeOptions): MiddlewareHandler {
  return async (c, next) => {
    const token = extractBearer(c.req.header('authorization') ?? c.req.header('Authorization'));
    if (!token) {
      // F-dom-api-2 fix — RFC 6750 § 3 requires WWW-Authenticate on 401.
      // Headers passed via c.json's 3rd-arg option-bag (Hono signature).
      return c.json(
        { code: 'AUTH_REQUIRED', message: 'Authorization header is required.' },
        401,
        { 'WWW-Authenticate': 'Bearer' },
      );
    }

    // Bootstrap bypass (D7) — exact-match against the env-sourced token.
    // EC-2 absorption (fixes-cycle-1): post-trim length-check defends against
    // `export THEMORY_ADMIN_BOOTSTRAP_TOKEN="   "` whitespace-only env. The
    // CLI resolver normalizes empty/whitespace to undefined; this is defense-
    // in-depth at the middleware layer (any caller bypassing the CLI resolver
    // still gets the no-bypass guarantee).
    if (opts.bootstrapToken && opts.bootstrapToken.trim().length > 0) {
      if (constantTimeEqual(token, opts.bootstrapToken)) {
        await next();
        return;
      }
    }

    // theo_live_* path: hash + scope lookup.
    if (!token.startsWith(PREFIX) || token.length <= PREFIX.length) {
      return c.json(
        { code: 'INVALID_API_KEY', message: 'API key not recognized.' },
        401,
        { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      );
    }
    const hash = createHash('sha256').update(token).digest('hex');
    const { rows } = await opts.pool.query<{ scopes: unknown }>(
      SELECT_SCOPES_BY_HASH_SQL,
      [hash],
    );
    if (rows.length === 0) {
      return c.json(
        { code: 'INVALID_API_KEY', message: 'API key not recognized.' },
        401,
        { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      );
    }
    let scopes: readonly string[] = [];
    try {
      const rawSrc = rows[0]?.scopes;
      const raw: unknown = typeof rawSrc === 'string' ? JSON.parse(rawSrc) : rawSrc;
      if (Array.isArray(raw)) scopes = raw as string[];
    } catch {
      scopes = [];
    }
    if (!scopes.includes(opts.requiredScope)) {
      return c.json(
        {
          code: 'SCOPE_INSUFFICIENT',
          message: `Required scope "${opts.requiredScope}" not granted by this API key.`,
        },
        403,
      );
    }
    await next();
    return;
  };
}
