/**
 * T0.1 RED test-d for BenchmarkAdapter DIP per plan v0-8-independent-benchmark-reproduction.
 *
 * Type-level conformance: any class implementing BenchmarkAdapter MUST have the
 * `name` field + `add()` + `search()` methods with the documented signatures.
 * Method count: 2 required (add, search) + 1 readonly field (name).
 *
 * BenchmarkAdapter is the 10th DIP per plan v1.2 ADR D5 (Protocol locus in
 * src/core/dip/) + D6 (NOT inheriting MemoryStore — ISP+SRP).
 *
 * EC-5 coverage: BenchmarkCorpusItem.speaker is OPTIONAL (preserves multi-speaker
 * boundary per LongMemEval/LoCoMo fixture schemas); BenchmarkQuery.expectedSpeakers
 * is OPTIONAL (single-speaker fixtures like DMR-derived MSC subset may omit).
 *
 */
import { expectTypeOf, test } from 'vitest';

import type {
  AddMetrics,
  BenchmarkAdapter,
  BenchmarkCorpus,
  BenchmarkCorpusItem,
  BenchmarkQuery,
  SearchResult,
} from './dip/benchmark-adapter.js';

test('BenchmarkCorpusItem.id is a string', () => {
  expectTypeOf<BenchmarkCorpusItem['id']>().toEqualTypeOf<string>();
});

test('BenchmarkCorpusItem.text is a string', () => {
  expectTypeOf<BenchmarkCorpusItem['text']>().toEqualTypeOf<string>();
});

test('BenchmarkCorpusItem.timestamp is a Date', () => {
  expectTypeOf<BenchmarkCorpusItem['timestamp']>().toEqualTypeOf<Date>();
});

test('BenchmarkCorpusItem.speaker is OPTIONAL string (EC-5)', () => {
  expectTypeOf<BenchmarkCorpusItem['speaker']>().toEqualTypeOf<string | undefined>();
});

test('BenchmarkCorpusItem.metadata is Readonly Record', () => {
  expectTypeOf<BenchmarkCorpusItem['metadata']>().toEqualTypeOf<
    Readonly<Record<string, unknown>>
  >();
});

test('BenchmarkCorpus.conversationId is a string', () => {
  expectTypeOf<BenchmarkCorpus['conversationId']>().toEqualTypeOf<string>();
});

test('BenchmarkCorpus.items is readonly array of items', () => {
  expectTypeOf<BenchmarkCorpus['items']>().toEqualTypeOf<readonly BenchmarkCorpusItem[]>();
});

test('BenchmarkQuery.questionId is a string', () => {
  expectTypeOf<BenchmarkQuery['questionId']>().toEqualTypeOf<string>();
});

test('BenchmarkQuery.questionText is a string', () => {
  expectTypeOf<BenchmarkQuery['questionText']>().toEqualTypeOf<string>();
});

test('BenchmarkQuery.conversationId is a string', () => {
  expectTypeOf<BenchmarkQuery['conversationId']>().toEqualTypeOf<string>();
});

test('BenchmarkQuery.goldAnswer is a string', () => {
  expectTypeOf<BenchmarkQuery['goldAnswer']>().toEqualTypeOf<string>();
});

test('BenchmarkQuery.category is a string', () => {
  expectTypeOf<BenchmarkQuery['category']>().toEqualTypeOf<string>();
});

test('BenchmarkQuery.expectedSpeakers is OPTIONAL readonly string[] (EC-5)', () => {
  expectTypeOf<BenchmarkQuery['expectedSpeakers']>().toEqualTypeOf<
    readonly string[] | undefined
  >();
});

test('AddMetrics.itemCount is a number', () => {
  expectTypeOf<AddMetrics['itemCount']>().toEqualTypeOf<number>();
});

test('AddMetrics.latencyMs is a number', () => {
  expectTypeOf<AddMetrics['latencyMs']>().toEqualTypeOf<number>();
});

test('SearchResult.answer is a string', () => {
  expectTypeOf<SearchResult['answer']>().toEqualTypeOf<string>();
});

test('SearchResult.retrievedContext is readonly string array', () => {
  expectTypeOf<SearchResult['retrievedContext']>().toEqualTypeOf<readonly string[]>();
});

test('SearchResult.latencyMs is a number', () => {
  expectTypeOf<SearchResult['latencyMs']>().toEqualTypeOf<number>();
});

test('SearchResult.tokensUsed has prompt + completion numeric fields', () => {
  expectTypeOf<SearchResult['tokensUsed']>().toEqualTypeOf<{
    readonly prompt: number;
    readonly completion: number;
  }>();
});

test('SearchResult.modelUsed is a required string (Drift-T5.1-1)', () => {
  expectTypeOf<SearchResult['modelUsed']>().toEqualTypeOf<string>();
});

test('BenchmarkAdapter.name is a required string', () => {
  expectTypeOf<BenchmarkAdapter['name']>().toEqualTypeOf<string>();
});

test('BenchmarkAdapter.add accepts BenchmarkCorpus returns Promise<AddMetrics>', () => {
  expectTypeOf<BenchmarkAdapter['add']>().parameters.toEqualTypeOf<[BenchmarkCorpus]>();
  expectTypeOf<BenchmarkAdapter['add']>().returns.toEqualTypeOf<Promise<AddMetrics>>();
});

test('BenchmarkAdapter.search accepts BenchmarkQuery returns Promise<SearchResult>', () => {
  expectTypeOf<BenchmarkAdapter['search']>().parameters.toEqualTypeOf<[BenchmarkQuery]>();
  expectTypeOf<BenchmarkAdapter['search']>().returns.toEqualTypeOf<Promise<SearchResult>>();
});

test('minimal stub implementing BenchmarkAdapter compiles', () => {
  class MinimalStub implements BenchmarkAdapter {
    readonly name = 'stub';
    async add(_corpus: BenchmarkCorpus): Promise<AddMetrics> {
      return Promise.resolve({ itemCount: 0, latencyMs: 0 });
    }
    async search(_query: BenchmarkQuery): Promise<SearchResult> {
      return Promise.resolve({
        answer: '',
        retrievedContext: [],
        latencyMs: 0,
        tokensUsed: { prompt: 0, completion: 0 },
        modelUsed: 'stub',
      });
    }
  }
  expectTypeOf<MinimalStub>().toMatchTypeOf<BenchmarkAdapter>();
});
