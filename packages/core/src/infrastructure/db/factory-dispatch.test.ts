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
import { describe, expect, it, vi } from 'vitest';

import type * as PresetModule from './preset.js';

const resolvePreset = vi.hoisted(() => vi.fn(async () => ({ __preset: true })));
vi.mock('./preset.js', async (importActual) => {
  const actual = await importActual<typeof PresetModule>();
  return { ...actual, resolvePreset };
});

import { createMemory } from './factory.js';

describe('T2.1 — createMemory dispatch', () => {
  it('test_createMemory_dispatches_preset_shape_to_resolvePreset', async () => {
    const result = await createMemory({ postgres: 'postgres://x/db', migrate: false });
    expect(resolvePreset).toHaveBeenCalledOnce();
    expect(resolvePreset).toHaveBeenCalledWith({ postgres: 'postgres://x/db', migrate: false });
    expect(result).toEqual({ __preset: true });
  });
});
