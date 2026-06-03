/**
 * BearerAuthVerifier — default impl of the 12th DIP {@link AuthVerifier}.
 *
 * Absorbs:
 * - EC-1 — empty/whitespace `THEMEMORY_API_KEY` env value ⇒ fail-closed
 *   (auth required, no token accepts). Only `undefined` env = auth disabled.
 *   Resolved via {@link readApiKey} sentinel pattern.
 * - EC-2 — case-insensitive `Bearer` scheme per RFC 6750 § 2.1 (parsed by
 *   {@link ../middleware.ts}).
 * - EC-3 — token compared verbatim with no trim. Operator responsible for
 *   clean env values.
 * - EC-4 — `verify` length-checks BEFORE `crypto.timingSafeEqual` to prevent
 *   `RangeError` on different-length Buffer arguments. Without this guard,
 *   auth path crashes 500 instead of clean 401.
 *
 * @see Plan theo-memory-standalone-p0 § ADR D3 amended (2026-06-03)
 * @see RFC 6750 § 2.1 — Authorization Request Header Field
 * @see OWASP REST API Security cheatsheet — constant-time bearer compare
 */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import type { AuthVerifier } from '../../core/dip/auth-verifier.js';

const THEMEMORY_API_KEY_ENV = 'THEMEMORY_API_KEY';

/**
 * Resolve the configured API key from the environment with EC-1 fail-closed
 * sentinel semantics:
 *
 * - `undefined` ⇒ auth disabled (alpha-mode convenience).
 * - empty string OR whitespace-only ⇒ empty-string sentinel ⇒ middleware
 *   treats this as "auth required, no token accepts" (fail-closed). Operator
 *   who wants no-auth MUST `unset THEMEMORY_API_KEY` explicitly, not blank it.
 * - non-empty value ⇒ raw value, verbatim (no trim — EC-3).
 */
export function readApiKey(): string | undefined {
  const raw = process.env[THEMEMORY_API_KEY_ENV];
  if (raw === undefined) return undefined;
  if (raw.trim() === '') return '';
  return raw;
}

export class BearerAuthVerifier implements AuthVerifier {
  readonly #expectedToken: string;

  /**
   * @param expectedToken — the configured bearer credential. Empty string is
   *   accepted as the fail-closed sentinel: `verify` returns `false` for any
   *   non-empty input AND `false` for empty input as well (defense-in-depth).
   */
  constructor(expectedToken: string) {
    this.#expectedToken = expectedToken;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract returns Promise<boolean> for future async impls (OAuth/JWT); bearer compare is sync.
  async verify(token: string): Promise<boolean> {
    if (token.length !== this.#expectedToken.length) {
      return false;
    }
    if (this.#expectedToken === '') {
      return false;
    }
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(this.#expectedToken, 'utf8');
    return timingSafeEqual(a, b);
  }
}
