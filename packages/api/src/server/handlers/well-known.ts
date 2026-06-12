/**
 * `/.well-known/oauth-protected-resource` discovery endpoint per RFC 9728
 * (OAuth 2.0 Protected Resource Metadata) — T4.2 + ADR-0015 § Decision #4.
 *
 * When the server is configured with an OIDC issuer (via `OidcDiscoveryConfig`),
 * exposes the metadata MCP clients use to auto-discover the issuer URL +
 * supported scopes + bearer methods. WITHOUT manual config.
 *
 * Auth-exempt by mounting BEFORE the bearer middleware in app.ts — MCP
 * clients fetch this endpoint BEFORE having a token (same precedent as
 * `/v1/openapi.json` and `/v1/health` per T3.5 absorption).
 *
 * Returns 404 when `oidcDiscovery` is not configured — honest no-OIDC
 * signal vs returning empty metadata (which would confuse clients into
 * trying empty issuer URLs).
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T4.2
 * @see .claude/knowledge-base/adrs/ADR-0015-mcp-streamable-http-auth.md § Decision #4
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */
import type { OidcDiscoveryConfig } from '@usetheo/memory/contract';
import type { Context } from 'hono';

// Re-export for backward compatibility — consumers importing from
// `@usetheo/memory-api` continue to resolve this type.
export type { OidcDiscoveryConfig } from '@usetheo/memory/contract';

/**
 * RFC 9728 response shape. `bearer_methods_supported` is locked to
 * `['header']` per RFC 6750 § 2.1 — we accept Bearer via `Authorization:
 * Bearer <token>` only (no form-encoded body, no URI query param).
 */
interface OauthProtectedResourceMetadata {
  readonly resource: string;
  readonly resource_name?: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported?: readonly string[];
  readonly bearer_methods_supported: readonly ['header'];
}

/**
 * Hono handler factory — returns the well-known endpoint handler bound to
 * the given OIDC discovery config. When `config` is undefined, the
 * factory returns a 404 handler (the route SHOULD still be registered
 * unconditionally so unconfigured probes get an honest 404 vs a routing
 * miss that could indicate a deeper problem).
 */
export function wellKnownOauthProtectedResourceHandler(
  config: OidcDiscoveryConfig | undefined,
): (c: Context) => Response {
  if (config === undefined) {
    return (c: Context): Response =>
      c.json(
        {
          code: 'OIDC_DISCOVERY_NOT_CONFIGURED',
          message:
            'This server was not started with an OIDC issuer. ' +
            'Configure `oidcDiscovery` on createServer or invoke `themory mcp --auth=oidc --issuer=<url>` to enable RFC 9728 discovery.',
        },
        404,
      );
  }

  const metadata: OauthProtectedResourceMetadata = {
    resource: config.resource,
    ...(config.resourceName !== undefined ? { resource_name: config.resourceName } : {}),
    authorization_servers: [config.issuer],
    ...(config.scopesSupported !== undefined
      ? { scopes_supported: config.scopesSupported }
      : {}),
    bearer_methods_supported: ['header'],
  };

  return (c: Context): Response => c.json(metadata, 200);
}
