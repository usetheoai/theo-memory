/**
 * `createOauth4webapiIntrospect` — production `IntrospectFn` adapter built
 * on top of `oauth4webapi` (panva, OpenID-certified, zero deps).
 *
 * Plan: `theo-memory-faang-auth-lifecycle-fixes-cycle-1` § T2.2 + ADR D2 + D3.
 *
 * Composes:
 *   - `discoveryRequest` + `processDiscoveryResponse` — fetches the issuer's
 *     `.well-known/openid-configuration` ONCE at construction time per ADR D3
 *     (cached as a closure-scoped `AuthorizationServer` const). Re-discovery
 *     requires server restart by design — issuer URLs rotate via deployment
 *     cycles, not hot-reload.
 *   - `introspectionRequest` + `processIntrospectionResponse` — RFC 7662
 *     POST to `introspection_endpoint` per verify() invocation, with
 *     `ClientSecretBasic` ClientAuth.
 *
 * EC-3 absorption: after `processDiscoveryResponse`, validates that the
 * parsed `AuthorizationServer.introspection_endpoint` is set. Some IdPs
 * (Auth0 free tier, some Keycloak realms) omit it; without this guard the
 * first verify() crashes with a cryptic oauth4webapi message. Fail-loud at
 * construction names the issuer + RFC 7662 + suggests the JWKS-based
 * verifier follow-up.
 *
 * EC-8 absorption: the AbortSignal passed to the returned `IntrospectFn`
 * propagates verbatim into `introspectionRequest`'s `signal` option, which
 * oauth4webapi forwards to its underlying fetch. Cancellation observed in
 * ≤ ~50ms regardless of network latency.
 *
 * EC-11 DOCUMENT (K8s restart loop): when discovery throws at construction
 * (issuer unreachable at boot), the CLI crashes → K8s/Docker restarts the
 * container until the issuer is reachable. Intentional fail-fast vs silent
 * partial wiring (Inquebrável Rule 8).
 *
 * @see https://github.com/panva/oauth4webapi
 * @see https://datatracker.ietf.org/doc/html/rfc7662
 */
import {
  allowInsecureRequests,
  ClientSecretBasic,
  customFetch,
  discoveryRequest,
  introspectionRequest,
  processDiscoveryResponse,
  processIntrospectionResponse,
  type Client,
} from 'oauth4webapi';

import type { IntrospectFn, IntrospectionResult } from './oidc-verifier.js';

export interface CreateOauth4webapiIntrospectOptions {
  /**
   * OIDC issuer URL (the `iss` claim issuer). MUST be HTTPS in production
   * per RFC 8414 § 2; the helper rejects malformed URLs at construction.
   */
  readonly issuer: string;
  /** OAuth client_id registered with the issuer for introspection auth. */
  readonly clientId: string;
  /**
   * OAuth client_secret for `ClientSecretBasic` auth per RFC 6749 § 2.3.1.
   * Sourced env-only per ADR D4 (NEVER a CLI flag — `ps` leak risk).
   */
  readonly clientSecret: string;
  /**
   * Injection seam for tests; production wires through native global fetch.
   * Honors oauth4webapi's `customFetch` symbol contract when bypassing the
   * default fetch is needed.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * INTEGRATION-TEST-ONLY: enable when the issuer URL is `http://` (not
   * `https://`) — typically a local stub issuer. Production deployments
   * MUST NEVER set this (oauth4webapi enforces HTTPS-only by RFC 8414 §2).
   * When true, propagates oauth4webapi's `[allowInsecureRequests]` symbol
   * to discovery + introspection requests.
   */
  readonly allowInsecure?: boolean;
}

/**
 * Build a production `IntrospectFn` bound to the given issuer. Async because
 * discovery is performed at construction time per ADR D3.
 */
export async function createOauth4webapiIntrospect(
  opts: CreateOauth4webapiIntrospectOptions,
): Promise<IntrospectFn> {
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(opts.issuer);
  } catch {
    throw new Error(
      `createOauth4webapiIntrospect: --issuer "${opts.issuer}" is not a valid URL`,
    );
  }

  const fetchImpl = opts.fetchImpl;
  // oauth4webapi accepts `customFetch` + `allowInsecureRequests` symbol-keyed
  // options on its request functions. Under exactOptionalPropertyTypes the
  // upstream `?:` types reject `undefined`; we omit keys entirely (no
  // undefined values land at the boundary) and bridge via `unknown` cast
  // since the runtime contract is set by oauth4webapi, not our type
  // (Inquebrável Rule 9 — don't reinvent symbol-keyed types).
  const requestOptionsBase = {
    ...(fetchImpl !== undefined ? { [customFetch]: fetchImpl } : {}),
    ...(opts.allowInsecure === true ? { [allowInsecureRequests]: true } : {}),
  } as unknown as Parameters<typeof discoveryRequest>[1];

  // Discovery: ONCE per construction. Result cached in closure.
  const discoveryResponse = await discoveryRequest(issuerUrl, requestOptionsBase);
  const as = await processDiscoveryResponse(issuerUrl, discoveryResponse);

  // EC-3 absorption — fail-loud at construction when IdP doesn't advertise
  // introspection_endpoint. Auth0 free tier + some Keycloak realms omit it.
  if (!as.introspection_endpoint) {
    throw new Error(
      `createOauth4webapiIntrospect: OIDC issuer "${opts.issuer}" does not advertise ` +
        `introspection_endpoint in its discovery document; this IdP does not support RFC 7662 ` +
        `introspection. Use a JWKS-based JWT verifier instead (deferred to follow-up cycle) ` +
        `or switch to an issuer that supports introspection (e.g., Hydra, Keycloak with introspection enabled).`,
    );
  }

  const client: Client = { client_id: opts.clientId };
  const clientAuth = ClientSecretBasic(opts.clientSecret);

  return async (token: string, signal: AbortSignal): Promise<IntrospectionResult> => {
    const introOpts = {
      ...requestOptionsBase,
      signal,
    } as unknown as Parameters<typeof introspectionRequest>[4];
    const introResponse = await introspectionRequest(as, client, clientAuth, token, introOpts);
    const result = await processIntrospectionResponse(as, client, introResponse);

    // F-dom-api-3 fix — map ALL standard RFC 7662 § 2.2 claims that oauth4webapi
    // surfaces. `aud` is load-bearing for audience validation per RFC 8707 §1
    // (token-confusion attack mitigation: a token for resource A must not be
    // accepted by resource B). Consumers MAY enforce aud-check against their
    // canonical resource URL; the adapter just passes through what the IdP
    // returned.
    return {
      active: result.active === true,
      ...(result.scope !== undefined ? { scope: result.scope } : {}),
      ...(result.client_id !== undefined ? { client_id: result.client_id } : {}),
      ...(result.username !== undefined ? { username: result.username } : {}),
      ...(result.token_type !== undefined ? { token_type: result.token_type } : {}),
      ...(result.exp !== undefined ? { exp: result.exp } : {}),
      ...(result.iat !== undefined ? { iat: result.iat } : {}),
      ...(result.nbf !== undefined ? { nbf: result.nbf } : {}),
      ...(result.sub !== undefined ? { sub: result.sub } : {}),
      ...(result.aud !== undefined ? { aud: result.aud } : {}),
      ...(result.iss !== undefined ? { iss: result.iss } : {}),
      ...(result.jti !== undefined ? { jti: result.jti } : {}),
    };
  };
}
