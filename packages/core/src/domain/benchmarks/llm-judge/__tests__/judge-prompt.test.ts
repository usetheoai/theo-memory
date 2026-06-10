/**
 * T1.2 RED tests for judge prompt rendering.
 *
 * @see plan v1.2 § T1.2 + ADR D3
 */
import { describe, expect, it } from 'vitest';

import { ACCURACY_PROMPT, renderJudgePrompt } from '../judge-prompt.js';

describe('ACCURACY_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof ACCURACY_PROMPT).toBe('string');
    expect(ACCURACY_PROMPT.length).toBeGreaterThan(0);
  });

  it('requires JSON response shape (label + reasoning)', () => {
    expect(ACCURACY_PROMPT).toContain('label');
    expect(ACCURACY_PROMPT).toContain('reasoning');
  });

  it('uses calibrated framing (anti "be generous" bias)', () => {
    expect(ACCURACY_PROMPT.toLowerCase()).toContain('calibrated');
  });

  it('declares CORRECT and WRONG as the valid labels', () => {
    expect(ACCURACY_PROMPT).toContain('CORRECT');
    expect(ACCURACY_PROMPT).toContain('WRONG');
  });
});

describe('renderJudgePrompt', () => {
  it('returns a Message[] with system + user roles', () => {
    const messages = renderJudgePrompt(ACCURACY_PROMPT, {
      questionText: 'What color is the sky?',
      goldAnswer: 'blue',
      generated: 'sky is blue',
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('embeds the question, gold answer, and generated answer in the user message', () => {
    const messages = renderJudgePrompt(ACCURACY_PROMPT, {
      questionText: 'What color is the sky?',
      goldAnswer: 'blue',
      generated: 'sky is blue',
    });
    const userContent = messages[1]?.content ?? '';
    expect(userContent).toContain('What color is the sky?');
    expect(userContent).toContain('blue');
    expect(userContent).toContain('sky is blue');
  });
});
