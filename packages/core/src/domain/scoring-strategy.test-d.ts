/**
 * T1.1 RED test-d for ScoringStrategy DIP per plan v0-4a-reflection-pipeline.
 *
 * Type-level conformance: any class implementing ScoringStrategy MUST have
 * the score method with the documented signature. Method count: 1 required.
 *
 * Independent of ADR-0008's locked 5 DIPs (embedder/llm/vector-store/
 * history-manager/reflection-policy). This is the 6th DIP per plan ADR D2.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T1.1 + ADR D2
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md § D9
 */
import { expectTypeOf, test } from 'vitest';

import type {
  ScoreInput,
  ScoringStrategy,
  ScoringWeights,
} from './dip/scoring-strategy.js';

test('ScoreInput.recency is a number', () => {
  expectTypeOf<ScoreInput['recency']>().toEqualTypeOf<number>();
});

test('ScoreInput.relevance is a number', () => {
  expectTypeOf<ScoreInput['relevance']>().toEqualTypeOf<number>();
});

test('ScoreInput.importance is a number', () => {
  expectTypeOf<ScoreInput['importance']>().toEqualTypeOf<number>();
});

test('ScoringWeights.recency is a number', () => {
  expectTypeOf<ScoringWeights['recency']>().toEqualTypeOf<number>();
});

test('ScoringWeights.relevance is a number', () => {
  expectTypeOf<ScoringWeights['relevance']>().toEqualTypeOf<number>();
});

test('ScoringWeights.importance is a number', () => {
  expectTypeOf<ScoringWeights['importance']>().toEqualTypeOf<number>();
});

test('ScoringStrategy.score is REQUIRED (no `?`)', () => {
  expectTypeOf<ScoringStrategy['score']>().parameters.toEqualTypeOf<
    [readonly ScoreInput[]]
  >();
  expectTypeOf<ScoringStrategy['score']>().returns.toEqualTypeOf<readonly number[]>();
});

test('minimal stub implementing only score compiles', () => {
  class MinimalStub implements ScoringStrategy {
    score(items: readonly ScoreInput[]): readonly number[] {
      return items.map(() => 0);
    }
  }
  expectTypeOf<MinimalStub>().toMatchTypeOf<ScoringStrategy>();
});
