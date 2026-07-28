/**
 * M27 T2.3 — extraction response normalization (normalize-facts parity).
 */
import { describe, expect, test } from 'vitest';

import { coerceExtractionResponse } from './normalize.js';

describe('coerceExtractionResponse (M27 T2.3)', () => {
  test('coerces a fact returned under `fact` into `text`', () => {
    const out = coerceExtractionResponse({ memory: [{ id: '1', fact: 'user uses pnpm' }] }) as {
      memory: { text?: string }[];
    };
    expect(out.memory[0]?.text).toBe('user uses pnpm');
  });

  test('synthesizes a sequential id when the LLM omits it', () => {
    const out = coerceExtractionResponse({ memory: [{ fact: 'x' }, { fact: 'y' }] }) as {
      memory: { id?: string }[];
    };
    expect(out.memory[0]?.id).toBe('1');
    expect(out.memory[1]?.id).toBe('2');
  });

  test('normalizes numeric linked_memory_ids to strings (existing behavior preserved)', () => {
    const out = coerceExtractionResponse({
      memory: [{ id: '1', text: 'a', linked_memory_ids: [1, 2] }],
    }) as { memory: { linked_memory_ids?: unknown[] }[] };
    expect(out.memory[0]?.linked_memory_ids).toEqual(['1', '2']);
  });

  test('parses a JSON string input', () => {
    const out = coerceExtractionResponse('{"memory":[{"id":"1","text":"a"}]}') as {
      memory: { text?: string }[];
    };
    expect(out.memory[0]?.text).toBe('a');
  });

  test('leaves a well-formed item untouched', () => {
    const input = { memory: [{ id: '1', text: 'clean fact' }] };
    const out = coerceExtractionResponse(input) as { memory: { text?: string }[] };
    expect(out.memory[0]?.text).toBe('clean fact');
  });
});
