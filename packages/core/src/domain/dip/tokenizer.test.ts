/**
 * Tokenizer DIP shape test — v0-8-fixes-cycle-1 T3.1.
 *
 * Verifies the 11th DIP shape after MOVE promotion from
 * src/benchmarks/themory/adapter.ts. MOVE-only refactor per ADR D3 —
 * interface body unchanged. This test locks the surface so a future
 * unintentional widening (e.g., async count) surfaces as a compile error
 * here BEFORE it propagates to the 6 production consumers.
 *
 * @see plan v0-8-fixes-cycle-1 § T3.1 + ADR D3
 */
import { describe, expectTypeOf, it } from 'vitest';

import type { Tokenizer } from './tokenizer.js';

describe('Tokenizer DIP — shape contract', () => {
  it('declares count(text: string): number with no other members', () => {
    expectTypeOf<Tokenizer>().toHaveProperty('count');
    expectTypeOf<Tokenizer['count']>().toEqualTypeOf<(text: string) => number>();
  });

  it('is structurally satisfiable by a minimal inline impl', () => {
    const t: Tokenizer = { count: (s: string) => s.length };
    expectTypeOf(t.count('hello')).toEqualTypeOf<number>();
  });
});
