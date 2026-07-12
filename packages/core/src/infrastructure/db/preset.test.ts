/**
 * Unit tests for the zero-config createMemory preset (create-memory-preset plan).
 *
 * T1.1 — CreateMemoryPresetConfig shape discriminator.
 * T1.2 — assemblePresetMemory (pool-owning assembly) + resolvePreset (env-set,
 *        migrate opt-out, fail-fast) with a mock pool + deterministic stub adapters.
 *
 * @see .claude/knowledge-base/plans/create-memory-preset-plan.md
 */
import { describe, expect, it } from 'vitest';

import type { LocalMemoryConfig } from './config.js';
import { isPresetConfig } from './preset.js';

describe('T1.1 — isPresetConfig discriminator', () => {
  it('test_isPresetConfig_true_for_postgres_shape', () => {
    expect(isPresetConfig({ postgres: 'postgres://localhost/db' })).toBe(true);
  });

  it('test_isPresetConfig_false_for_full_config', () => {
    const fullConfig = {
      embedder: {} as unknown,
      llm: {} as unknown,
      vectorStore: {} as unknown,
    } as unknown as LocalMemoryConfig;
    expect(isPresetConfig(fullConfig)).toBe(false);
  });
});
