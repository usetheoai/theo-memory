import { expectTypeOf, test } from 'vitest';

import type {
  HistoryBatchRecord,
  HistoryManager,
} from './dip/history-manager.js';
import type { HistoryEntry } from './history-entry.js';
import type { Message } from './message.js';

test('HistoryManager has 4 required + 3 optional methods (D8 lock)', () => {
  type Keys = keyof HistoryManager;
  expectTypeOf<Keys>().toEqualTypeOf<
    | 'addHistory'
    | 'getHistory'
    | 'reset'
    | 'close'
    | 'saveMessages'
    | 'getLastMessages'
    | 'batchAddHistory'
  >();
});

test('addHistory accepts the 7 locked parameters', () => {
  expectTypeOf<HistoryManager['addHistory']>().parameters.toEqualTypeOf<
    [
      string,
      string | null,
      string | null,
      'remember' | 'forget' | 'reflect' | 'supersede',
      Date?,
      Date?,
      boolean?,
    ]
  >();
  expectTypeOf<HistoryManager['addHistory']>().returns.resolves.toEqualTypeOf<void>();
});

test('getHistory returns Promise<readonly HistoryEntry[]>', () => {
  expectTypeOf<HistoryManager['getHistory']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<HistoryManager['getHistory']>().returns.resolves.toEqualTypeOf<readonly HistoryEntry[]>();
});

test('reset returns Promise<void>', () => {
  expectTypeOf<HistoryManager['reset']>().returns.resolves.toEqualTypeOf<void>();
});

test('close returns void (synchronous)', () => {
  expectTypeOf<HistoryManager['close']>().returns.toEqualTypeOf<void>();
});

test('HistoryBatchRecord.action is the string-union (D8 — not upstream string)', () => {
  expectTypeOf<HistoryBatchRecord['action']>().toEqualTypeOf<'remember' | 'forget' | 'reflect' | 'supersede'>();
});

test('HistoryBatchRecord shape mirrors addHistory but as record', () => {
  expectTypeOf<HistoryBatchRecord>().toMatchTypeOf<{
    readonly memoryId: string;
    readonly previousValue: string | null;
    readonly newValue: string | null;
    readonly action: 'remember' | 'forget' | 'reflect' | 'supersede';
  }>();
});

test('minimal stub implementing only the 4 required methods compiles', () => {
  class MinimalStub implements HistoryManager {
    async addHistory(
      _memoryId: string,
      _previousValue: string | null,
      _newValue: string | null,
      _action: 'remember' | 'forget' | 'reflect' | 'supersede',
      _createdAt?: Date,
      _updatedAt?: Date,
      _isDeleted?: boolean,
    ): Promise<void> {}

    async getHistory(_memoryId: string): Promise<readonly HistoryEntry[]> {
      return [];
    }

    async reset(): Promise<void> {}

    close(): void {}
  }
  expectTypeOf<MinimalStub>().toMatchTypeOf<HistoryManager>();
});

test('full stub implementing all 7 methods compiles', () => {
  class FullStub implements HistoryManager {
    async addHistory(
      _memoryId: string,
      _previousValue: string | null,
      _newValue: string | null,
      _action: 'remember' | 'forget' | 'reflect' | 'supersede',
      _createdAt?: Date,
      _updatedAt?: Date,
      _isDeleted?: boolean,
    ): Promise<void> {}

    async getHistory(_memoryId: string): Promise<readonly HistoryEntry[]> {
      return [];
    }

    async reset(): Promise<void> {}

    close(): void {}

    async saveMessages(_messages: readonly Message[], _sessionScope: string): Promise<void> {}

    async getLastMessages(
      _sessionScope: string,
      _limit?: number,
    ): Promise<readonly (Message & { readonly createdAt: Date })[]> {
      return [];
    }

    async batchAddHistory(_records: readonly HistoryBatchRecord[]): Promise<void> {}
  }
  expectTypeOf<FullStub>().toMatchTypeOf<HistoryManager>();
});

test('broken stub missing close() does NOT compile (required method invariant)', () => {
  // @ts-expect-error — missing close(): void
  class BrokenStub implements HistoryManager {
    async addHistory(
      _memoryId: string,
      _previousValue: string | null,
      _newValue: string | null,
      _action: 'remember' | 'forget' | 'reflect' | 'supersede',
      _createdAt?: Date,
      _updatedAt?: Date,
      _isDeleted?: boolean,
    ): Promise<void> {}

    async getHistory(_memoryId: string): Promise<readonly HistoryEntry[]> {
      return [];
    }

    async reset(): Promise<void> {}
  }
  expectTypeOf<BrokenStub>().not.toEqualTypeOf<never>();
});
