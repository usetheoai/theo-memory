/**
 * T1.1 RED tests for v0.4b `EvictionPolicy` DIP.
 *
 * Asserts the STRUCTURAL CONTRACT of the 8th DIP at `src/core/dip/eviction-policy.ts`:
 *   - `EvictionPolicy` interface with `kind` discriminator + 2 required methods
 *     (`score`, `selectVictims`) + 2 optional lifecycle hooks (`onEvictionStart`,
 *     `onEvictionEnd`). Total 4 method entries per plan T1.1.
 *   - `ScoreContext` carries `meanIsolationDistance` + `now` for deterministic scoring.
 *   - `EvictionResult` distinguishes `softDeleted`, `alreadyInvalid`, `errors`.
 *   - `InvalidFractionError` thrown by `assertValidFraction` when fraction outside [0, 1]
 *     (EC-5 absorption from plan v1.1 edge-case review).
 *
 * Pure type-shape assertions via implementation stub — tsc enforces the contract.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T1.1 (ADR D12)
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md § D8 + D9 (scoring composition + long-tail multiplier)
 */
import { describe, expect, test } from 'vitest';

import {
  assertValidFraction,
  InvalidFractionError,
  type EvictionPolicy,
  type EvictionResult,
  type HalfLifePersister,
  type NearestNeighborProvider,
  type ScoreContext,
} from '../dip/eviction-policy.js';
import type { MemoryItem } from '../memory-item.js';
import type { Scope } from '../scope.js';

class StubEvictionPolicy implements EvictionPolicy {
  readonly kind = 'stub' as const;

  async score(_memory: MemoryItem, _context: ScoreContext): Promise<number> {
    await Promise.resolve();
    return 0.5;
  }

  async selectVictims(
    candidates: readonly MemoryItem[],
    fraction: number,
    _context: ScoreContext,
  ): Promise<readonly string[]> {
    await Promise.resolve();
    assertValidFraction(fraction);
    const n = Math.floor(candidates.length * fraction);
    return candidates.slice(0, n).map((c) => c.id);
  }
}

describe('EvictionPolicy DIP (T1.1 / D12)', () => {
  test('exports EvictionPolicy interface implementable by a stub', () => {
    const policy: EvictionPolicy = new StubEvictionPolicy();
    expect(policy.kind).toBe('stub');
    expect(typeof policy.score).toBe('function');
    expect(typeof policy.selectVictims).toBe('function');
  });

  test('exports EvictionResult with softDeleted / alreadyInvalid / errors fields', () => {
    const result: EvictionResult = {
      softDeleted: ['a', 'b'],
      alreadyInvalid: ['c'],
      errors: [],
    };
    expect(result.softDeleted).toHaveLength(2);
    expect(result.alreadyInvalid).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  test('exports ScoreContext with meanIsolationDistance + now fields', () => {
    const context: ScoreContext = {
      meanIsolationDistance: 0.42,
      now: new Date('2026-05-30T00:00:00Z'),
    };
    expect(context.meanIsolationDistance).toBe(0.42);
    expect(context.now.toISOString()).toBe('2026-05-30T00:00:00.000Z');
  });

  test('exports HalfLifePersister interface implementable by a stub (T5.1 / F-arch-2)', async () => {
    const persisted: { id: string; h: number }[] = [];
    const persister: HalfLifePersister = {
      async persist(memoryId: string, halfLifeSeconds: number): Promise<void> {
        await Promise.resolve();
        persisted.push({ id: memoryId, h: halfLifeSeconds });
      },
    };
    await persister.persist('mem-a', 86_400);
    expect(persisted).toEqual([{ id: 'mem-a', h: 86_400 }]);
  });

  test('exports NearestNeighborProvider interface implementable by a stub (T5.1 / F-arch-2)', async () => {
    const provider: NearestNeighborProvider = {
      async distance(memoryId: string, scope: Scope): Promise<number> {
        await Promise.resolve();
        return scope.kind === 'user' && memoryId === 'rare' ? 0.95 : 0.5;
      },
    };
    const dist = await provider.distance('rare', { kind: 'user', userId: 'alice' });
    expect(dist).toBe(0.95);
  });
});

describe('assertValidFraction guard (T1.1 / EC-5)', () => {
  test('accepts fraction = 0 (boundary)', () => {
    expect(() => assertValidFraction(0)).not.toThrow();
  });

  test('accepts fraction = 1 (boundary)', () => {
    expect(() => assertValidFraction(1)).not.toThrow();
  });

  test('accepts fraction = 0.5 (interior)', () => {
    expect(() => assertValidFraction(0.5)).not.toThrow();
  });

  test('rejects fraction < 0 with InvalidFractionError', () => {
    expect(() => assertValidFraction(-0.1)).toThrow(InvalidFractionError);
  });

  test('rejects fraction > 1 with InvalidFractionError', () => {
    expect(() => assertValidFraction(1.5)).toThrow(InvalidFractionError);
  });

  test('rejects NaN with InvalidFractionError', () => {
    expect(() => assertValidFraction(Number.NaN)).toThrow(InvalidFractionError);
  });

  test('InvalidFractionError instance survives instanceof across ESM boundary', () => {
    try {
      assertValidFraction(-1);
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidFractionError);
      expect((err as InvalidFractionError).name).toBe('InvalidFractionError');
      return;
    }
    throw new Error('assertValidFraction(-1) did not throw');
  });
});
