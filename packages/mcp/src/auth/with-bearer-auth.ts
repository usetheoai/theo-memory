/**
 * withBearerAuth — wraps a node:http handler with the same dual-validation
 * Bearer gate shipped by `src/server/auth/dual-validation.ts` (T3.1, Hono
 * surface) — REUSING the prefix-routing decision logic verbatim. The MCP
 * streamable-HTTP transport is raw `node:http`, NOT Hono, so we cannot
 * compose the Hono middleware directly; this wrapper is the node:http
 * adapter that preserves the SAME contract.
 *
 * Auth decision tree (identical to dual-validation.ts):
 *
 *   Authorization: Bearer <token>
 *     ├─ if token matches /^theo_live_[A-Za-z0-9_-]{40,}$/  → apiKey verifier
 *     ├─ if theo_live_ prefix but shape mismatch (EC-1)     → log warn + fall through to oidc
 *     └─ else (JWT-like / opaque)                            → oidc verifier
 *
 * On failure, emits 401 + RFC 6750 § 3 well-formed `WWW-Authenticate`
 * header (EC-10) including `resource_metadata` per the MCP spec — points
 * MCP clients at the `/.well-known/oauth-protected-resource` endpoint
 * (T4.2) for issuer auto-discovery.
 *
 * @see src/server/auth/dual-validation.ts — the Hono twin (REST surface)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AuthVerifier, Principal } from '@usetheo/memory/contract';

import { attachWorkspace } from './request-workspace.js';

/** EC-1 — shape regex: prefix + at least 40 base64url chars (theo_live_* canonical 43). */
const THEO_LIVE_SHAPE = /^theo_live_[A-Za-z0-9_-]{40,}$/;
const THEO_LIVE_PREFIX = 'theo_live_';

/** RFC 9728 default well-known path. Operators MAY override per-deployment. */
const DEFAULT_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
/** Default realm advertised in `WWW-Authenticate`. */
const DEFAULT_REALM = 'theo-mcp';

export interface BearerAuthOptions {
  /** Verifier for theo_live_* keys (typically ApiKeyAuthVerifier). */
  readonly apiKey?: AuthVerifier;
  /** Verifier for non-theo_live_ Bearers (typically OidcAuthVerifier). */
  readonly oidc?: AuthVerifier;
  /** Realm advertised in `WWW-Authenticate` (default "theo-mcp"). */
  readonly realm?: string;
  /** Path advertised as `resource_metadata` per RFC 9728. Default `/.well-known/oauth-protected-resource`. */
  readonly resourceMetadataPath?: string;
  /** Injection seam for tests; defaults to console.warn. */
  readonly logWarn?: (msg: string, details: Record<string, unknown>) => void;
}

function extractBearer(headerValue: string | string[] | undefined): string | null {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}

type ErrorKind = 'missing_token' | 'invalid_token';

function buildWwwAuthenticate(
  realm: string,
  resourceMetadataPath: string,
  error: ErrorKind,
  description: string,
): string {
  // RFC 6750 § 3 — Bearer scheme + auth-param list. MCP spec adds
  // `resource_metadata` as the RFC 9728 discovery hint for clients.
  return (
    `Bearer realm="${realm}", ` +
    `error="${error}", ` +
    `error_description="${description}", ` +
    `resource_metadata="${resourceMetadataPath}"`
  );
}

function send401(
  res: ServerResponse,
  realm: string,
  resourceMetadataPath: string,
  error: ErrorKind,
  description: string,
): void {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('WWW-Authenticate', buildWwwAuthenticate(realm, resourceMetadataPath, error, description));
  res.end(
    JSON.stringify({
      code: error === 'missing_token' ? 'AUTH_REQUIRED' : 'INVALID_TOKEN',
      message: description,
    }),
  );
}

/**
 * Auth-backend failure (e.g. the `resolvePrincipal` DB lookup threw). Fail
 * closed with a typed 503 — NEVER fall through to an unbound/default Memory
 * (plan `mcp-workspace-binding-isolation` § Failure scenarios; mirrors REST
 * `middleware.ts` 503). No `WWW-Authenticate` (the credential is not the problem).
 */
function send503(res: ServerResponse, description: string): void {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: description }));
}

/**
 * Wrap a node:http request handler so that requests carrying a valid Bearer
 * token (per the prefix-routing rules above) pass through to `delegate`;
 * everything else short-circuits at 401 with a well-formed `WWW-Authenticate`
 * challenge. Idempotent + side-effect free on the request object.
 */
