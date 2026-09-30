/**
 * The MCP streamable-HTTP transport as an OAuth 2.1 resource server.
 *
 * Contract: usetheoai/theo#477 and the MCP authorization specification — every token is
 * issued by the platform's authorization server (Ory Hydra), signed RS256, and bound to
 * THIS resource by its audience. The gateway in front validates the same token; this
 * server validates it again and never trusts the gateway alone.
 *
 * What replaced what. The transport used to accept `theo_live_*` API keys (a database
 * lookup) and opaque tokens (RFC 7662 introspection). Both are gone from this surface, by
 * decision and with no compatibility path: a key is not audience-bound, so a key minted
 * for one service was valid at every other.
 *
 * Tenancy comes from the validated token and nowhere else: `tenant_id` becomes the
 * request's workspace, `sub` its user. No header a client can set reaches either.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createRemoteJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';

import { attachUser, attachWorkspace } from './request-workspace.js';

/** RFC 9728 well-known prefix for protected resource metadata. */
const METADATA_PREFIX = '/.well-known/oauth-protected-resource';

/** The only signature algorithm accepted. Anything else — `none`, HS*, ES* — is refused. */
const ALLOWED_ALGORITHMS = ['RS256'] as const;

/** `typ` values an access token may carry (RFC 9068 `at+jwt`, or the generic `JWT`). */
const ALLOWED_TYP = new Set(['jwt', 'at+jwt', 'application/at+jwt']);

/** Clock skew tolerated on `exp` / `nbf`, in seconds. */
const CLOCK_TOLERANCE_SECONDS = 60;

/** Raised when the resource-server configuration cannot be used. The server must not start. */
export class ResourceServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceServerConfigError';
  }
}

export interface ResourceServerConfig {
  /** Canonical URI of this MCP server (`THEO_MCP_RESOURCE`) — the audience tokens must carry. */
  readonly resource: string;
  /** Issuer tokens must name exactly (`THEO_OAUTH_ISSUER`). */
  readonly issuer: string;
  /** Where the issuer's signing keys are published. */
  readonly jwksUri: string;
  /** Advertised in the metadata document; empty when not configured. */
  readonly scopesSupported: readonly string[];
  /** Scopes every token must carry; empty means none are required. */
  readonly requiredScopes: readonly string[];
  /** Absolute URL of this resource's metadata document, advertised in every challenge. */
  readonly resourceMetadataUrl: string;
  /** Paths the metadata document is served on: the root form and the path-suffixed form. */
  readonly metadataPaths: readonly string[];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === '') {
    throw new ResourceServerConfigError(
      `${name} is required for the MCP OAuth resource server and is not set; refusing to start.`,
    );
  }
  return value;
}

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new ResourceServerConfigError(`${name}="${value}" is not an absolute URL.`);
  }
}

function list(value: string | undefined): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Reads the resource-server configuration from the environment and validates it.
 *
 * Throws `ResourceServerConfigError` naming the variable at fault. Called before the
 * database pool or the listener exist, so a misconfiguration costs nothing to discover.
 */
export function loadResourceServerConfig(env: NodeJS.ProcessEnv = process.env): ResourceServerConfig {
  const resource = required(env, 'THEO_MCP_RESOURCE');
  const resourceUrl = parseUrl('THEO_MCP_RESOURCE', resource);
  if (resourceUrl.protocol !== 'https:' && resourceUrl.protocol !== 'http:') {
    throw new ResourceServerConfigError(`THEO_MCP_RESOURCE="${resource}" must be an http(s) URL.`);
  }
  if (resource.endsWith('/')) {
    throw new ResourceServerConfigError(
      `THEO_MCP_RESOURCE="${resource}" has a trailing slash; the canonical resource URI has none, ` +
        'and an audience compared exactly would never match the token.',
    );
  }
  if (resourceUrl.search !== '' || resourceUrl.hash !== '' || resource.includes('#') || resource.includes('?')) {
    throw new ResourceServerConfigError(
      `THEO_MCP_RESOURCE="${resource}" carries a query or fragment; the resource URI must not (RFC 8707).`,
    );
  }

  const issuer = required(env, 'THEO_OAUTH_ISSUER');
  parseUrl('THEO_OAUTH_ISSUER', issuer);

  const explicitJwks = env['THEO_OAUTH_JWKS_URI']?.trim();
  const jwksUri =
    explicitJwks !== undefined && explicitJwks !== ''
      ? explicitJwks
      : `${issuer.endsWith('/') ? issuer : `${issuer}/`}.well-known/jwks.json`;
  parseUrl('THEO_OAUTH_JWKS_URI', jwksUri);

  const resourcePath = resourceUrl.pathname === '/' ? '' : resourceUrl.pathname;
  const suffixed = `${METADATA_PREFIX}${resourcePath}`;

  return {
    resource,
    issuer,
    jwksUri,
    scopesSupported: list(env['THEO_MCP_SCOPES_SUPPORTED']),
    requiredScopes: list(env['THEO_MCP_REQUIRED_SCOPES']),
    resourceMetadataUrl: `${resourceUrl.origin}${suffixed}`,
    metadataPaths: resourcePath === '' ? [METADATA_PREFIX] : [METADATA_PREFIX, suffixed],
  };
}

