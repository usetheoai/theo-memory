/**
 * Type-level contract test for the RecallTraceStore DIP (T0.1).
 * Asserts the exact 2-method async signature per ADR-0008 (method-count cap)
 * plus the DropReason union and the RecallTraceRow.composite nullability
 * (EC-6). A wrong-shaped impl fails `tsc --noEmit`.
 *
 * @see plan explainable-recall § Phase 0 / T0.1
 * @see ADR-0008 (DIP method-count cap)
 */
import { expectTypeOf, test } from 'vitest';

import type {
  DropReason,
  RecallTraceBatch,
  RecallTraceRow,
  RecallTraceStore,
} from './recall-trace-store.js';

test('RecallTraceStore exposes EXACTLY record + getByRecallId (2 methods, ADR-0008)', () => {
  expectTypeOf<keyof RecallTraceStore>().toEqualTypeOf<'record' | 'getByRecallId'>();
  expectTypeOf<RecallTraceStore['record']>().parameters.toEqualTypeOf<[RecallTraceBatch]>();
  expectTypeOf<RecallTraceStore['record']>().returns.toEqualTypeOf<Promise<void>>();
  expectTypeOf<RecallTraceStore['getByRecallId']>().parameters.toEqualTypeOf<[string, string]>();
  expectTypeOf<RecallTraceStore['getByRecallId']>().returns.toEqualTypeOf<
    Promise<readonly RecallTraceRow[]>
  >();
});

test('DropReason is the 5-literal union (semantic_gate / sub_threshold / nan / mmr_redundant / superseded_recency)', () => {
  expectTypeOf<DropReason>().toEqualTypeOf<
    'semantic_gate' | 'sub_threshold' | 'nan' | 'mmr_redundant' | 'superseded_recency'
  >();
});

test('RecallTraceRow.composite is number | null (semantic_gate rows carry null, EC-6)', () => {
  expectTypeOf<RecallTraceRow['composite']>().toEqualTypeOf<number | null>();
});

test('RecallTraceBatch.rows OMIT the envelope fields (recallId/workspaceId/scopeKey/createdAt) — EC-2', () => {
  type Row = RecallTraceBatch['rows'][number];
  // Envelope fields live on the batch, never per-row (no per-row tenant keys):
  expectTypeOf<Row>().not.toHaveProperty('recallId');
  expectTypeOf<Row>().not.toHaveProperty('workspaceId');
  expectTypeOf<Row>().not.toHaveProperty('scopeKey');
  expectTypeOf<Row>().not.toHaveProperty('createdAt');
  // ...but each row carries the per-candidate reason fields:
  expectTypeOf<Row>().toHaveProperty('memoryId');
  expectTypeOf<Row>().toHaveProperty('dropReason');
  expectTypeOf<Row>().toHaveProperty('composite');
});

test('a conforming stub satisfies RecallTraceStore', () => {
  const stub: RecallTraceStore = {
    record: async () => undefined,
    getByRecallId: async () => [],
  };
  expectTypeOf(stub).toMatchTypeOf<RecallTraceStore>();
});