export function withBearerAuth(
  delegate: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  opts: BearerAuthOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const realm = opts.realm ?? DEFAULT_REALM;
  const resourceMetadataPath = opts.resourceMetadataPath ?? DEFAULT_RESOURCE_METADATA_PATH;
  const logWarn =
    opts.logWarn ??
    ((msg, details): void => {
      // eslint-disable-next-line no-console
      console.warn(msg, details);
    });

  return async (req, res) => {
    // B2 absorption (themory-issue-3.md): CORS preflight is unauthenticated
    // by design — gating OPTIONS with Bearer breaks browser-mode clients
    // (Cursor browser, MCP Inspector, future dashboards). Respond 204 with
    // permissive Access-Control-Allow-* headers BEFORE the auth check. CLI
    // clients (Claude Code, Cline) don't issue OPTIONS so this is purely
    // additive — no regression risk on the existing 401 path.
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      // nosemgrep: javascript.express.security.cors-misconfiguration.cors-misconfiguration -- reviewed: unauthenticated preflight; Bearer-token auth (no cookies / no Access-Control-Allow-Credentials), so a reflected Origin cannot enable credentialed cross-origin theft (B2 / themory-issue-3).
      res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] ?? 'Authorization, Content-Type, Accept, Mcp-Session-Id',
      );
      res.setHeader('Access-Control-Max-Age', '600');
      res.end();
      return;
    }

    const token = extractBearer(req.headers['authorization']);
    if (!token) {
      send401(res, realm, resourceMetadataPath, 'missing_token', 'Authorization header is required.');
      return;
    }

    // Path A — theo_live_* prefix routing
    if (token.startsWith(THEO_LIVE_PREFIX)) {
      if (THEO_LIVE_SHAPE.test(token)) {
        if (opts.apiKey) {
          // Multi-tenant path (plan mcp-workspace-binding-isolation, ADR D2/D3):
          // prefer resolvePrincipal so we learn "whose key?" (the tenant) and bind
          // its workspace. Mirrors REST `resolvePrincipalFrom` (middleware.ts:105).
          if (opts.apiKey.resolvePrincipal !== undefined) {
            let principal: Principal | null;
            try {
              principal = await opts.apiKey.resolvePrincipal(token);
            } catch (err) {
              // Auth backend down → fail closed (503), NEVER unbound (#82). Log the
              // cause for diagnosis (error-handling.md — never swallow); the client
              // gets a generic message (CWE-209), the operator gets the detail.
              logWarn('resolve_principal_failed', {
                reason: err instanceof Error ? err.message : String(err),
              });
              send503(res, 'Authentication backend unavailable.');
              return;
            }
            if (principal === null) {
              send401(res, realm, resourceMetadataPath, 'invalid_token', 'API key not recognized.');
              return;
            }
            // EC-1 (load-bearing): a resolved Principal with a blank workspace is
            // malformed — reject. NEVER let it reach workspaceScopedMemory's
            // single-tenant passthrough, which would serve UNBOUND/all-workspace
            // data = #82 re-opened through a different door.
            // `?? ''` defends against a verifier that escapes the type system and
            // returns a malformed Principal (workspaceId undefined): treat as blank →
            // 401 (EC-1), never a 500 from `.trim()` on undefined (F-sec-4).
            if ((principal.workspaceId ?? '').trim() === '') {
              send401(res, realm, resourceMetadataPath, 'invalid_token', 'Resolved principal has no workspace.');
              return;
            }
            attachWorkspace(req, principal.workspaceId);
            await delegate(req, res);
            return;
          }
          // EC-2 (fail-closed, plan ADR D3a): the api-keys (multi-tenant) path REQUIRES
          // a resolvePrincipal-capable verifier so the tenant workspace is resolved +
          // bound. A verify-only verifier cannot isolate tenants → REJECT; never serve
          // the default/all-workspace memory (that is the #82 leak class). The shipped
          // ApiKeyAuthVerifier always provides resolvePrincipal, so this only rejects a
          // misconfigured custom verify-only verifier on the api-keys path.
          send401(
            res, realm, resourceMetadataPath, 'invalid_token',
            'Verifier cannot resolve a workspace (fail-closed).',
          );
          return;
        }
        send401(res, realm, resourceMetadataPath, 'invalid_token', 'API key not recognized.');
        return;
      }
      // EC-1: prefix-collision shape mismatch — log + fall through to OIDC.
      logWarn('prefix_collision_detected', {
        tokenPrefix: token.slice(0, 10),
        reason: 'theo_live_ prefix but shape regex mismatch; falling through to OIDC verifier',
      });
      // fall-through to Path B
    }

    // Path B — OIDC introspection
    if (opts.oidc && (await opts.oidc.verify(token))) {
      await delegate(req, res);
      return;
    }
    send401(res, realm, resourceMetadataPath, 'invalid_token', 'Token not recognized.');
  };
}
