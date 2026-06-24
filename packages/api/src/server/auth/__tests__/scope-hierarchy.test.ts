/**
 * RED tests — scope hierarchy helper (Model B slice 1 / plan T1.1, ADR D2).
 *
 * `scopeSatisfies(granted, required)` answers "does this key's scope set
 * satisfy the required scope?", honoring the implication
 * `memory:platform-admin ⊇ memory:admin`. This keeps `requireScope`
 * SRP-simple (single required scope) while letting a platform key pass a
 * `memory:admin` gate (the gateway's per-tenant lifecycle uses admin routes).
 *
 * @see .claude/knowledge-base/plans/model-b-platform-admin-mint-plan.md § T1.1
 */
import { describe, expect, test } from 'vitest';

import { scopeSatisfies } from '../scope-hierarchy.js';

describe('scopeSatisfies — scope implication', () => {
  test('exact match satisfies', () => {
    expect(scopeSatisfies(['memory:read'], 'memory:read')).toBe(true);
  });

  test('memory:platform-admin satisfies a memory:admin requirement (⊇)', () => {
    expect(scopeSatisfies(['memory:platform-admin'], 'memory:admin')).toBe(true);
  });

  test('memory:admin does NOT satisfy a memory:platform-admin requirement', () => {
    expect(scopeSatisfies(['memory:admin'], 'memory:platform-admin')).toBe(false);
  });

  test('unrelated scope does not satisfy', () => {
    expect(scopeSatisfies(['memory:read', 'memory:write'], 'memory:admin')).toBe(false);
  });

  test('empty grants satisfy nothing', () => {
    expect(scopeSatisfies([], 'memory:read')).toBe(false);
  });

  test('platform-admin also satisfies itself', () => {
    expect(scopeSatisfies(['memory:platform-admin'], 'memory:platform-admin')).toBe(true);
  });
});
