import { describe, expectTypeOf, test } from 'vitest';

import type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from './options.js';
import type { Filters } from './scope.js';

describe('option types — fields are readonly + optional + primitive', () => {
  test('RememberOptions exposes metadata + infer', () => {
    expectTypeOf<RememberOptions['metadata']>().toEqualTypeOf<
      Readonly<Record<string, string | number | boolean | null>> | undefined
    >();
    expectTypeOf<RememberOptions['infer']>().toEqualTypeOf<boolean | undefined>();
  });

  test('RecallOptions exposes topK + threshold + asOf', () => {
    expectTypeOf<RecallOptions['topK']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RecallOptions['threshold']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RecallOptions['asOf']>().toEqualTypeOf<Date | undefined>();
  });

  test('RecallOptions exposes rerank opt-in shape (cross-encoder-reranker T2.1)', () => {
    expectTypeOf<RecallOptions['rerank']>().toEqualTypeOf<
      { readonly topK?: number; readonly pool?: number } | undefined
    >();
  });

  test('ForgetOptions exposes hard', () => {
    expectTypeOf<ForgetOptions['hard']>().toEqualTypeOf<boolean | undefined>();
  });

  test('ReflectOptions exposes maxIterations', () => {
    expectTypeOf<ReflectOptions['maxIterations']>().toEqualTypeOf<number | undefined>();
  });

  test('GetAllOptions exposes topK + filters', () => {
    expectTypeOf<GetAllOptions['topK']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<GetAllOptions['filters']>().toEqualTypeOf<Filters | undefined>();
  });
});

describe('contract invariants on options', () => {
  test('all RememberOptions fields are optional (empty object compiles)', () => {
    const noOptions: RememberOptions = {};
    expectTypeOf(noOptions).toMatchTypeOf<RememberOptions>();
  });

  test('RecallOptions accepts asOf at the type level (runtime divergence per D6)', () => {
    const withAsOf: RecallOptions = { asOf: new Date('2026-01-01T00:00:00Z') };
    expectTypeOf(withAsOf).toMatchTypeOf<RecallOptions>();
  });
});
