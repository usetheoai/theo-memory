import { expectTypeOf, test } from 'vitest';

import type { MemoryItem, MemoryItemWithScore } from '../memory-item.js';
import type { Scope } from '../scope.js';

test('MemoryItem has the locked field shape', () => {
  expectTypeOf<MemoryItem>().toEqualTypeOf<{
    readonly id: string;
    readonly text: string;
    readonly hash: string;
    readonly scope: Scope;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
    readonly tValid: Date | null;
    readonly tInvalid: Date | null;
  }>();
});

test('MemoryItemWithScore extends MemoryItem with readonly score', () => {
  expectTypeOf<MemoryItemWithScore>().toMatchTypeOf<MemoryItem>();
  expectTypeOf<MemoryItemWithScore['score']>().toEqualTypeOf<number>();
});

test('MemoryItem.id is a string (UUID v4 at runtime)', () => {
  expectTypeOf<MemoryItem['id']>().toEqualTypeOf<string>();
});

test('MemoryItem.hash is a string (MD5 of normalized text — dedup key)', () => {
  expectTypeOf<MemoryItem['hash']>().toEqualTypeOf<string>();
});

test('MemoryItem.scope is the typed Scope discriminated union', () => {
  expectTypeOf<MemoryItem['scope']>().toEqualTypeOf<Scope>();
});

test('MemoryItem.createdAt + updatedAt are Date (parsed at adapter boundary)', () => {
  expectTypeOf<MemoryItem['createdAt']>().toEqualTypeOf<Date>();
  expectTypeOf<MemoryItem['updatedAt']>().toEqualTypeOf<Date>();
});

test('MemoryItem.metadata is a flat readonly primitive record', () => {
  expectTypeOf<MemoryItem['metadata']>().toEqualTypeOf<
    Readonly<Record<string, string | number | boolean | null>>
  >();
});

test('MemoryItem.metadata rejects nested objects at compile time', () => {
  // Direct primitive values: ALLOWED
  const primitiveOk: MemoryItem['metadata'] = {
    source: 'chat',
    score: 0.42,
    archived: false,
    nullable: null,
  };
  expectTypeOf(primitiveOk).toMatchTypeOf<MemoryItem['metadata']>();

  // Nested object literal: must NOT compile (EC-9 invariant)
  // @ts-expect-error — nested objects banned in v0.0 metadata
  const nestedReject: MemoryItem['metadata'] = { user: { age: 30 } };
  expectTypeOf(nestedReject).not.toEqualTypeOf<never>();
});

test('MemoryItem.tValid and tInvalid are Date | null (bi-temporal columns)', () => {
  expectTypeOf<MemoryItem['tValid']>().toEqualTypeOf<Date | null>();
  expectTypeOf<MemoryItem['tInvalid']>().toEqualTypeOf<Date | null>();
});

test('MemoryItemWithScore.score is in [0, 1] additive scoring range', () => {
  // Compile-time: just number. Runtime range is a recall-adapter invariant.
  expectTypeOf<MemoryItemWithScore['score']>().toEqualTypeOf<number>();
});
