/**
 * Type-level contract test for the AdaptiveRetrievalPolicy DIP (T1.1).
 * Asserts the exact 2-method async signature per ADR D1 + ADR-0008 cap.
 * A wrong-shaped impl fails `tsc --noEmit`.
 */
import { expectTypeOf, test } from 'vitest';

import type {
  AdaptiveRetrievalPolicy,
  RetrievalDecision,
  RetrievalAssessment,
} from './adaptive-retrieval-policy.js';
import type { MemoryItemWithScore } from '../memory-item.js';
import type { Scope } from '../scope.js';

test('AdaptiveRetrievalPolicy exposes shouldRetrieve + assess (2 methods, ADR-0008 cap)', () => {
  expectTypeOf<AdaptiveRetrievalPolicy>().toHaveProperty('shouldRetrieve');
  expectTypeOf<AdaptiveRetrievalPolicy>().toHaveProperty('assess');
  expectTypeOf<AdaptiveRetrievalPolicy['shouldRetrieve']>().parameters.toEqualTypeOf<
    [string, Scope]
  >();
  expectTypeOf<AdaptiveRetrievalPolicy['shouldRetrieve']>().returns.toEqualTypeOf<
    Promise<RetrievalDecision>
  >();
  expectTypeOf<AdaptiveRetrievalPolicy['assess']>().returns.toEqualTypeOf<
    Promise<RetrievalAssessment>
  >();
  // assess takes (query, results, tuning?) — the optional 3rd param forwards
  // RecallOptions.adaptive per-call overrides.
  expectTypeOf<Parameters<AdaptiveRetrievalPolicy['assess']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<AdaptiveRetrievalPolicy['assess']>[1]>().toEqualTypeOf<
    readonly MemoryItemWithScore[]
  >();
});

test('RetrievalAssessment.action is the literal union accept|relax|reject', () => {
  expectTypeOf<RetrievalAssessment['action']>().toEqualTypeOf<'accept' | 'relax' | 'reject'>();
});

test('a conforming stub satisfies AdaptiveRetrievalPolicy', () => {
  const stub: AdaptiveRetrievalPolicy = {
    shouldRetrieve: async () => ({ retrieve: true }),
    assess: async () => ({ sufficient: true, action: 'accept' }),
  };
  expectTypeOf(stub).toMatchTypeOf<AdaptiveRetrievalPolicy>();
});
