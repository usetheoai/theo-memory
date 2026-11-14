/**
 * M27 T2.3 — extraction response normalization (normalize-facts parity).
 */
import { describe, expect, test } from 'vitest';

import { coerceExtractionResponse } from './normalize.js';
import { AdditiveExtractionSchema } from './prompt.js';

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

  test('moves a misplaced durability enum from evidence.kind without losing the memory', () => {
    const out = coerceExtractionResponse({
      memory: [{
        id: '1',
        text: 'user might try a new project',
        evidence: { kind: 'tentative', sourceQuote: 'Maybe I will try it.' },
      }],
    }) as { memory: { evidence?: { kind?: string; durability?: string } }[] };
    expect(out.memory[0]?.evidence).toEqual({
      kind: 'inferred',
      durability: 'tentative',
      sourceQuote: 'Maybe I will try it.',
    });
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

describe('coerceExtractionResponse with a malformed evidence (#277)', () => {
  const good = { id: '1', text: 'user lives in Graz', evidence: { kind: 'stated', durability: 'durable', sourceQuote: 'I live in Graz' } };

  test('moves a tense written in the durability field to the time field', () => {
    const invalid: string[] = [];
    const out = coerceExtractionResponse(
      { memory: [good, { id: '2', text: 'user flies to Lisbon on Friday', evidence: { kind: 'stated', durability: 'future', sourceQuote: 'I fly to Lisbon on Friday' } }] },
      (reason) => invalid.push(reason),
    );
    const parsed = AdditiveExtractionSchema.parse(out);
    expect(parsed.memory[1]?.evidence).toEqual({ kind: 'stated', durability: 'temporary', time: 'future', sourceQuote: 'I fly to Lisbon on Friday' });
    expect(parsed.memory[0]?.evidence).toEqual(good.evidence);
    expect(invalid).toEqual(['time_in_durability']);
  });

  test('keeps the fact and drops an evidence it cannot read, so the other facts still parse', () => {
    const invalid: string[] = [];
    const out = coerceExtractionResponse(
      { memory: [good, { id: '2', text: 'user likes tea', evidence: { kind: 'stated', durability: 'forever', sourceQuote: 'I like tea' } }, { id: '3', text: 'user has a cat', evidence: { kind: 'stated', durability: 'present' } }] },
      (reason) => invalid.push(reason),
    );
    const parsed = AdditiveExtractionSchema.parse(out);
    expect(parsed.memory.map((fact) => fact.text)).toEqual(['user lives in Graz', 'user likes tea', 'user has a cat']);
    expect(parsed.memory[1]?.evidence).toBeUndefined();
    expect(parsed.memory[2]?.evidence).toBeUndefined();
    expect(invalid).toEqual(['unreadable', 'unreadable']);
  });

  test('leaves a valid evidence untouched and reports nothing', () => {
    const invalid: string[] = [];
    const out = coerceExtractionResponse({ memory: [good] }, (reason) => invalid.push(reason));
    expect(AdditiveExtractionSchema.parse(out).memory[0]?.evidence).toEqual(good.evidence);
    expect(invalid).toEqual([]);
  });
});
