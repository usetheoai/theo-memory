/**
 * OidcAuthVerifier — Camada 3 impl of the 12th DIP {@link AuthVerifier}
 * for OAuth2 Bearer tokens issued by an external OIDC provider (Hydra /
 * Keycloak / Auth0 / Okta / Azure AD).
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T3.1 + ADR D1 (ADR-0013).
 *
 * Implementation per RFC 7662 OAuth 2.0 Token Introspection: POSTs the
 * Bearer token to the issuer's `introspection_endpoint`; treats
 * `active: true` as success. EC absorptions:
 *
 * - **EC-4 (timeout):** wraps the introspection HTTP call with an
 *   `AbortController` + configurable timeout (default 5000ms). On timeout
 *   the verify returns `false` — fail-closed per Inquebrável Rule 8.
 *
 * - **EC-5 (cache-miss coalescing):** an in-flight `Map<tokenHash,
 *   Promise<boolean>>` deduplicates concurrent verify() calls for the
 *   same token-hash. The FIRST caller fires the introspection HTTP; the
 *   next N callers await the SAME promise. Prevents thundering-herd
 *   DDoS amplification when many requests arrive for the same token
 *   during a cache miss.
 *
 * Cache TTL (per RFC 7662 § 4 caveat — EC-12 DOCUMENT): default 60s;
 * operator-configurable. Higher TTL = less network load + larger
 * revocation-staleness window. Set `cacheTtlSeconds: 0` for high-
 * sensitivity deployments that want every request introspected.
 *
 * Injection seams: `IntrospectFn` is the only hard dependency (not the
 * `oauth4webapi` package directly) — production wiring will adapt
 * `oauth4webapi.processIntrospectionResponse` to this shape, but the
 * verifier itself stays test-friendly + lib-swappable per Inquebrável
 * Rule 9 (Não Reinvente) without lock-in.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T3.1
 * @see .claude/knowledge-base/discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md § Q4 (Path A: dual-validation middleware)
 * @see https://datatracker.ietf.org/doc/html/rfc7662
 */
import { createHash } from 'node:crypto';

import type { AuthVerifier } from '@usetheo/memory/contract';

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

export interface OidcAuthVerifierOptions {
  readonly introspect: IntrospectFn;
  /** Default 60s. Set to 0 to disable caching (every request introspects). */
  readonly cacheTtlSeconds?: number;
  /** Default 5000ms (EC-4 absorption). */
  readonly introspectionTimeoutMs?: number;
}

const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 5_000;
/** T3.2 — cap to prevent unbounded cache growth under diverse-token traffic. */
const MAX_CACHE_ENTRIES = 10_000;

interface CacheEntry {
  readonly active: boolean;
  readonly expiresAtMs: number;
}

export class OidcAuthVerifier implements AuthVerifier {
  readonly #introspect: IntrospectFn;
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<boolean>>();

  constructor(opts: OidcAuthVerifierOptions) {
    this.#introspect = opts.introspect;
    this.#ttlMs = (opts.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
    this.#timeoutMs = opts.introspectionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async verify(token: string): Promise<boolean> {
    if (!token) return false;

    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Cache hit — short-circuit (TTL=0 means cache disabled; entries never written)
    const cached = this.#cache.get(tokenHash);
    if (cached !== undefined) {
      if (cached.expiresAtMs > Date.now()) return cached.active;
      // T3.2 — delete expired entry on read (was checked but never deleted)
      this.#cache.delete(tokenHash);
    }

    // EC-5 coalescing — if another verify() is already introspecting the
    // same token, reuse its in-flight Promise.
    const existing = this.#inFlight.get(tokenHash);
    if (existing !== undefined) return existing;

    const promise = this.#performIntrospection(token, tokenHash);
    this.#inFlight.set(tokenHash, promise);
    return promise;
  }

  async #performIntrospection(token: string, tokenHash: string): Promise<boolean> {
    // EC-4 — hard timeout via AbortController
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.#timeoutMs);

    try {
      const result = await this.#introspect(token, ac.signal);
      const active = result.active === true;
      if (this.#ttlMs > 0) {
        // T3.2 — evict oldest 10% when cache exceeds cap
        if (this.#cache.size >= MAX_CACHE_ENTRIES) {
          const evictCount = Math.ceil(MAX_CACHE_ENTRIES * 0.1);
          let evicted = 0;
          for (const k of this.#cache.keys()) {
            if (evicted >= evictCount) break;
            this.#cache.delete(k);
            evicted++;
          }
        }
        this.#cache.set(tokenHash, { active, expiresAtMs: Date.now() + this.#ttlMs });
      }
      return active;
    } catch {
      // Timeout, network failure, OR introspection rejection — fail-closed
      return false;
    } finally {
      clearTimeout(timer);
      this.#inFlight.delete(tokenHash);
    }
  }
}
