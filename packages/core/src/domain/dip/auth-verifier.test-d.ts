/**
 * Type-level shape assertion for the 12th DIP: AuthVerifier.
 *
 * @see Plan theo-memory-standalone-p0 § ADR D3 (amended 2026-06-03) — Bearer auth
 *      via THEMEMORY_API_KEY with empty/whitespace fail-closed (EC-1), case-insensitive
 *      Bearer scheme per RFC 6750 (EC-2), token compared verbatim (EC-3).
 * @see Plan theo-memory-standalone-p0 § T0.1 + T1.1 (BearerAuthVerifier impl).
 * @see EC-4 — verify(token) MUST length-check BEFORE crypto.timingSafeEqual to
 *      prevent RangeError crash in auth path.
 */
import { describe, test, expectTypeOf } from 'vitest';

import type { Principal } from '../principal.js';
import type { AuthVerifier } from './auth-verifier.js';

describe('AuthVerifier (12th DIP) — type-level shape', () => {
  test('exposes verify(token: string): Promise<boolean>', () => {
    expectTypeOf<AuthVerifier>().toHaveProperty('verify');
    expectTypeOf<AuthVerifier['verify']>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<AuthVerifier['verify']>().returns.toEqualTypeOf<Promise<boolean>>();
  });

  test('exposes optional resolvePrincipal(token): Promise<Principal | null> (ADR D2)', () => {
    // multi-tenant-workspace-isolation ADR D2 (additive-then-breaking): the
    // verifier evolves from a boolean check to resolving a Principal. During
    // the Phase 0→2 migration window resolvePrincipal is OPTIONAL so the 3
    // existing impls keep compiling; Phase 4 promotes it to required and
    // removes verify.
    expectTypeOf<AuthVerifier>().toHaveProperty('resolvePrincipal');
    expectTypeOf<NonNullable<AuthVerifier['resolvePrincipal']>>().returns.toEqualTypeOf<
      Promise<Principal | null>
    >();
  });

  test('interface exposes exactly { verify, resolvePrincipal } (ISP discipline per architecture.md § 13.4)', () => {
    type Method = keyof AuthVerifier;
    expectTypeOf<Method>().toEqualTypeOf<'verify' | 'resolvePrincipal'>();
  });
});
