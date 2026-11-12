/**
 * Contract between the importance scorer and the eviction policy (#239): a stored score never
 * pushes a triadic component or the derived half-life past its documented range.
 */
import { describe, expect, it } from 'vitest';

import type { LLM } from '../../../domain/dip/llm.js';
import { scoreAndCacheImportance } from '../../../domain/reflection/importance.js';

import { computeHalfLifeSeconds, computeImportance, DEFAULT_TRIADIC_CONSTANTS } from './triadic-scoring-policy.js';

const llmReplying = (content: string): LLM => ({
  generateResponse: () => Promise.resolve('unused'),
  generateChat: () => Promise.resolve({ content, role: 'assistant' }),
});

describe('importance from the scorer, as the triadic policy reads it', () => {
  it.each(['1', '4', '7', '10'])('rating %s gives an importance in [0, 1] and at most 3x the base half-life', async (reply) => {
    const cache = new Map<string, number>();
    const store = {
      getImportanceByHash: (h: string) => Promise.resolve(cache.get(h) ?? null),
      setImportanceByHash: (h: string, v: number) => { cache.set(h, v); return Promise.resolve(); },
    };
    const stored = await scoreAndCacheImportance('fact', 'h', store, llmReplying(reply));
    const importance = computeImportance(stored, DEFAULT_TRIADIC_CONSTANTS.importanceDefault);
    expect(importance).toBeGreaterThanOrEqual(0);
    expect(importance).toBeLessThanOrEqual(1);
    const base = DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds;
    expect(computeHalfLifeSeconds(importance, base)).toBeLessThanOrEqual(3 * base);
  });
});
