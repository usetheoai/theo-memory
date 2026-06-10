import { expectTypeOf, test } from 'vitest';

import type { Embedder } from '../dip/embedder.js';

test('Embedder has exactly the 2 locked methods (D8)', () => {
  expectTypeOf<keyof Embedder>().toEqualTypeOf<'embed' | 'embedBatch'>();
});

test('embed(text: string) returns Promise<ReadonlyArray<number>>', () => {
  expectTypeOf<Embedder['embed']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<Embedder['embed']>().returns.resolves.toEqualTypeOf<readonly number[]>();
});

test('embedBatch(texts: ReadonlyArray<string>) returns Promise<ReadonlyArray<ReadonlyArray<number>>>', () => {
  expectTypeOf<Embedder['embedBatch']>()
    .parameters.toEqualTypeOf<[readonly string[]]>();
  expectTypeOf<Embedder['embedBatch']>()
    .returns.resolves.toEqualTypeOf<readonly (readonly number[])[]>();
});

test('a synthetic stub class structurally implements Embedder', () => {
  class StubEmbedder implements Embedder {
    async embed(_text: string): Promise<readonly number[]> {
      return [0];
    }

    async embedBatch(_texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      return [[0]];
    }
  }
  expectTypeOf<StubEmbedder>().toMatchTypeOf<Embedder>();
});
