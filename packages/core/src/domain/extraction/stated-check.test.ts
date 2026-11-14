import { describe, expect, it, vi } from 'vitest';

import type { LLM } from '../dip/llm.js';
import type { Message } from '../message.js';

import { recoverStatedFacts, STATED_CHECK_PROMPT } from './stated-check.js';

const question: Message = { role: 'user', content: 'As someone who lives in Velmora, which bank should I pick?' };

function llmReturning(response: unknown): LLM {
  return { generateResponse: vi.fn(async () => response), generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })) };
}

describe('recoverStatedFacts', () => {
  it('returns the fact a question states, as a stated and lasting fact with its quote', async () => {
    const llm = llmReturning({ facts: [{ about: 'lives in Velmora', quote: 'lives in Velmora', lasting: true }] });
    expect(await recoverStatedFacts(llm, [question], undefined)).toEqual([
      { id: '1', text: 'user lives in Velmora', evidence: { kind: 'stated', durability: 'durable', sourceQuote: 'lives in Velmora' } },
    ]);
    const sent = vi.mocked(llm.generateResponse).mock.calls[0]?.[0];
    expect(sent?.[0]?.content).toBe(STATED_CHECK_PROMPT);
    expect(sent?.[1]?.content).toBe(question.content);
  });

  it('marks a passing state as temporary', async () => {
    const llm = llmReturning({ facts: [{ about: 'is tired', quote: 'lives in Velmora', lasting: false }] });
    expect((await recoverStatedFacts(llm, [question], undefined))[0]?.evidence.durability).toBe('temporary');
  });

  it('drops a fact whose quote is not in the message', async () => {
    const llm = llmReturning({ facts: [{ about: 'works at Kestrel Labs', quote: 'I work at Kestrel Labs' }] });
    expect(await recoverStatedFacts(llm, [question], undefined)).toEqual([]);
  });

  it('accepts a quote that differs in case and spacing, and a response sent as a string', async () => {
    const llm = llmReturning(JSON.stringify({ facts: [{ about: 'lives in Velmora', quote: 'LIVES  in velmora' }] }));
    expect(await recoverStatedFacts(llm, [question], undefined)).toHaveLength(1);
  });

  it('asks only about messages a user wrote', async () => {
    const llm = llmReturning({ facts: [] });
    await recoverStatedFacts(llm, [{ role: 'assistant', content: 'Shall I proceed?' }, question], undefined);
    expect(vi.mocked(llm.generateResponse)).toHaveBeenCalledTimes(1);
  });

  it('recovers nothing from a malformed response or a failed call, and does not throw', async () => {
    expect(await recoverStatedFacts(llmReturning({ memory: [] }), [question], undefined)).toEqual([]);
    const failing: LLM = { generateResponse: vi.fn(async () => { throw new Error('network'); }), generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })) };
    expect(await recoverStatedFacts(failing, [question], undefined)).toEqual([]);
  });
});
