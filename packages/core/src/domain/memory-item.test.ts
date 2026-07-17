/**
 * RED-phase contract tests for src/core/memory-item.ts — T1.1 of
 * v1-1-multi-peer-and-bi-temporal-plan.md v1.2.
 *
 * Widens the public `MemoryItem` DTO with `attributedTo?: string` so the
 * pgvector-store SELECT projection (T2.1) and the recall filter API (T2.2)
 * surface multi-peer attribution as a first-class structural field.
 *
 */
import { expectTypeOf, test } from 'vitest';

import type { MemoryItem } from './memory-item.js';

test('MemoryItem.attributedTo is an optional string (N-valent per blueprint R1 + Q5)', () => {
  expectTypeOf<MemoryItem>().toHaveProperty('attributedTo');
  expectTypeOf<MemoryItem['attributedTo']>().toEqualTypeOf<string | undefined>();
});
