import { expectTypeOf, test } from 'vitest';

import type {
  ManualReflectionPolicy,
  ReflectionPolicy,
  ReflectionTrigger,
} from '../dip/reflection-policy.js';
import type { ReflectOptions } from '../options.js';
import type { ReflectionResult } from '../reflection-result.js';
import type { Scope } from '../scope.js';

test('ReflectionTrigger.kind is exactly the three locked variants', () => {
  expectTypeOf<ReflectionTrigger['kind']>().toEqualTypeOf<'manual' | 'threshold' | 'sleep-time'>();
});

test('ReflectionTrigger.metadata is optional readonly primitives', () => {
  expectTypeOf<ReflectionTrigger['metadata']>().toEqualTypeOf<
    Readonly<Record<string, string | number | boolean | null>> | undefined
  >();
});

test('ReflectionPolicy.shouldReflect is REQUIRED (no `?`)', () => {
  expectTypeOf<ReflectionPolicy['shouldReflect']>().parameters.toEqualTypeOf<
    [Scope, ReflectionTrigger]
  >();
  expectTypeOf<ReflectionPolicy['shouldReflect']>().returns.resolves.toEqualTypeOf<boolean>();
});

test('ReflectionPolicy.onReflectionStart is optional', () => {
  type Policy = ReflectionPolicy;
  expectTypeOf<Policy['onReflectionStart']>().toEqualTypeOf<
    ((scope: Scope, options: ReflectOptions) => Promise<void>) | undefined
  >();
});

test('ReflectionPolicy.onReflectionEnd is optional and accepts ReflectionResult | Error', () => {
  type Policy = ReflectionPolicy;
  expectTypeOf<Policy['onReflectionEnd']>().toEqualTypeOf<
    ((scope: Scope, result: ReflectionResult | Error) => Promise<void>) | undefined
  >();
});

test('ManualReflectionPolicy extends ReflectionPolicy with kind="manual"', () => {
  expectTypeOf<ManualReflectionPolicy>().toMatchTypeOf<ReflectionPolicy>();
  expectTypeOf<ManualReflectionPolicy['kind']>().toEqualTypeOf<'manual'>();
});

test('minimal stub implementing kind + shouldReflect compiles', () => {
  class MinimalStub implements ReflectionPolicy {
    readonly kind = 'manual' as const;
    async shouldReflect(_scope: Scope, _trigger: ReflectionTrigger): Promise<boolean> {
      return true;
    }
  }
  expectTypeOf<MinimalStub>().toMatchTypeOf<ReflectionPolicy>();
});

test('full stub implementing all 3 hooks compiles', () => {
  class FullStub implements ReflectionPolicy {
    readonly kind = 'threshold' as const;
    async shouldReflect(_scope: Scope, _trigger: ReflectionTrigger): Promise<boolean> {
      return true;
    }

    async onReflectionStart(_scope: Scope, _options: ReflectOptions): Promise<void> {}

    async onReflectionEnd(_scope: Scope, _result: ReflectionResult | Error): Promise<void> {}
  }
  expectTypeOf<FullStub>().toMatchTypeOf<ReflectionPolicy>();
});

test('ManualReflectionPolicy stub compiles with kind:"manual" + shouldReflect', () => {
  class ManualStub implements ManualReflectionPolicy {
    readonly kind = 'manual' as const;

    async shouldReflect(_scope: Scope, _trigger: ReflectionTrigger): Promise<boolean> {
      return true;
    }
  }
  expectTypeOf<ManualStub>().toMatchTypeOf<ManualReflectionPolicy>();
});
