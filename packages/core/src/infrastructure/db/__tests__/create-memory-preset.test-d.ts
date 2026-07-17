/**
 * Compile-time (type-level) tests for the createMemory non-breaking preset
 * overload — the D1 guard + discriminator-collision tripwire the plan promised
 * (create-memory-preset T2.1 + Drawbacks row 3). Restores the compile-time
 * non-breaking guarantee that the runtime factory-dispatch.test.ts cannot prove.
 *
 */
import { describe, expectTypeOf, it } from 'vitest';

import type { LocalMemoryConfig } from '../config.js';
import { createMemory } from '../factory.js';
import type { DisposableMemory } from '../local-memory.js';
import type { CreateMemoryPresetConfig } from '../preset.js';

describe('createMemory non-breaking overload (create-memory-preset D1)', () => {
  it('accepts the zero-config preset shape', () => {
    expectTypeOf(createMemory).toBeCallableWith({ postgres: 'postgres://x', openai: 'sk-x' });
    expectTypeOf(createMemory).toBeCallableWith({ postgres: 'postgres://x' });
    expectTypeOf(createMemory).toBeCallableWith({ postgres: 'postgres://x', migrate: false });
  });

  it('still accepts the full LocalMemoryConfig (non-breaking — the OLD path)', () => {
    const full = {
      embedder: {} as unknown,
      llm: {} as unknown,
      vectorStore: {} as unknown,
    } as unknown as LocalMemoryConfig;
    expectTypeOf(createMemory).toBeCallableWith(full);
  });

  it('returns Promise<DisposableMemory> for the overload', () => {
    expectTypeOf(createMemory).returns.resolves.toEqualTypeOf<DisposableMemory>();
  });

  it('discriminator tripwire: LocalMemoryConfig must NOT gain a `postgres` field', () => {
    // If LocalMemoryConfig ever gains `postgres`, isPresetConfig would misroute
    // full-config callers into the preset branch — this compile-time assertion
    // fails first, before any runtime test (create-memory-preset Drawbacks row 3).
    expectTypeOf<LocalMemoryConfig>().not.toHaveProperty('postgres');
    expectTypeOf<CreateMemoryPresetConfig>().toHaveProperty('postgres');
  });
});
