/**
 * Tests for `memoryFromCtx` — T1.1 of plan v0-2-theokit-binding (v1.1).
 *
 * 10 tests covering ADR D4's 3-state resolver + 4 edge-case absorptions
 * (EC-3 runtime type-guard, EC-6 whitespace-only, EC-7 no-mutation, EC-8
 * sessionId/agentId ignored).
 */
import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { MissingScopeError } from '../../domain/errors.js';
import type { Memory, ScopedMemory } from '../../domain/memory-store.js';
import { memoryFromCtx } from './index.js';
import type { ScopedContext } from './types.js';

function makeMemoryMock(): {
  memory: Memory;
  scoped: ScopedMemory;
} {
  const scoped = mock<ScopedMemory>();
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  return { memory, scoped };
}

describe('memoryFromCtx — state (a): userId present', () => {
  test('returns memory.user(userId) when ctx.session.userId is non-empty string', () => {
    const { memory, scoped } = makeMemoryMock();
    const ctx: ScopedContext = { session: { userId: 'alice' } };

    const result = memoryFromCtx(ctx, memory);

    expect(memory.user).toHaveBeenCalledTimes(1);
    expect(memory.user).toHaveBeenCalledWith('alice');
    expect(result).toBe(scoped);
  });

  test('passes userId verbatim — no normalization, no namespacing (blueprint Q7)', () => {
    const { memory } = makeMemoryMock();
    const ctx: ScopedContext = { session: { userId: '  Tenant-A/UserX@example.com  '.trim() } };

    memoryFromCtx(ctx, memory);

    expect(memory.user).toHaveBeenCalledWith('Tenant-A/UserX@example.com');
  });
});

describe('memoryFromCtx — state (b): session is null (unauthenticated)', () => {
  test('throws MissingScopeError citing "authenticated session required"', () => {
    const { memory } = makeMemoryMock();
    const ctx: ScopedContext = { session: null };

    expect(() => memoryFromCtx(ctx, memory)).toThrow(MissingScopeError);
    try {
      memoryFromCtx(ctx, memory);
    } catch (err) {
      expect(err).toBeInstanceOf(MissingScopeError);
      expect((err as MissingScopeError).message).toContain('authenticated session required');
    }
  });
});

describe('memoryFromCtx — state (c): session/userId absent', () => {
  test('throws MissingScopeError citing "session-bearing TheoKit context" when session field absent', () => {
    const { memory } = makeMemoryMock();
    const ctx: ScopedContext = {};

    expect(() => memoryFromCtx(ctx, memory)).toThrow(MissingScopeError);
    try {
      memoryFromCtx(ctx, memory);
    } catch (err) {
      expect((err as MissingScopeError).message).toContain('session-bearing TheoKit context');
    }
  });

  test('throws when ctx.session present but userId undefined (OAuth round-trip per blueprint Q5)', () => {
    const { memory } = makeMemoryMock();
    const ctx: ScopedContext = { session: { sessionId: 'oauth-pending' } };

    expect(() => memoryFromCtx(ctx, memory)).toThrow(MissingScopeError);
    try {
      memoryFromCtx(ctx, memory);
    } catch (err) {
      expect((err as MissingScopeError).message).toContain('session-bearing TheoKit context');
    }
  });

  test('throws when ctx.session.userId is empty string', () => {
    const { memory } = makeMemoryMock();
    const ctx: ScopedContext = { session: { userId: '' } };

    expect(() => memoryFromCtx(ctx, memory)).toThrow(MissingScopeError);
  });

  test('EC-6: throws when ctx.session.userId is whitespace-only', () => {
    const { memory } = makeMemoryMock();
    const ctxSpaces: ScopedContext = { session: { userId: '   ' } };
    const ctxTabsNewlines: ScopedContext = { session: { userId: '\n\t  \n' } };

    expect(() => memoryFromCtx(ctxSpaces, memory)).toThrow(MissingScopeError);
    expect(() => memoryFromCtx(ctxTabsNewlines, memory)).toThrow(MissingScopeError);
  });

  test('EC-3: throws when ctx.session.userId is non-string (any-escape from consumer code)', () => {
    const { memory } = makeMemoryMock();
    const ctxNumber = { session: { userId: 123 } } as unknown as ScopedContext;
    const ctxObject = { session: { userId: { id: 'x' } } } as unknown as ScopedContext;
    const ctxNull = { session: { userId: null } } as unknown as ScopedContext;

    expect(() => memoryFromCtx(ctxNumber, memory)).toThrow(MissingScopeError);
    expect(() => memoryFromCtx(ctxObject, memory)).toThrow(MissingScopeError);
    expect(() => memoryFromCtx(ctxNull, memory)).toThrow(MissingScopeError);
  });
});

describe('memoryFromCtx — purity invariants', () => {
  test('EC-7: does NOT mutate consumer ctx during resolution', () => {
    const { memory } = makeMemoryMock();
    const ctx: ScopedContext = { session: { userId: 'alice', sessionId: 's1', agentId: 'a1' } };
    const before = structuredClone(ctx);

    memoryFromCtx(ctx, memory);

    expect(ctx).toEqual(before);
  });

  test('EC-8: sessionId/agentId fields on ctx are IGNORED — resolver returns user scope only', () => {
    const { memory, scoped } = makeMemoryMock();
    const ctx: ScopedContext = {
      session: { userId: 'alice', sessionId: 's1', agentId: 'a1' },
    };

    const result = memoryFromCtx(ctx, memory);

    expect(memory.user).toHaveBeenCalledTimes(1);
    expect(memory.user).toHaveBeenCalledWith('alice');
    expect(memory.session).not.toHaveBeenCalled();
    expect(memory.agent).not.toHaveBeenCalled();
    expect(result).toBe(scoped);
  });
});
