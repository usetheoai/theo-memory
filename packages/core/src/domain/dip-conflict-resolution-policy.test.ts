/**
 * T1.1 RED tests for v0.7 `ConflictResolutionPolicy` DIP — 9th DIP at
 * `src/core/dip/conflict-resolution-policy.ts`.
 *
 * Asserts the STRUCTURAL CONTRACT of the DIP:
 *   - `ConflictResolutionPolicy` interface with `kind` discriminator +
 *     1 required method (`consolidate`). Total 2 method entries per plan T1.1.
 *   - `ConsolidationCandidate` carries `memoryId` + `text` + `createdAt`
 *     (minimum: memoryId for EC-1 lex tie-break + EC-2 cluster ID
 *     validation; text for LLM judge reasoning; createdAt for LWW comparator).
 *   - `ConsolidationContext` per-call: `scope` + `observationDate`. LLM is
 *     injected at policy CONSTRUCTOR (T1.3) per all 8 sibling-DIP precedent;
 *     LLM NOT in per-call context.
 *   - `ConflictResolutionResult` matches T0.1 schema columns: `keptMemoryId`,
 *     `rejectedMemoryIds[]`, `reason`, `policyName`, `originalEpisodeIds[]`.
 *
 * Plan-declared location was tests/unit/conflict-resolution/dip-shape.test.ts
 * but that path is NOT tsconfig.contract include-d AND vitest.contract typecheck
 * only covers .test-d.ts files under src/{core,theokit}/__tests__/ — so type-only
 * imports erase at runtime + the RED would silently pass. Relocated to mirror
 * the dip-eviction-policy.test.ts precedent: the implementation stub forces
 * tsc to typecheck the interface presence/shape via tsconfig.contract.json's
 * src/core/ include, so RED fails the right way (module not found).
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T1.1 + ADR D2
 * @see .claude/knowledge-base/discoveries/blueprints/v0-7-episodic-semantic-distillation-blueprint.md § R3 (3-impl strategy DIP)
 * @see src/core/__tests__/dip-eviction-policy.test.ts (8th DIP precedent shape)
 */
import { describe, expect, test } from 'vitest';

import {
  type ConflictResolutionPolicy,
  type ConsolidationCandidate,
  type ConsolidationContext,
  type ConflictResolutionResult,
} from './dip/conflict-resolution-policy.js';
import type { Scope } from './scope.js';

class StubConflictResolutionPolicy implements ConflictResolutionPolicy {
  readonly kind = 'stub' as const;

  async consolidate(
    candidates: readonly ConsolidationCandidate[],
    _context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    await Promise.resolve();
    if (candidates.length === 0) return [];
    const [keep, ...rest] = candidates;
    if (keep === undefined) return [];
    return [
      {
        keptMemoryId: keep.memoryId,
        rejectedMemoryIds: rest.map((r) => r.memoryId),
        reason: 'stub: kept first candidate',
        policyName: 'stub',
        originalEpisodeIds: candidates.map((c) => c.memoryId),
      },
    ];
  }
}

describe('ConflictResolutionPolicy DIP (T1.1 / ADR D2)', () => {
  test('exports ConflictResolutionPolicy interface implementable by a stub', () => {
    const policy: ConflictResolutionPolicy = new StubConflictResolutionPolicy();
    expect(policy.kind).toBe('stub');
    expect(typeof policy.consolidate).toBe('function');
  });

  test('exports ConsolidationCandidate with memoryId + text + createdAt fields', () => {
    const candidate: ConsolidationCandidate = {
      memoryId: 'mem-a',
      text: 'Paulo prefers oat milk',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    };
    expect(candidate.memoryId).toBe('mem-a');
    expect(candidate.text).toBe('Paulo prefers oat milk');
    expect(candidate.createdAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('exports ConsolidationContext with scope + observationDate fields (LLM injected at constructor, NOT context)', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const context: ConsolidationContext = {
      scope,
      observationDate: new Date('2026-06-01T16:00:00Z'),
    };
    expect(context.scope.kind).toBe('user');
    expect(context.observationDate.toISOString()).toBe(
      '2026-06-01T16:00:00.000Z',
    );
  });

  test('exports ConflictResolutionResult with the 5 fields matching T0.1 schema columns', () => {
    const result: ConflictResolutionResult = {
      keptMemoryId: 'mem-a',
      rejectedMemoryIds: ['mem-b', 'mem-c'],
      reason: 'a is more specific than b and c',
      policyName: 'llm-judged-merge',
      originalEpisodeIds: ['episode-1', 'episode-2'],
    };
    expect(result.keptMemoryId).toBe('mem-a');
    expect(result.rejectedMemoryIds).toEqual(['mem-b', 'mem-c']);
    expect(result.policyName).toBe('llm-judged-merge');
    expect(result.originalEpisodeIds).toEqual(['episode-1', 'episode-2']);
  });

  test('consolidate returns empty array (abstain) for empty candidates input', async () => {
    const policy = new StubConflictResolutionPolicy();
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const results = await policy.consolidate([], {
      scope,
      observationDate: new Date('2026-06-01T16:00:00Z'),
    });
    expect(results).toEqual([]);
  });
});
