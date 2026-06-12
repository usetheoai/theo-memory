/**
 * OIDC authentication contracts — domain-level type definitions for the
 * OAuth2/OIDC bridge (Camada 3).
 *
 * These types define the pluggable introspection interface and discovery
 * configuration consumed by the REST server and MCP server auth layers.
 * Moved to domain/dip/ so both `@usetheo/memory-api` and `@usetheo/memory-mcp`
 * can depend on `@usetheo/memory/contract` without cross-package coupling.
 *
 * @see .claude/knowledge-base/adrs/ADR-0013-oidc-bridge.md
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T3.1
 * @see https://datatracker.ietf.org/doc/html/rfc7662
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */

/**
 * Result shape returned by an introspection call (RFC 7662 § 2.2).
 *
 * F-dom-api-3 expansion (fixes-cycle-1 /review): widened from 4 to 12 standard
 * claims per RFC 7662 § 2.2. Including `aud` is load-bearing for audience
 * validation (token-confusion attack mitigation — a token issued for resource
 * A must not be accepted by resource B). Without `aud`, an OIDC token valid
 * for ANY resource at the issuer would auth this server.
 *
 * Adapter impls SHOULD pass through every standard claim present in the
 * introspection response. Consumers MAY enforce audience validation by
 * inspecting the `aud` claim against their canonical resource URL.
 */
export interface IntrospectionResult {
  /** RFC 7662 § 2.2 active flag — token is valid + not revoked + not expired. */
  readonly active: boolean;
  /** Space-separated scopes granted to the token. */
  readonly scope?: string;
  /** Client identifier the token was issued to. */
  readonly client_id?: string;
  /** Human-readable subject (typically email or username). */
  readonly username?: string;
  /** Token type (e.g., "Bearer", "N_A"). */
  readonly token_type?: string;
  /** Expiration time as Unix timestamp (seconds). */
  readonly exp?: number;
  /** Issued-at time as Unix timestamp (seconds). */
  readonly iat?: number;
  /** Not-before time as Unix timestamp (seconds). */
  readonly nbf?: number;
  /** Subject identifier (typically the user's stable ID). */
  readonly sub?: string;
  /**
   * Audience claim(s) — resource(s) the token was intended for.
   * F-dom-api-3 fix: consumers MUST validate `aud` matches their canonical
   * resource URL to prevent token-confusion attacks (RFC 8707 § 1).
   * String form for single-aud; readonly array for multi-aud per RFC 7519 § 4.1.3.
   */
  readonly aud?: string | readonly string[];
  /** Issuer identifier (`iss` claim from RFC 7519 § 4.1.1). */
  readonly iss?: string;
  /** JWT ID (`jti` from RFC 7519 § 4.1.7) — unique token identifier. */
  readonly jti?: string;
}

/**
 * Pluggable introspection function — production wires this to
 * `oauth4webapi.processIntrospectionResponse` against a configured
 * issuer; tests pass a stub. The `signal` MUST be honored to support
 * EC-4 timeout via AbortController.
 */
export type IntrospectFn = (token: string, signal: AbortSignal) => Promise<IntrospectionResult>;

/**
 * OIDC discovery configuration consumed by `createServer({ oidcDiscovery })`.
 * Per RFC 9728 § 2, `resource` + `authorization_servers` + `scopes_supported`
 * are the load-bearing fields for client discovery; the rest are
 * recommended-but-not-required.
 */
export interface OidcDiscoveryConfig {
  /**
   * OIDC issuer URL (the `iss` claim recipient identifies). MUST be HTTPS
   * in production per RFC 8414 § 2.
   */
  readonly issuer: string;
  /**
   * Canonical URL of this protected resource (the MCP/REST server itself).
   * Becomes the `resource` field in the metadata response. RFC 9728 § 2.1.
   */
  readonly resource: string;
  /**
   * Human-friendly resource label shown in client UIs (e.g., "TheMemory MCP").
   * RFC 9728 § 2.4 (recommended).
   */
  readonly resourceName?: string;
  /**
   * Scopes the OIDC issuer may grant for this resource (e.g.,
   * `memory:read`, `memory:write`). RFC 9728 § 2.5 — informational.
   */
  readonly scopesSupported?: readonly string[];
}
