/**
 * `resolveOidcConfig` + `resolveBootstrapToken` — CLI flag/env normalization
 * + cross-field validation for the OIDC + admin-bootstrap surfaces of
 * `themory server` AND `themory mcp`.
 *
 * Plan: `theo-memory-faang-auth-lifecycle-fixes-cycle-1` § T3.2 + ADR D4.
 *
 * Single source of truth so both runners apply identical policy:
 *
 *   - **EC-2 (security-critical)** — env vars holding secrets/tokens are
 *     trimmed; empty/whitespace values normalize to `undefined` (NEVER
 *     pass through as empty string). Prevents
 *     `export THEMORY_ADMIN_BOOTSTRAP_TOKEN=""` from creating a Bearer-
 *     equals-empty bypass via `constantTimeEqual('', '')`.
 *   - **EC-5** — `--issuer` URL validated via `new URL()`; throws an
 *     InvalidArgumentError-shape Error with a friendly message naming the
 *     flag (commander's `.argParser` re-throws as commander's own
 *     `InvalidArgumentError` at the call site).
 *   - **EC-6** — when `clientId` supplied (via CLI flag OR env), the
 *     `THEMORY_OIDC_CLIENT_SECRET` env var MUST be present + non-empty
 *     post-trim. Fail-loud at boot rather than letting oauth4webapi fall
 *     back to anonymous ClientAuth and return cryptic `invalid_client`.
 *   - **EC-9** — when host is `0.0.0.0`, `oidcDiscovery.resource` derives
 *     to `http://localhost:<port>` (NOT `http://0.0.0.0:<port>`, which is
 *     not a valid resource URL per RFC 8707/9728).
 *   - **ADR D4** — `client_secret` is env-only, NEVER a CLI flag (`ps`
 *     leak risk). The resolver accepts `clientId` from input but reads
 *     `clientSecret` exclusively from `process.env`.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-fixes-cycle-1-plan.md § T3.2
 */
import type { OidcDiscoveryConfig } from '@usetheo/memory/contract';

/** Localhost hosts substituted with `localhost` for the EC-9 resource URL derivation. */
const LOCALHOST_DERIVATION_HOSTS = new Set(['0.0.0.0', '::', '*']);
/** Canonical scope vocabulary surfaced via `oidcDiscovery.scopes_supported`. */
const CANONICAL_SCOPES: readonly string[] = [
  'memory:read',
  'memory:write',
  'memory:delete',
  'memory:admin',
];
/** Resource name advertised in `oidcDiscovery.resource_name`. */
const DEFAULT_RESOURCE_NAME = '@usetheo/memory/server';

export interface ResolveOidcConfigInput {
  /** CLI `--issuer` flag value (takes precedence over `THEMORY_OIDC_ISSUER` env). */
  readonly issuer?: string;
  /** CLI `--client-id` flag value (takes precedence over `THEMORY_OIDC_CLIENT_ID` env). */
  readonly clientId?: string;
  /** Server bind host (used to derive the canonical resource URL). */
  readonly host: string;
  /** Server bind port (used to derive the canonical resource URL). */
  readonly port: number;
}

export interface ResolvedOidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly oidcDiscovery: OidcDiscoveryConfig;
}

/**
 * EC-2 normalize-on-read for the bootstrap token env. Returns `undefined` for
 * any falsy/whitespace-only value so downstream `requireScope` cannot grant
 * bypass via empty-Bearer comparison. Defense-in-depth complements the
 * scope-verifier's own `.trim().length > 0` check.
 */
export function resolveBootstrapToken(): string | undefined {
  const raw = process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN'];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // F-dom-cli-8 fix — return the TRIMMED value, not the raw. Pre-fix returned
  // un-trimmed `raw` post-non-empty check, creating a determinism divergence:
  // env="  abc  " would pass the length check but the bearer comparison used
  // "  abc  " vs operator-typed "abc" → silent no-match. Trim once at source.
  return trimmed.length === 0 ? undefined : trimmed;
}

export function resolveOidcConfig(input: ResolveOidcConfigInput): ResolvedOidcConfig | null {
  const issuer = input.issuer ?? process.env['THEMORY_OIDC_ISSUER'];
  if (issuer === undefined || issuer.trim().length === 0) {
    return null; // OIDC disabled — no issuer configured
  }

  // EC-5 — validate URL shape at the resolver boundary
  try {
    new URL(issuer);
  } catch {
    throw new Error(`--issuer must be a valid URL (got "${issuer}")`);
  }

  const clientId = input.clientId ?? process.env['THEMORY_OIDC_CLIENT_ID'];
  if (clientId === undefined || clientId.trim().length === 0) {
    // Issuer set but no clientId — operator must supply both for client_secret_basic
    throw new Error(
      `--issuer requires --client-id (or THEMORY_OIDC_CLIENT_ID env) to authenticate against the introspection endpoint`,
    );
  }

  // EC-6 — clientSecret env-only per ADR D4; empty/whitespace treated as missing per EC-2
  const clientSecretRaw = process.env['THEMORY_OIDC_CLIENT_SECRET'];
  const clientSecret = clientSecretRaw?.trim() ?? '';
  if (clientSecret.length === 0) {
    throw new Error(
      `--client-id requires THEMORY_OIDC_CLIENT_SECRET env var to be set (per ADR D4 env-only secret sourcing — flag would leak via ps aux)`,
    );
  }

  // EC-9 — substitute bind-host 0.0.0.0 / :: with canonical localhost for the resource URL
  const resourceHost = LOCALHOST_DERIVATION_HOSTS.has(input.host) ? 'localhost' : input.host;

  return {
    issuer,
    clientId,
    clientSecret,
    oidcDiscovery: {
      issuer,
      resource: `http://${resourceHost}:${String(input.port)}`,
      resourceName: DEFAULT_RESOURCE_NAME,
      scopesSupported: CANONICAL_SCOPES,
    },
  };
}
