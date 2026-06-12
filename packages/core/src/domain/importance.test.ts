/**
 * T5.1 tests for scoreImportance per plan v0-4a-reflection-pipeline.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T5.1
 */
import { describe, expect, test } from 'vitest';

import type { LLM } from './dip/llm.js';
import { ImportanceScoringError } from './errors.js';
import type { LLMResponse, Message } from './message.js';
import { scoreImportance, IMPORTANCE_PROMPT_VERSION } from './reflection/importance.js';

function mockLLM(responseContent: string): LLM {
  return {
    async generateResponse() {
      return Promise.resolve('unused');
    },
    async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
      return Promise.resolve({ content: responseContent, role: 'assistant' });
    },
  };
}

describe('scoreImportance (T5.1)', () => {
  test('IMPORTANCE_PROMPT_VERSION is "1.0"', () => {
    expect(IMPORTANCE_PROMPT_VERSION).toBe('1.0');
  });

  test('returns 7 when LLM replies "7"', async () => {
    const score = await scoreImportance('Alice likes coffee', mockLLM('7'));
    expect(score).toBe(7);
  });

  test('parses "Importance: 7" → 7', async () => {
    const score = await scoreImportance('text', mockLLM('Importance: 7'));
    expect(score).toBe(7);
  });

  test('parses "approximately 8 out of 10" → 8', async () => {
    const score = await scoreImportance('text', mockLLM('approximately 8 out of 10'));
    expect(score).toBe(8);
  });

  test('parses decimal "7.5" → 7.5', async () => {
    const score = await scoreImportance('text', mockLLM('7.5'));
    expect(score).toBe(7.5);
  });

  test('clamps value > 10 → 10', async () => {
    const score = await scoreImportance('text', mockLLM('99'));
    expect(score).toBe(10);
  });

  test('clamps value < 1 → 1', async () => {
    const score = await scoreImportance('text', mockLLM('0'));
    expect(score).toBe(1);
  });

  test('throws ImportanceScoringError on "not a number"', async () => {
    await expect(scoreImportance('text', mockLLM('not a number'))).rejects.toThrow(
      ImportanceScoringError,
    );
  });

  test('error exposes rawResponse', async () => {
    try {
      await scoreImportance('text', mockLLM('abc xyz'));
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ImportanceScoringError);
      expect((err as ImportanceScoringError).rawResponse).toBe('abc xyz');
    }
  });

  test('handles whitespace-padded response', async () => {
    const score = await scoreImportance('text', mockLLM('   6   \n'));
    expect(score).toBe(6);
  });
});
