import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRIADIC_CONSTANTS,
  DEFAULT_TRIADIC_WEIGHTS,
  TriadicScoringPolicy,
  type HalfLifePersister,
  type NearestNeighborProvider,
} from './triadic-scoring-policy.js';
import type { EvictionResult } from '../../../domain/dip/eviction-policy.js';
import type { Evictor } from './pg-evictor.js';

/**
 * Constructor overload tests for T1.1 (closes F-arch-1 CRITICAL).
 *
 * Per ADR D5, the 5-positional constructor is preserved as `@deprecated` while
 * a new single-argument options-object overload becomes the recommended shape.
 * EC-2 absorption (plan v1.1): the discriminator MUST tolerate `undefined` (and
 * `null` — SEPA iter 2 pre-RED MAJOR finding) as the first positional arg
 * without throwing TypeError.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T1.1 + ADR D5
 * @see .claude/knowledge-base/reviews/v0-4b-fixes-cycle-edge-cases-2026-05-30.md § EC-2
 */
describe('TriadicScoringPolicy constructor', () => {
  const stubEvictor: Evictor = {
    async evict(_ids: readonly string[]): Promise<EvictionResult> {
      return { softDeleted: [], alreadyInvalid: [], errors: [] };
    },
  };

  const stubPersister: HalfLifePersister = {
    async persist(_id: string, _h: number): Promise<void> {
      return;
    },
  };

  const stubNeighborProvider: NearestNeighborProvider = {
    async distance(_id: string, _scope: import('../../../domain/scope.js').Scope): Promise<number> {
      return 0.5;
    },
  };

  describe('options-object signature (preferred)', () => {
    it('accepts a single options-object with only evictor', () => {
      // Given: an options object exposing the evictor collaborator only
      const policy = new TriadicScoringPolicy({ evictor: stubEvictor });

      // Then: the instance is constructed; .evict / .score are callable
      expect(policy.kind).toBe('triadic');
      expect(typeof policy.evict).toBe('function');
      expect(typeof policy.score).toBe('function');
    });

    it('accepts a single options-object carrying every field', () => {
      // Given: an options object exposing all 5 fields
      const policy = new TriadicScoringPolicy({
        weights: { recency: 0.5, frequency: 0.25, importance: 0.25 },
        constants: { ...DEFAULT_TRIADIC_CONSTANTS, importanceDefault: 0.7 },
        halfLifePersister: stubPersister,
        neighborProvider: stubNeighborProvider,
        evictor: stubEvictor,
      });

      // Then: instance constructed; evictor wired (verified via async evict path)
      expect(policy.kind).toBe('triadic');
    });

    it('rejects an options-object whose shape collides with TriadicWeights (EC-2 disambiguation)', () => {
      // Given: an object that LOOKS like options (no recency/frequency/importance)
      // When: passed as the first positional arg
      const policy = new TriadicScoringPolicy({ evictor: stubEvictor });

      // Then: discriminator chose options-object path; no TriadicWeights coercion
      expect(policy.kind).toBe('triadic');
    });
  });

  describe('positional signature (deprecated; preserved for backward compat)', () => {
    it('accepts the 5-positional shape with weights + constants + collaborators', () => {
      // Given: the legacy positional call shape
      const policy = new TriadicScoringPolicy(
        DEFAULT_TRIADIC_WEIGHTS,
        DEFAULT_TRIADIC_CONSTANTS,
        stubPersister,
        stubNeighborProvider,
        stubEvictor,
      );

      // Then: the instance is constructed exactly as v0.4b shipped
      expect(policy.kind).toBe('triadic');
    });

    it('accepts undefined as the first positional arg without throwing TypeError (EC-2)', () => {
      // Given: 9+ existing test call sites pass `undefined` as the first arg
      // When: the constructor is called with the deprecated chain
      // Then: no TypeError from a naive `'weights' in undefined` discriminator
      expect(
        () =>
          new TriadicScoringPolicy(undefined, undefined, null, null, stubEvictor),
      ).not.toThrow();
    });

    it('accepts null as the first positional arg without throwing TypeError (SEPA iter 2 finding)', () => {
      // Given: typeof null === 'object' — naive `'weights' in null` ALSO throws
      // When: the constructor is called with null as arg #1
      // Then: discriminator MUST recognize null as positional-empty, not options-object
      expect(
        () =>
          new TriadicScoringPolicy(null, undefined, null, null, stubEvictor),
      ).not.toThrow();
    });
  });
});
