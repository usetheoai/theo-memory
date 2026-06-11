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
export interface AuthVerifier {
  /**
   * Resolve true when the bearer token matches the configured credential.
   *
   * Implementations MUST be constant-time on equal-length inputs (per RFC 6750
   * + OWASP REST API security cheatsheet) and length-mismatch-short-circuit
   * to prevent the {@link RangeError} that `crypto.timingSafeEqual` throws on
   * different-length `Buffer` arguments.
   *
   * @param token — the raw token portion extracted from `Authorization: Bearer
   *   <token>` after scheme parsing (per RFC 6750 § 2.1).
   */
  verify(token: string): Promise<boolean>;
}
