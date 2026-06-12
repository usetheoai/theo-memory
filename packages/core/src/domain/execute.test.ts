/**
 * T4.1 RED tests for executeReflection per plan v0-4a-reflection-pipeline.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T4.1
 */
import { describe, expect, test, vi } from 'vitest';

import type { LLM } from './dip/llm.js';
import { ReflectionLLMResponseError } from './errors.js';
import type { MemoryItem } from './memory-item.js';
import type { LLMResponse, Message } from './message.js';
import { executeReflection } from './reflection/execute.js';
import type { Scope } from './scope.js';

function makeMockLLM(responseContent: string): { llm: LLM; chatCalls: { messages: readonly Message[] }[] } {
  const chatCalls: { messages: readonly Message[] }[] = [];
  const llm: LLM = {
    generateResponse: async () => 'not used',
    generateChat: async (messages: readonly Message[]): Promise<LLMResponse> => {
      chatCalls.push({ messages });
      return Promise.resolve({ content: responseContent, role: 'assistant' });
    },
  };
  return { llm, chatCalls };
}

function mockMemory(id: string, text: string, scope: Scope): MemoryItem {
  return {
    id,
    text,
    hash: 'mock-hash',
    scope,
    metadata: {},
    tValid: new Date('2026-05-26'),
    tInvalid: null,
    createdAt: new Date('2026-05-26'),
    updatedAt: new Date('2026-05-26'),
  };
}

describe('executeReflection (T4.1)', () => {
  const SCOPE: Scope = { kind: 'user', userId: 'alice' };

  test('happy path: parses LLM JSON response into DerivedMemoryDraft[]', async () => {
    const llmResponse = JSON.stringify([
      { text: 'Alice prefers morning routines', derived_from: ['m1', 'm2'] },
    ]);
    const { llm } = makeMockLLM(llmResponse);
    const sources = [mockMemory('m1', 'Alice runs', SCOPE), mockMemory('m2', 'Alice meditates', SCOPE)];
    const result = await executeReflection({ llm, sourceMemories: sources, scope: SCOPE });
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Alice prefers morning routines');
    expect(result[0]?.derivedFrom).toEqual(['m1', 'm2']);
  });

  test('EC-5: empty source memories short-circuits without LLM call', async () => {
    const { llm, chatCalls } = makeMockLLM('[]');
    const spy = vi.spyOn(llm, 'generateChat');
    const result = await executeReflection({ llm, sourceMemories: [], scope: SCOPE });
    expect(result).toEqual([]);
    expect(chatCalls).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  test('EC-13: LLM returns valid empty array is success (no error thrown)', async () => {
    const { llm } = makeMockLLM('[]');
    const sources = [mockMemory('m1', 'Alice runs', SCOPE)];
    const result = await executeReflection({ llm, sourceMemories: sources, scope: SCOPE });
    expect(result).toEqual([]);
  });

  test('malformed JSON throws ReflectionLLMResponseError', async () => {
    const { llm } = makeMockLLM('not json at all');
    const sources = [mockMemory('m1', 'Alice runs', SCOPE)];
    await expect(
      executeReflection({ llm, sourceMemories: sources, scope: SCOPE }),
    ).rejects.toThrow(ReflectionLLMResponseError);
  });

  test('non-array JSON throws ReflectionLLMResponseError', async () => {
    const { llm } = makeMockLLM(JSON.stringify({ not: 'an array' }));
    const sources = [mockMemory('m1', 'Alice runs', SCOPE)];
    await expect(
      executeReflection({ llm, sourceMemories: sources, scope: SCOPE }),
    ).rejects.toThrow(/not a JSON array/);
  });

  test('missing text field throws ReflectionLLMResponseError', async () => {
    const { llm } = makeMockLLM(JSON.stringify([{ derived_from: ['m1'] }]));
    const sources = [mockMemory('m1', 'Alice runs', SCOPE)];
    await expect(
      executeReflection({ llm, sourceMemories: sources, scope: SCOPE }),
    ).rejects.toThrow(/text is not a string/);
  });

  test('missing derived_from field throws ReflectionLLMResponseError', async () => {
    const { llm } = makeMockLLM(JSON.stringify([{ text: 'a' }]));
    const sources = [mockMemory('m1', 'Alice runs', SCOPE)];
    await expect(
      executeReflection({ llm, sourceMemories: sources, scope: SCOPE }),
    ).rejects.toThrow(/derived_from is not an array/);
  });

  test('rawResponse field on error preserves the LLM output for debugging', async () => {
    const badResponse = 'definitely not json';
    const { llm } = makeMockLLM(badResponse);
    const sources = [mockMemory('m1', 'Alice runs', SCOPE)];
    try {
      await executeReflection({ llm, sourceMemories: sources, scope: SCOPE });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReflectionLLMResponseError);
      expect((err as ReflectionLLMResponseError).rawResponse).toBe(badResponse);
    }
  });
});
