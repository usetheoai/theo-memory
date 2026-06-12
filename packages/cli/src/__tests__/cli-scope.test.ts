/**
 * T1.1 contract — resolveCliScope helper.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T1.1
 */
import { describe, expect, test } from 'vitest';

import { resolveCliScope, validateScopeOpts } from '../cli-scope.js';

import type { Memory, ScopedMemory } from '@usetheo/memory/contract';

function makeMockMemory(): Memory {
  const make = (kind: 'user' | 'session' | 'agent', id: string): ScopedMemory =>
    ({
      remember: () => Promise.resolve([]),
      recall: () => Promise.resolve([]),
      reflect: () => Promise.resolve({ sourceCount: 0, derivedCount: 0, derived: [] }),
      getAll: () => Promise.resolve([]),
      __mockKind: kind,
      __mockId: id,
    }) as unknown as ScopedMemory;
  return {
    user: (id: string) => make('user', id),
    session: (id: string) => make('session', id),
    agent: (id: string) => make('agent', id),
    skills: () => ({}) as never,
    remember: () => Promise.resolve([]),
    recall: () => Promise.resolve([]),
    forget: () => Promise.resolve(),
    reflect: () => Promise.resolve({ sourceCount: 0, derivedCount: 0, derived: [] }),
    getAll: () => Promise.resolve([]),
    history: () => Promise.resolve([]),
  } as unknown as Memory;
}

describe('T1.1 — resolveCliScope', () => {
  test('1. user → returns user-scoped memory', () => {
    const memory = makeMockMemory();
    const scoped = resolveCliScope(memory, { user: 'alice' }) as unknown as Record<string, unknown>;
    expect(scoped['__mockKind']).toBe('user');
    expect(scoped['__mockId']).toBe('alice');
  });

  test('2. session → returns session-scoped memory', () => {
    const memory = makeMockMemory();
    const scoped = resolveCliScope(memory, { session: 's-1' }) as unknown as Record<string, unknown>;
    expect(scoped['__mockKind']).toBe('session');
    expect(scoped['__mockId']).toBe('s-1');
  });

  test('3. agent → returns agent-scoped memory', () => {
    const memory = makeMockMemory();
    const scoped = resolveCliScope(memory, { agent: 'a-1' }) as unknown as Record<string, unknown>;
    expect(scoped['__mockKind']).toBe('agent');
    expect(scoped['__mockId']).toBe('a-1');
  });

  test('4. zero scope flags → throws', () => {
    const memory = makeMockMemory();
    expect(() => resolveCliScope(memory, {})).toThrow(/exactly one required/);
  });

  test('5. user + session both → throws', () => {
    const memory = makeMockMemory();
    expect(() => resolveCliScope(memory, { user: 'u', session: 's' })).toThrow(
      /exactly one required/,
    );
  });

  test('6. user + agent both → throws', () => {
    const memory = makeMockMemory();
    expect(() => resolveCliScope(memory, { user: 'u', agent: 'a' })).toThrow(
      /exactly one required/,
    );
  });
});

// ── verbs-as-cli-fixes-cycle-1 T3.2 / EC-6 — validateScopeOpts boundary tests.
//    Mirrors resolveCliScope's zero/exactly-one/multi paths but at the boundary
//    BEFORE Memory factory warm-up. Locks fail-fast behavior at the contract
//    layer; integration test 3 (verbs-cli-fixes.test.ts) captures end-to-end
//    elapsed-time guarantee.
describe('T3.2 — validateScopeOpts (fail-fast boundary)', () => {
  test('zero scope → throws "exactly one required"', () => {
    expect(() => validateScopeOpts({})).toThrow(/exactly one required/);
  });

  test('exactly one scope (user) → returns void (does NOT throw)', () => {
    expect(() => validateScopeOpts({ user: 'alice' })).not.toThrow();
  });

  test('multi scope (user + session) → throws "exactly one required"', () => {
    expect(() => validateScopeOpts({ user: 'a', session: 'b' })).toThrow(
      /exactly one required/,
    );
  });
});