/** The RFC 9728 protected resource metadata document. */
export function protectedResourceMetadata(config: ResourceServerConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    ...(config.scopesSupported.length > 0 ? { scopes_supported: [...config.scopesSupported] } : {}),
  };
}

/** Who a validated token speaks for. */
export interface TokenPrincipal {
  /** Top-level `tenant_id` claim — the request's workspace. */
  readonly tenantId: string;
  /** `sub` — the request's user. */
  readonly subject: string;
  /** `account_id`, when the token carries one. */
  readonly accountId?: string;
  /** Granted scopes, from `scope` (space-delimited) or `scp` (array). */
  readonly scopes: readonly string[];
}

/**
 * `invalid` is a fact about the token (401). `unavailable` is a fact about the key source
 * (503): the token may be perfectly good, and telling the client it is not would send it to
 * re-authenticate against a problem it cannot fix. Both fail closed.
 */
export type TokenVerification =
  | { readonly ok: true; readonly principal: TokenPrincipal }
  | { readonly ok: false; readonly kind: 'invalid' | 'unavailable'; readonly reason: string };

export interface AccessTokenVerifier {
  verify(token: string): Promise<TokenVerification>;
}

function invalid(reason: string): TokenVerification {
  return { ok: false, kind: 'invalid', reason };
}

function scopesOf(payload: JWTPayload): readonly string[] {
  const scope = payload['scope'];
  if (typeof scope === 'string') return scope.split(' ').filter((s) => s !== '');
  const scp = payload['scp'];
  if (Array.isArray(scp)) return scp.filter((s): s is string => typeof s === 'string');
  return [];
}

/** True when the failure is the key source, not the token. */
function isKeySourceFailure(err: unknown): boolean {
  if (err instanceof joseErrors.JWKSTimeout || err instanceof joseErrors.JWKSInvalid) return true;
  if (err instanceof joseErrors.JOSEError) {
    // jose reports a non-200 JWKS response as a generic JOSEError.
    return err.code === 'ERR_JOSE_GENERIC' && /JSON Web Key Set/i.test(err.message);
  }
  // A fetch that never connected surfaces as a plain TypeError, outside jose's hierarchy.
  return true;
}

function reasonOf(err: unknown): string {
  if (err instanceof joseErrors.JWTClaimValidationFailed) return `${err.code}: ${err.claim} ${err.reason}`;
  if (err instanceof joseErrors.JOSEError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Builds the verifier for RS256 access tokens issued by `config.issuer` for `config.resource`.
 *
 * Keys come from the JWKS with jose's cache: fetched once, refetched when a token names an
 * unknown `kid` (at most once per cooldown window), never trusted from the token itself.
 * `getKey` is the injection seam for tests that already hold a key set.
 */
export function createJwtAccessTokenVerifier(
  config: Pick<ResourceServerConfig, 'issuer' | 'resource' | 'jwksUri'>,
  opts: { readonly getKey?: JWTVerifyGetKey } = {},
): AccessTokenVerifier {
  const getKey =
    opts.getKey ??
    createRemoteJWKSet(new URL(config.jwksUri), { cooldownDuration: 30_000, timeoutDuration: 5_000 });

  return {
    async verify(token: string): Promise<TokenVerification> {
      let header: ReturnType<typeof decodeProtectedHeader>;
      try {
        header = decodeProtectedHeader(token);
      } catch {
        return invalid('token is not a JWS compact serialization');
      }
      if (header.alg !== 'RS256') return invalid(`alg "${String(header.alg)}" is not allowed`);
      if (typeof header.kid !== 'string' || header.kid === '') return invalid('kid is required');
      if (header.typ !== undefined && !ALLOWED_TYP.has(header.typ.toLowerCase())) {
        return invalid(`typ "${header.typ}" is not an access token type`);
      }

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, getKey, {
          issuer: config.issuer,
          audience: config.resource,
          algorithms: [...ALLOWED_ALGORITHMS],
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          requiredClaims: ['exp', 'sub'],
        }));
      } catch (err) {
        // An unknown kid is a token problem even though it surfaces from the key set.
        if (err instanceof joseErrors.JWKSNoMatchingKey) return invalid(reasonOf(err));
        if (isKeySourceFailure(err)) return { ok: false, kind: 'unavailable', reason: reasonOf(err) };
        return invalid(reasonOf(err));
      }

      const tenantId = payload['tenant_id'];
      if (typeof tenantId !== 'string' || tenantId.trim() === '') {
        return invalid('top-level tenant_id claim is missing or empty');
      }
      const subject = payload.sub;
      if (typeof subject !== 'string' || subject.trim() === '') return invalid('sub claim is empty');
      const accountId = payload['account_id'];
      if (accountId !== undefined && typeof accountId !== 'string') {
        return invalid('account_id claim is not a string');
      }

      return {
        ok: true,
        principal: {
          tenantId: tenantId.trim(),
          subject,
          ...(accountId !== undefined ? { accountId } : {}),
          scopes: scopesOf(payload),
        },
      };
    },
  };
}

