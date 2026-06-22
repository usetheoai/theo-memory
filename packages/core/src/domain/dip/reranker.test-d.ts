/**
 * Type-level contract test for the Reranker DIP (T1.1).
 * Asserts the exact 1-method async signature per ADR D1. A wrong-shaped impl
 * fails `tsc --noEmit`.
 */
import { expectTypeOf, test } from 'vitest';

import type { Reranker } from './reranker.js';
import type { MemoryItemWithScore } from '../memory-item.js';

test('Reranker exposes exactly rerank(query, candidates, topK): Promise<readonly MemoryItemWithScore[]>', () => {
  expectTypeOf<Reranker>().toHaveProperty('rerank');
  expectTypeOf<Reranker['rerank']>().parameters.toEqualTypeOf<
    [string, readonly MemoryItemWithScore[], number]
  >();
  expectTypeOf<Reranker['rerank']>().returns.toEqualTypeOf<
    Promise<readonly MemoryItemWithScore[]>
  >();
});

test('a conforming stub satisfies Reranker', () => {
  const stub: Reranker = {
    rerank: async (_query, candidates, topK) => candidates.slice(0, topK),
  };
  expectTypeOf(stub).toMatchTypeOf<Reranker>();
});
