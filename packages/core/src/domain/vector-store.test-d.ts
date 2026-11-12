import { expectTypeOf, test } from 'vitest';

import type { InsertOutcome, VectorStore, VectorStoreResult } from './dip/vector-store.js';
import type { Filters } from './scope.js';

test('VectorStore has required persistence, scoped-retirement, and retrieval methods', () => {
  type Keys = keyof VectorStore;
  expectTypeOf<Keys>().toEqualTypeOf<
    | 'recordAccess'
    | 'supersede'
    | 'setImportance'
    | 'findWriteReplay'
    | 'initialize'
    | 'insert'
    | 'search'
    | 'keywordSearch'
    | 'get'
    | 'update'
    | 'delete'
    | 'deleteInScope'
    | 'deleteCol'
    | 'list'
    | 'listEpisodes'
    | 'getUserId'
    | 'setUserId'
  >();
});

test('VectorStoreResult shape: id + payload + optional score + optional similarity + optional createdAt (T1.1) + optional category (themory-category-filter T3.1)', () => {
  // T1.1 of dashboard-memories added optional createdAt?: Date.
  // T3.1 of themory-category-filter-server-side added optional category?: string
  // (additive per ADR D2 + EC-12 dual-pathway).
  expectTypeOf<VectorStoreResult>().toEqualTypeOf<{
    readonly id: string;
    readonly payload: Readonly<Record<string, string | number | boolean | null>>;
    readonly score?: number;
    readonly similarity?: number;
    readonly createdAt?: Date;
    readonly category?: string;
  }>();
});

test('initialize() returns Promise<void>', () => {
  expectTypeOf<VectorStore['initialize']>().parameters.toEqualTypeOf<[]>();
  expectTypeOf<VectorStore['initialize']>().returns.resolves.toEqualTypeOf<void>();
});

test('insert(vectors, ids, payloads) returns Promise<readonly InsertOutcome[]> per principles-alignment-hardening T2.1', () => {
  expectTypeOf<VectorStore['insert']>().parameters.toEqualTypeOf<
    [
      readonly (readonly number[])[],
      readonly string[],
      readonly Record<string, string | number | boolean | null>[],
    ]
  >();
  expectTypeOf<VectorStore['insert']>().returns.resolves.toEqualTypeOf<readonly InsertOutcome[]>();
});

test('search(query, topK?, filters?) returns Promise<readonly VectorStoreResult[]>', () => {
  expectTypeOf<VectorStore['search']>().parameters.toEqualTypeOf<
    [readonly number[], number?, Filters?]
  >();
  expectTypeOf<VectorStore['search']>().returns.resolves.toEqualTypeOf<readonly VectorStoreResult[]>();
});

test('keywordSearch is REQUIRED (no optional ?) with nullable return for opt-out', () => {
  // The method MUST be present in the type. An adapter that can't do BM25
  // returns null at runtime — but the method itself is required. The optional
  // query vector lets the adapter report each row's cosine similarity.
  expectTypeOf<VectorStore['keywordSearch']>().parameters.toEqualTypeOf<
    [string, number?, Filters?, (readonly number[])?]
  >();
  expectTypeOf<VectorStore['keywordSearch']>().returns.resolves.toEqualTypeOf<
    readonly VectorStoreResult[] | null
  >();
});

test('recordAccess is optional and takes the ids recall returned', () => {
  expectTypeOf<NonNullable<VectorStore['recordAccess']>>().parameters.toEqualTypeOf<[readonly string[]]>();
  expectTypeOf<NonNullable<VectorStore['recordAccess']>>().returns.resolves.toEqualTypeOf<void>();
});

test('get(vectorId) returns Promise<VectorStoreResult | null>', () => {
  expectTypeOf<VectorStore['get']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<VectorStore['get']>().returns.resolves.toEqualTypeOf<VectorStoreResult | null>();
});

test('update(vectorId, vector, payload) returns Promise<void>', () => {
  expectTypeOf<VectorStore['update']>().parameters.toEqualTypeOf<
    [
      string,
      readonly number[],
      Record<string, string | number | boolean | null>,
    ]
  >();
  expectTypeOf<VectorStore['update']>().returns.resolves.toEqualTypeOf<void>();
});

test('delete(vectorId) and deleteCol() return Promise<void>', () => {
  expectTypeOf<VectorStore['delete']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<VectorStore['delete']>().returns.resolves.toEqualTypeOf<void>();
  expectTypeOf<VectorStore['deleteCol']>().parameters.toEqualTypeOf<[]>();
  expectTypeOf<VectorStore['deleteCol']>().returns.resolves.toEqualTypeOf<void>();
});

test('list(filters?, topK?, includeSoftDeleted?, offset?) returns Promise<readonly [results, totalCount]>', () => {
  expectTypeOf<VectorStore['list']>().parameters.toEqualTypeOf<[Filters?, number?, boolean?, number?]>();
  expectTypeOf<VectorStore['list']>().returns.resolves.toEqualTypeOf<
    readonly [readonly VectorStoreResult[], number]
  >();
});

test('getUserId() / setUserId() are session-metadata NOT tenant-isolation (EC-6 at type-level)', () => {
  expectTypeOf<VectorStore['getUserId']>().parameters.toEqualTypeOf<[]>();
  expectTypeOf<VectorStore['getUserId']>().returns.resolves.toEqualTypeOf<string>();
  expectTypeOf<VectorStore['setUserId']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<VectorStore['setUserId']>().returns.resolves.toEqualTypeOf<void>();
});

test('synthetic stub class implementing all required methods compiles', () => {
  class StubVectorStore implements VectorStore {
    async initialize(): Promise<void> {}

    async insert(
      _vectors: readonly (readonly number[])[],
      ids: readonly string[],
      _payloads: readonly Record<string, string | number | boolean | null>[],
    ): Promise<readonly InsertOutcome[]> {
      return ids.map((id) => ({ id, confirmationCount: 1, rejectedAsDuplicate: false }));
    }

    async search(
      _query: readonly number[],
      _topK?: number,
      _filters?: Filters,
    ): Promise<readonly VectorStoreResult[]> {
      return [];
    }

    async keywordSearch(
      _query: string,
      _topK?: number,
      _filters?: Filters,
    ): Promise<readonly VectorStoreResult[] | null> {
      return null;
    }

    async get(_vectorId: string): Promise<VectorStoreResult | null> {
      return null;
    }

    async update(
      _vectorId: string,
      _vector: readonly number[],
      _payload: Record<string, string | number | boolean | null>,
    ): Promise<void> {}

    async delete(_vectorId: string): Promise<void> {}

    async deleteInScope(): Promise<boolean> {
      return false;
    }
    async deleteCol(): Promise<void> {}

    async list(
      _filters?: Filters,
      _topK?: number,
    ): Promise<readonly [readonly VectorStoreResult[], number]> {
      return [[], 0];
    }

    async listEpisodes(): Promise<readonly VectorStoreResult[]> {
      return [];
    }

    async getUserId(): Promise<string> {
      return '';
    }

    async setUserId(_userId: string): Promise<void> {}
  }
  expectTypeOf<StubVectorStore>().toMatchTypeOf<VectorStore>();
});
