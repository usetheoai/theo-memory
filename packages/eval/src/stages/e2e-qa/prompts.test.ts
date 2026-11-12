import { describe, expect, test } from 'vitest';

import { buildLongMemEvalAnswerPrompt, buildLongMemEvalJudgePrompt } from './prompts.js';

describe('official LongMemEval prompt mode', () => {
  test('uses the published answer template and current date', () => {
    const prompt = buildLongMemEvalAnswerPrompt({
      question: 'When did I move?',
      questionDate: '2024-03-01',
      memories: 'user moved on 2024-02-01',
    });
    expect(prompt).toContain('Answer the question step by step: first extract all the relevant information');
    expect(prompt).toContain('History Chats:\nuser moved on 2024-02-01');
    expect(prompt).toContain('Current Date: 2024-03-01');
  });

  test('uses category-specific official judge rules, including abstention', () => {
    const temporal = buildLongMemEvalJudgePrompt({
      questionType: 'temporal-reasoning', question: 'How many days?', answer: '14', response: '13', abstention: false,
    });
    expect(temporal).toContain('do not penalize off-by-one errors for the number of days');
    const abstention = buildLongMemEvalJudgePrompt({
      questionType: 'multi-session', question: 'Unknown?', answer: 'Not enough information', response: 'I do not know', abstention: true,
    });
    expect(abstention).toContain('unanswerable question');
    expect(abstention).toContain('Explanation: Not enough information');
  });
});