function extractBearer(req: IncomingMessage): string | null {
  // The Authorization header and nothing else: a token in the query string or the body
  // is ignored, never accepted (it leaks into logs and caches).
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const match = /^Bearer[ ]+([^\s]+)[ ]*$/i.exec(header);
  return match?.[1] ?? null;
}

function pathOf(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

export interface OAuthResourceServerOptions {
  readonly config: ResourceServerConfig;
  readonly verifier: AccessTokenVerifier;
  /** Injection seam for tests; defaults to console.warn. Never receives the token. */
  readonly logWarn?: (msg: string, details: Record<string, unknown>) => void;
}

/**
 * Wraps a node:http handler so that only requests carrying a valid access token for this
 * resource reach it, with the token's tenant and subject attached to the request.
 *
 * Unauthenticated by design: CORS preflight, and the RFC 9728 metadata document — the
 * document is how a client that just received a 401 learns where to get a token.
 */
export function withOAuthResourceServer(
  delegate: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  opts: OAuthResourceServerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { config, verifier } = opts;
  const logWarn =
    opts.logWarn ??
    ((msg, details): void => {
      // eslint-disable-next-line no-console
      console.warn(msg, details);
    });
  const metadataBody = JSON.stringify(protectedResourceMetadata(config));

  const challenge = (error: 'invalid_token' | 'insufficient_scope', extra = ''): string =>
    `Bearer error="${error}"${extra}, resource_metadata="${config.resourceMetadataUrl}"`;

  const reject = (res: ServerResponse, status: 401 | 403 | 503, body: Record<string, string>, header?: string): void => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    if (header !== undefined) res.setHeader('WWW-Authenticate', header);
    res.end(JSON.stringify(body));
  };

  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      // nosemgrep: javascript.express.security.cors-misconfiguration.cors-misconfiguration -- reviewed: unauthenticated preflight; bearer-header auth (no cookies, no Access-Control-Allow-Credentials), so a reflected Origin grants no credentialed access.
      res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] ?? 'Authorization, Content-Type, Accept, Mcp-Session-Id',
      );
      res.setHeader('Access-Control-Max-Age', '600');
      res.end();
      return;
    }

    const path = pathOf(req);
    if ((req.method === 'GET' || req.method === 'HEAD') && config.metadataPaths.includes(path)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.end(req.method === 'HEAD' ? undefined : metadataBody);
      return;
    }

    const token = extractBearer(req);
    if (token === null) {
      logWarn('mcp_auth_rejected', { reason: 'no bearer token in the Authorization header', method: req.method, path });
      reject(
        res,
        401,
        { code: 'AUTH_REQUIRED', message: 'A bearer access token is required.' },
        challenge('invalid_token', ', error_description="A bearer access token is required"'),
      );
      return;
    }

    const result = await verifier.verify(token);
    if (!result.ok) {
      logWarn('mcp_auth_rejected', { reason: result.reason, kind: result.kind, method: req.method, path });
      if (result.kind === 'unavailable') {
        reject(res, 503, { code: 'SERVICE_UNAVAILABLE', message: 'Token validation is temporarily unavailable.' });
        return;
      }
      reject(
        res,
        401,
        { code: 'INVALID_TOKEN', message: 'The access token is invalid or expired.' },
        challenge('invalid_token', ', error_description="The access token is invalid or expired"'),
      );
      return;
    }

    const missing = config.requiredScopes.filter((s) => !result.principal.scopes.includes(s));
    if (missing.length > 0) {
      logWarn('mcp_auth_forbidden', { reason: 'insufficient scope', missing, method: req.method, path });
      reject(
        res,
        403,
        { code: 'INSUFFICIENT_SCOPE', message: `Scope required: ${config.requiredScopes.join(' ')}` },
        challenge('insufficient_scope', `, scope="${config.requiredScopes.join(' ')}"`),
      );
      return;
    }

    attachWorkspace(req, result.principal.tenantId);
    attachUser(req, result.principal.subject);
    await delegate(req, res);
  };
}
