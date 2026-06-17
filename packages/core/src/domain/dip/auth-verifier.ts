/**
 * 12th DIP — AuthVerifier.
 *
 * Single-method DIP per ISP (`architecture.md § 13.4`). Default impl is
 * {@link BearerAuthVerifier} (lives at `src/server/auth/bearer-verifier.ts`
 * under the server module to keep `src/core/` DIP-clean per
 * `architecture.md § 3`). Future OAuth/JWT impls swap behind this interface
 * without surface change.
 *
 * @see Plan theo-memory-standalone-p0 § ADR D3 amended 2026-06-03 — Bearer
 *      auth via `THEMEMORY_API_KEY`; empty/whitespace env value ⇒ fail-closed
 *      (EC-1); RFC 6750 case-insensitive scheme name (EC-2); token compared
 *      verbatim with no trim (EC-3).
 * @see EC-4 — `verify` impls MUST length-check BEFORE `crypto.timingSafeEqual`
 *      to prevent `RangeError` crash in auth path on length-mismatched tokens.
 */
import type { Principal } from '../principal.js';

export interface AuthVerifier {
  /**
   * Resolve true when the bearer token matches the configured credential.
   *
   * Implementations MUST be constant-time on equal-length inputs (per RFC 6750
   * + OWASP REST API security cheatsheet) and length-mismatch-short-circuit
   * to prevent the {@link RangeError} that `crypto.timingSafeEqual` throws on
   * different-length `Buffer` arguments.
   *
   * DEPRECATED (ADR D2 additive-then-breaking): prefer {@link resolvePrincipal},
   * which answers "whose key?" (tenant + scopes) instead of just "valid?".
   * Kept during the migration window so the ~12 existing consumers compile; a
   * default boolean shim is available via `makeVerifyShim` for impls that only
   * provide `resolvePrincipal`.
   *
   * @param token — the raw token portion extracted from `Authorization: Bearer
   *   <token>` after scheme parsing (per RFC 6750 § 2.1).
   */
  verify(token: string): Promise<boolean>;

  /**
   * Resolve the {@link Principal} a credential belongs to, or `null` when the
   * credential is invalid / revoked / expired.
   *
   * This is the multi-tenant headline change (ADR D2): the verifier answers
   * "whose key is this?" — returning the tenant (`workspaceId`) + granted
   * `scopes` — not merely "is this key valid?". The resolved `workspaceId` is
   * what every scoped query filters by (ADR D3 / D4); it MUST come from the
   * credential, never the request body.
   *
   * Implementations MUST keep the revoked/expired predicate so a revoked or
   * expired key resolves to `null` (EC-2), and remain constant-time per the
   * `verify` contract above.
   *
   * @param token — the raw bearer token (RFC 6750 § 2.1).
   *
   * OPTIONAL during the Phase 0→2 migration window (ADR D2): the 3 existing
   * impls keep compiling with only `verify`; Phase 2 adds `resolvePrincipal`
   * to `ApiKeyAuthVerifier` + `BearerAuthVerifier`; Phase 4 promotes it to
   * required and removes `verify` (PUBLIC BREAKING, disclosed).
   */
  resolvePrincipal?(token: string): Promise<Principal | null>;
}
