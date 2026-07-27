/**
 * M27 T1.1 — durable-fact discipline in the extraction SYSTEM_PROMPT.
 *
 * Root cause (blueprint memory-write-quality-mem0-parity): the extraction prompt had
 * no fact-quality contract, so the LLM stored questions ("Quer que eu prossiga…?"),
 * first-person voice ("Minha recomendação:") and 400-word narration dumps as facts.
 * These tests lock the mem0-grade discipline: atomic + declarative + third-person +
 * a few-shot mapping a question → empty `memory`. The language block MUST survive.
 */
import { describe, expect, test } from 'vitest';

import { generateAdditiveExtractionPrompt } from './prompt.js';

function composed(): string {
  return generateAdditiveExtractionPrompt(
    [],
    [{ role: 'assistant', content: 'turn' }],
  ).prompt;
}

describe('extraction prompt — durable-fact discipline (M27)', () => {
  test('declares the durable-fact contract (atomic, declarative, third person)', () => {
    const p = composed().toLowerCase();
    expect(p).toContain('atomic');
    expect(p).toContain('declarative');
    expect(p).toContain('third person');
  });

  test('has a few-shot mapping a question to an empty memory list', () => {
    // A durable fact is never a question — mem0's discipline yields [] for interrogatives.
    const p = composed();
    // The prompt must SHOW the model that a question produces no fact.
    expect(p).toMatch(/\?[\s\S]{0,120}"memory"\s*:\s*\[\s*\]/);
  });

  test('instructs SPLIT of multi-fact input into atomic facts', () => {
    expect(composed().toLowerCase()).toContain('split');
  });

  test('preserves the language/accent directive (regression guard)', () => {
    // The existing per-input-language + accent block must not be dropped by the new few-shot.
    expect(composed()).toContain('NEVER translate or transliterate');
  });
});
