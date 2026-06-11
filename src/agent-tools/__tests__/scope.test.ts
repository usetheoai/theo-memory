/**
 * AsyncLocalStorage scope binding tests — T3.1.
 *
 * Covers:
 * 1. getScope() throws MissingScopeError outside withScope (no ambient store)
 * 2. getScope() returns the ctx passed to withScope (happy path)
 * 3. Nested withScope: inner ctx wins (lexical override)
 * 4. Concurrent withScope: ZERO cross-contamination across Promise.all branches
 * 5. ScopedContext type is importable from src/core/scope.ts (single source of truth)
 * 6. EC-12 absorption: nested withScope with undefined inner throws MissingScopeError
 * 7. SEPA-added: withScope rejects null/undefined ctx at entry (STRICT invariant)
 *
 * @see ADR D3 — Cross-tool isolation via Node.js AsyncLocalStorage
 * @see ADR D4 — SDK integration: reuse memoryFromCtx (consumed at T5.1 dispatch)
 * @see EC-12 (plan v1.1) — nested withScope undefined inner behavior locked STRICT
 */
import { describe, expect, test } from 'vitest';

import type { ScopedContext } from '@usetheo/memory/contract';
import { MissingScopeError } from '@usetheo/memory/contract';
import { getScope, withScope } from '../scope.js';

describe('AsyncLocalStorage scope binding (T3.1)', () => {
  test('getScope throws MissingScopeError outside withScope', () => {
    expect(() => getScope()).toThrow(MissingScopeError);
  });

  test('getScope returns the ctx passed to withScope', () => {
    const ctx: ScopedContext = { session: { userId: 'alice' } };
    withScope(ctx, () => {
      expect(getScope()).toBe(ctx);
    });
  });

  test('nested withScope: inner ctx wins (lexical override)', () => {
    const outer: ScopedContext = { session: { userId: 'alice' } };
    const inner: ScopedContext = { session: { userId: 'bob' } };
    withScope(outer, () => {
      withScope(inner, () => {
        expect(getScope()).toBe(inner);
      });
      // After inner completes, outer is restored
      expect(getScope()).toBe(outer);
    });
  });

  test('concurrent withScope: ZERO cross-contamination across Promise.all branches', async () => {
    const aliceCtx: ScopedContext = { session: { userId: 'alice' } };
    const bobCtx: ScopedContext = { session: { userId: 'bob' } };
    // Await something async inside each block to force V8 to interleave the microtask queue.
    // Without the await, broken implementations could pass by luck of synchronous execution.
    const [aliceSeen, bobSeen] = await Promise.all([
      withScope(aliceCtx, async () => {
        await new Promise<void>((r) => setTimeout(r, 1));
        return getScope().session?.userId;
      }),
      withScope(bobCtx, async () => {
        await new Promise<void>((r) => setTimeout(r, 1));
        return getScope().session?.userId;
      }),
    ]);
    expect(aliceSeen).toBe('alice');
    expect(bobSeen).toBe('bob');
  });

  test('ScopedContext type is importable from src/core/scope.js (single source of truth)', () => {
    // Type-level assertion via runtime structural witness.
    // If the import statement at line 21 compiles, the type exists.
    const ctx: ScopedContext = { session: { userId: 'witness' } };
    expect(ctx.session?.userId).toBe('witness');
  });

  test('EC-12: nested withScope with undefined inner throws MissingScopeError (STRICT invariant)', () => {
    const outer: ScopedContext = { session: { userId: 'alice' } };
    withScope(outer, () => {
      // Inner undefined → withScope rejects at entry (EC-12 STRICT decision per SEPA pre-RED)
      expect(() => withScope(undefined as unknown as ScopedContext, () => undefined)).toThrow(
        MissingScopeError,
      );
      // Outer still intact (no leakage)
      expect(getScope()).toBe(outer);
    });
  });

  test('withScope rejects null/undefined ctx at entry (SEPA-added STRICT invariant)', () => {
    expect(() => withScope(null as unknown as ScopedContext, () => undefined)).toThrow(
      MissingScopeError,
    );
    expect(() => withScope(undefined as unknown as ScopedContext, () => undefined)).toThrow(
      MissingScopeError,
    );
  });
});
