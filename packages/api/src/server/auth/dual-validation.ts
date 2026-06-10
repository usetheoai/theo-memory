/**
 * dualValidationAuth — Camada 3 Hono middleware that routes Bearer
 * tokens based on prefix-shape: `theo_live_*` → ApiKeyAuthVerifier
 * (SHA-256 lookup); else → OidcAuthVerifier (RFC 7662 introspection).
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T3.1 + ADR D1 (ADR-0013).
 *
 * **EC-1 absorption (fallthrough policy):** when a token has the
 * `theo_live_` prefix BUT fails the shape regex
 * (`/^theo_live_[A-Za-z0-9_-]{40,}$/` — prefix + at least 40 base64url
 * chars), the middleware logs `prefix_collision_detected` AND falls
 * through to the OIDC verifier. This handles the rare case where an
 * external OIDC issuer happens to mint tokens starting with the
 * `theo_live_` literal — without fallthrough, legitimate consumers
 * would be silently 401'd.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T3.1
 * @see .claude/knowledge-base/reviews/theo-memory-faang-auth-lifecycle-edge-cases-2026-06-07.md § EC-1
 */
import type { MiddlewareHandler } from 'hono';

import type { AuthVerifier } from '@usetheo/memory/contract';

/** EC-1 — shape regex: prefix + at least 40 base64url chars (theo_live_* canonical 43). */
const THEO_LIVE_SHAPE = /^theo_live_[A-Za-z0-9_-]{40,}$/;
const THEO_LIVE_PREFIX = 'theo_live_';

export interface DualValidationOptions {
  /** Verifier for theo_live_* keys (typically ApiKeyAuthVerifier). */
  readonly apiKey?: AuthVerifier;
  /** Verifier for non-theo_live_ Bearers (typically OidcAuthVerifier). */
  readonly oidc?: AuthVerifier;
  /** Injection seam for tests; defaults to console.warn. */
  readonly logWarn?: (msg: string, details: Record<string, unknown>) => void;
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}

export function dualValidationAuth(opts: DualValidationOptions): MiddlewareHandler {
  const logWarn = opts.logWarn ?? ((msg, details) => {
    // eslint-disable-next-line no-console
    console.warn(msg, details);
  });

  return async (c, next) => {
    const token = extractBearer(c.req.header('authorization') ?? c.req.header('Authorization'));
    if (!token) {
      return c.json({ code: 'AUTH_REQUIRED', message: 'Authorization header is required.' }, 401);
    }

    // Path A — theo_live_* shape: route to ApiKeyAuthVerifier.
    if (token.startsWith(THEO_LIVE_PREFIX)) {
      if (THEO_LIVE_SHAPE.test(token)) {
        if (opts.apiKey && (await opts.apiKey.verify(token))) {
          await next();
          return;
        }
        return c.json({ code: 'INVALID_TOKEN', message: 'API key not recognized.' }, 401);
      }
      // EC-1: prefix collision but shape mismatch — log + fall through to OIDC
      logWarn('prefix_collision_detected', {
        tokenPrefix: token.slice(0, 10),
        reason: 'theo_live_ prefix but shape regex mismatch; falling through to OIDC verifier',
      });
      // Fall through below.
    }

    // Path B — OIDC introspection.
    if (opts.oidc && (await opts.oidc.verify(token))) {
      await next();
      return;
    }
    return c.json({ code: 'INVALID_TOKEN', message: 'Token not recognized.' }, 401);
  };
}
