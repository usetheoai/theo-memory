/**
 * Type-level shape assertion for T1.1 — the EntityExtractor DIP contract.
 *
 * Asserts the interface is a single sync method `extract(text) => ReadonlyArray<{type;name}>`
 * and that EntityType is the closed 4-literal union. RED before the interface exists
 * (tsc cannot resolve the import); GREEN once `entity-extractor.ts` ships.
 *
 */
import { describe, test, expectTypeOf } from 'vitest';

import type { EntityExtractor, EntityType, ExtractedEntity } from './entity-extractor.js';

describe('EntityExtractor — type-level shape (T1.1)', () => {
  test('exposes exactly one method: extract', () => {
    expectTypeOf<keyof EntityExtractor>().toEqualTypeOf<'extract'>();
  });

  test('extract is sync and returns readonly ExtractedEntity[]', () => {
    expectTypeOf<EntityExtractor['extract']>().parameters.toEqualTypeOf<[text: string]>();
    expectTypeOf<EntityExtractor['extract']>().returns.toEqualTypeOf<readonly ExtractedEntity[]>();
  });

  test('ExtractedEntity is { type: EntityType; name: string }', () => {
    const e: ExtractedEntity = { type: 'PROPER', name: 'John Smith' };
    expectTypeOf(e.type).toEqualTypeOf<EntityType>();
    expectTypeOf(e.name).toEqualTypeOf<string>();
  });

  test('EntityType is the closed 4-literal union', () => {
    expectTypeOf<EntityType>().toEqualTypeOf<'PROPER' | 'QUOTED' | 'COMPOUND' | 'NOUN'>();
  });

  test('a stub satisfies the interface and an empty extraction is valid', () => {
    const stub: EntityExtractor = { extract: () => [] };
    const out = stub.extract('x');
    expectTypeOf(out).toEqualTypeOf<readonly ExtractedEntity[]>();
  });
});
