/**
 * T2.1 — createMemory dispatch (non-breaking preset overload).
 *
 * Asserts createMemory routes the preset shape ({ postgres }) to resolvePreset
 * and the full LocalMemoryConfig to createLocalMemory. resolvePreset is mocked
 * (partial mock keeps the real isPresetConfig discriminator) so the dispatch
 * decision is tested without a real DB.
 *
 * @see .claude/knowledge-base/plans/create-memory-preset-plan.md § T2.1
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalMemoryConfig } from './config.js';
import type * as PresetModule from './preset.js';

const resolvePreset = vi.hoisted(() => vi.fn(async () => ({ __preset: true })));
vi.mock('./preset.js', async (importActual) => {
  const actual = await importActual<typeof PresetModule>();
  return { ...actual, resolvePreset };
});

import { createMemory } from './factory.js';

describe('T2.1 — createMemory dispatch', () => {
  beforeEach(() => resolvePreset.mockClear());

  it('test_createMemory_dispatches_preset_shape_to_resolvePreset', async () => {
    const result = await createMemory({ postgres: 'postgres://x/db', migrate: false });
    expect(resolvePreset).toHaveBeenCalledOnce();
    expect(resolvePreset).toHaveBeenCalledWith({ postgres: 'postgres://x/db', migrate: false });
    expect(result).toEqual({ __preset: true });
  });

  it('test_createMemory_full_config_does_NOT_dispatch_to_resolvePreset', async () => {
    // The other discriminator branch: a full LocalMemoryConfig must route to
    // createLocalMemory, never resolvePreset. createLocalMemory rejects on empty
    // stub adapters; we only assert the routing decision, so we swallow that.
    const full = {
      embedder: {} as unknown,
      llm: {} as unknown,
      vectorStore: {} as unknown,
    } as unknown as LocalMemoryConfig;
    await createMemory(full).catch(() => undefined);
    expect(resolvePreset).not.toHaveBeenCalled();
  });
});
