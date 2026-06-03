/**
 * T1.2 RED test — `NoopConflictPolicy` returns empty array for ANY input,
 * preserving the ADD-only invariant (ADR-0003). DEFAULT policy on
 * `Memory.reflect({ conflictResolution })` per ADR D2.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T1.2 + ADR D2
 */
import { describe, expect, test } from 'vitest';

import { NoopConflictPolicy } from '../noop.js';
import type { ConsolidationCandidate, ConsolidationContext } from '../../dip/conflict-resolution-policy.js';

const ctx: ConsolidationContext = {
  scope: { kind: 'user', userId: 'alice' },
  observationDate: new Date('2026-06-01T16:00:00Z'),
};

const fixture: ConsolidationCandidate[] = [
  { memoryId: 'mem-a', text: 'Paulo prefers oat milk', createdAt: new Date('2026-06-01T10:00:00Z') },
  { memoryId: 'mem-b', text: 'Paulo likes milk', createdAt: new Date('2026-06-01T11:00:00Z') },
];

describe('NoopConflictPolicy (T1.2 / ADR D2)', () => {
  test('exposes kind = "noop"', () => {
    const policy = new NoopConflictPolicy();
    expect(policy.kind).toBe('noop');
  });

  test('returns empty array for non-empty candidates (ADD-only preservation)', async () => {
    const policy = new NoopConflictPolicy();
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  test('returns empty array for empty candidates', async () => {
    const policy = new NoopConflictPolicy();
    const results = await policy.consolidate([], ctx);
    expect(results).toEqual([]);
  });
});
