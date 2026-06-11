/**
 * Type-only tests for `ScopedContext` interface — T0.2 of plan v0-2-theokit-binding (v1.1).
 *
 * **Why type tests despite `testing.md § What NOT to test` general prohibition:**
 * The interface MUST structurally subsume 5 heterogeneous TheoKit fixture variants
 * documented in blueprint Q5. Structural typing across these shapes is a "tricky
 * inference path" (the explicit exception in `testing.md`) — a regression to
 * `userId: string` (non-optional) would silently break `auth-providers-diy-github`
 * unauth/OAuth-round-trip states without any runtime test catching it.
 *
 * **Why a generic helper instead of direct assignment or `toMatchTypeOf`:**
 * TypeScript's "no properties in common" guard fires on direct variable assignment
 * (e.g., `const a: ScopedContext = {db: {}}`) — but NOT on function parameter passing
 * (the actual binding consumer pattern, since T1.1's `memoryFromCtx<T extends
 * ScopedContext>(ctx: T, memory)` uses a generic constraint). The generic helper
 * `asScopedContext<T extends ScopedContext>(t)` mirrors T1.1's signature exactly,
 * so the type check below validates what the REAL binding call site validates.
 *
 * Fixtures replicated verbatim from `../theokit/fixtures/{name}/server/context.ts`
 * inspected during /discover-execute Q5.
 */
import { expect, expectTypeOf, test } from 'vitest';

import type { ScopedContext } from './types.js';

/** Mirror of T1.1's `memoryFromCtx<T extends ScopedContext>` generic constraint. */
function asScopedContext<T extends ScopedContext>(ctx: T): T {
  return ctx;
}

test('F1 — sessions-auth fixture shape is assignable to ScopedContext', () => {
  const ctx: { session: { userId: string; username: string } } = {
    session: { userId: 'u1', username: 'paulo' },
  };
  expect(asScopedContext(ctx)).toBeDefined();
});

test('F2 — template-saas fixture shape (session + db) is assignable to ScopedContext', () => {
  const ctx: { session: { userId: string; email: string }; db: object } = {
    session: { userId: 'u1', email: 'paulo@example.com' },
    db: {},
  };
  expect(asScopedContext(ctx)).toBeDefined();
});

test('F3 — auth-providers-with-authjs (UserSession with optional name) is assignable to ScopedContext', () => {
  const ctx: { session: { userId: string; email: string; name?: string } } = {
    session: { userId: 'u1', email: 'paulo@example.com', name: 'Paulo' },
  };
  expect(asScopedContext(ctx)).toBeDefined();
});

test('F4a — auth-providers-diy-github (unauthenticated, session=null) is assignable to ScopedContext', () => {
  const ctx: { session: null } = { session: null };
  expect(asScopedContext(ctx)).toBeDefined();
});

test('F4b — auth-providers-diy-github (OAuth round-trip, userId undefined) is assignable to ScopedContext', () => {
  const ctx: {
    session: {
      userId?: string;
      login?: string;
      pending?: { codeVerifier: string; state: string };
    };
  } = {
    session: {
      login: 'paulohenriquevn',
      pending: { codeVerifier: 'v', state: 's' },
    },
  };
  expect(asScopedContext(ctx)).toBeDefined();
});

test('F5 — template-postgres fixture shape (NO session field at all) is correctly REJECTED at compile time', () => {
  // ADR D3 + D4 alignment: template-postgres has NO `session` field in its
  // current upstream shape (verified `../theokit/fixtures/template-postgres/server/context.ts`).
  // TypeScript's "weak type" rule rejects assignment of an object with ZERO
  // overlapping properties to a weak target type (ScopedContext is weak — only
  // one optional property). This rejection is CORRECT — calling memoryFromCtx
  // on such a context would throw MissingScopeError at runtime per ADR D4 state (c).
  //
  // T4.3 (PR-B) augments postgres template's context.ts to ADD session; after that
  // augmentation, this fixture would have a session field and the rejection would
  // no longer apply. Until then, the binding is correctly type-incompatible with
  // template-postgres handlers — surfacing the mismatch at compile time, not runtime.
  const ctx: { db: object } = { db: {} };
  // @ts-expect-error — weak type guard fires; F5 documents this expected TS rejection
  asScopedContext(ctx);
  expect(ctx).toBeDefined();
});

test('EC-8 — sessionId and agentId fields are reserved (declared on interface, not resolved by v0.2 binding)', () => {
  // SHOULD TEST EC-8: interface declares all three scope tiers; T1.1's resolver
  // only consumes userId at v0.2. Future versions may multi-resolve.
  type SessionField = NonNullable<ScopedContext['session']>;
  expectTypeOf<SessionField>().toHaveProperty('userId');
  expectTypeOf<SessionField>().toHaveProperty('sessionId');
  expectTypeOf<SessionField>().toHaveProperty('agentId');
});
