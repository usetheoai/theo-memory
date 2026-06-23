/**
 * Type-level contract test for the GraphExpansionStore DIP (T1.1).
 * Asserts the exact 1-method async signature per ADR D1 + ADR-0008 cap.
 */
import { expectTypeOf, test } from 'vitest';

import type {
  GraphExpansionStore,
  ExpandByEntitiesParams,
  GraphExpansionRow,
} from './graph-expansion-store.js';
import type { VectorStoreResult } from './vector-store.js';

test('GraphExpansionStore exposes exactly expandByEntities(params): Promise<readonly GraphExpansionRow[]>', () => {
  expectTypeOf<GraphExpansionStore>().toHaveProperty('expandByEntities');
  expectTypeOf<GraphExpansionStore['expandByEntities']>().parameters.toEqualTypeOf<
    [ExpandByEntitiesParams]
  >();
  expectTypeOf<GraphExpansionStore['expandByEntities']>().returns.toEqualTypeOf<
    Promise<readonly GraphExpansionRow[]>
  >();
});

test('GraphExpansionRow.result is the domain VectorStoreResult (no pipeline-internal coupling)', () => {
  expectTypeOf<GraphExpansionRow['result']>().toEqualTypeOf<VectorStoreResult>();
  expectTypeOf<GraphExpansionRow['sharedEntities']>().toEqualTypeOf<number>();
});

test('a conforming stub satisfies GraphExpansionStore', () => {
  const stub: GraphExpansionStore = {
    expandByEntities: async () => [],
  };
  expectTypeOf(stub).toMatchTypeOf<GraphExpansionStore>();
});
