/**
 * T5.1 — the LLM-measured tier is gated on an OpenRouter key. Without a key it
 * SKIPs honestly; it MUST NEVER fabricate a passing score. This unit-tests the
 * gating predicate deterministically (independent of ambient env).
 */
import { describe, expect, it } from 'vitest';

import { hasLlmKey, openrouterKey } from './llm-key.js';

describe('llm-measured tier gating', () => {
  it('test_llm_measured_tier_skips_without_key', () => {
    // No key in the env → the tier is skipped (hasLlmKey false).
    expect(hasLlmKey({})).toBe(false);
    expect(openrouterKey({})).toBe('');
    // Either OpenRouter env name enables it.
    expect(hasLlmKey({ OPENROUTER_KEY: 'sk-x' })).toBe(true);
    expect(hasLlmKey({ OPENROUTER_API_KEY: 'sk-y' })).toBe(true);
    // An empty string is not a key.
    expect(hasLlmKey({ OPENROUTER_KEY: '' })).toBe(false);
  });
});
