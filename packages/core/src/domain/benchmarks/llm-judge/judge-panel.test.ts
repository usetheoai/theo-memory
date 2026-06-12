/**
 * T1.2 RED tests for LlmJudgePanel.
 *
 * @see plan v1.2 § T1.2 + ADR D3 + EC-10
 */
import { describe, expect, it } from 'vitest';

import { CannedResponseLlm, FailingLlm } from './_test-llm.js';
import { LlmJudgePanel } from './judge-panel.js';


const SAMPLE_QUERY = {
  questionText: 'What color is the sky?',
  goldAnswer: 'blue',
  generated: 'The sky is blue.',
};

describe('LlmJudgePanel', () => {
  it('aggregates 2 agreeing judges into CORRECT', async () => {
    const panel = new LlmJudgePanel([
      { name: 'gpt-4o', llm: new CannedResponseLlm('{"label":"CORRECT","reasoning":"a"}') },
      {
        name: 'claude-3.5-sonnet',
        llm: new CannedResponseLlm('{"label":"CORRECT","reasoning":"b"}'),
      },
    ]);
    const result = await panel.judge(SAMPLE_QUERY);
    expect(result.aggregateLabel).toBe('CORRECT');
    expect(result.outcomes).toHaveLength(2);
    expect(result.agreement?.percentAgreement).toBeCloseTo(1.0);
  });

  it('aggregates 2 disagreeing judges and surfaces the split in agreement', async () => {
    const panel = new LlmJudgePanel([
      { name: 'gpt-4o', llm: new CannedResponseLlm('{"label":"CORRECT","reasoning":"a"}') },
      { name: 'claude-3.5-sonnet', llm: new CannedResponseLlm('{"label":"WRONG","reasoning":"b"}') },
    ]);
    const result = await panel.judge(SAMPLE_QUERY);
    expect(result.agreement?.percentAgreement).toBeCloseTo(0.5);
    expect(result.outcomes.filter((o) => o !== null)).toHaveLength(2);
  });

  it('persists per-judge raw responses', async () => {
    const rawA = '{"label":"CORRECT","reasoning":"a"}';
    const rawB = '{"label":"CORRECT","reasoning":"b"}';
    const panel = new LlmJudgePanel([
      { name: 'gpt-4o', llm: new CannedResponseLlm(rawA) },
      { name: 'claude-3.5-sonnet', llm: new CannedResponseLlm(rawB) },
    ]);
    const result = await panel.judge(SAMPLE_QUERY);
    expect(result.outcomes[0]?.rawResponse).toBe(rawA);
    expect(result.outcomes[1]?.rawResponse).toBe(rawB);
  });

  it('returns null aggregate when ALL judges fail', async () => {
    const panel = new LlmJudgePanel([
      { name: 'gpt-4o', llm: new FailingLlm() },
      { name: 'claude-3.5-sonnet', llm: new FailingLlm() },
    ]);
    const result = await panel.judge(SAMPLE_QUERY);
    expect(result.aggregateLabel).toBeNull();
    expect(result.outcomes).toEqual([null, null]);
  });

  it('aggregates correctly with 3 judges (2 CORRECT + 1 null)', async () => {
    const panel = new LlmJudgePanel([
      { name: 'gpt-4o', llm: new CannedResponseLlm('{"label":"CORRECT","reasoning":"a"}') },
      { name: 'claude-3.5-sonnet', llm: new CannedResponseLlm('{"label":"CORRECT","reasoning":"b"}') },
      { name: 'fail-llm', llm: new FailingLlm() },
    ]);
    const result = await panel.judge(SAMPLE_QUERY);
    expect(result.aggregateLabel).toBe('CORRECT');
    expect(result.agreement?.validJudgeCount).toBe(2);
  });
});
