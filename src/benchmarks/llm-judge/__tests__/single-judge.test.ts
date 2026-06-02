/**
 * T1.2 RED tests for SingleJudge.
 *
 * @see plan v1.2 § T1.2 + EC-1 + EC-2
 */
import { describe, expect, it } from 'vitest';

import { SingleJudge } from '../single-judge.js';

import { CannedResponseLlm, FailingLlm } from './_test-llm.js';

const SAMPLE_QUERY = {
  questionText: 'What color is the sky?',
  goldAnswer: 'blue',
  generated: 'The sky is blue.',
};

describe('SingleJudge', () => {
  it('returns a CORRECT outcome with reasoning when the LLM emits {label:CORRECT}', async () => {
    const llm = new CannedResponseLlm('{"label":"CORRECT","reasoning":"matches gold"}');
    const judge = new SingleJudge({ name: 'gpt-4o', llm });
    const outcome = await judge.judge(SAMPLE_QUERY);
    expect(outcome?.label).toBe('CORRECT');
    expect(outcome?.reasoning).toBe('matches gold');
    expect(outcome?.model).toBe('gpt-4o');
  });

  it('returns a WRONG outcome when the LLM emits {label:WRONG}', async () => {
    const llm = new CannedResponseLlm('{"label":"WRONG","reasoning":"different topic"}');
    const judge = new SingleJudge({ name: 'claude-3.5-sonnet', llm });
    const outcome = await judge.judge(SAMPLE_QUERY);
    expect(outcome?.label).toBe('WRONG');
  });

  it('persists the raw LLM response for audit', async () => {
    const raw = '{"label":"CORRECT","reasoning":"r"}';
    const llm = new CannedResponseLlm(raw);
    const judge = new SingleJudge({ name: 'gpt-4o', llm });
    const outcome = await judge.judge(SAMPLE_QUERY);
    expect(outcome?.rawResponse).toBe(raw);
  });

  it('returns null when the LLM response is malformed (EC-1)', async () => {
    const llm = new CannedResponseLlm('I cannot evaluate this.');
    const judge = new SingleJudge({ name: 'gpt-4o', llm });
    const outcome = await judge.judge(SAMPLE_QUERY);
    expect(outcome).toBeNull();
  });

  it('returns null when the LLM throws (EC-2 network failure)', async () => {
    const judge = new SingleJudge({ name: 'gpt-4o', llm: new FailingLlm() });
    const outcome = await judge.judge(SAMPLE_QUERY);
    expect(outcome).toBeNull();
  });

  it('returns null when label is not in {CORRECT, WRONG}', async () => {
    const llm = new CannedResponseLlm('{"label":"MAYBE","reasoning":"r"}');
    const judge = new SingleJudge({ name: 'gpt-4o', llm });
    expect(await judge.judge(SAMPLE_QUERY)).toBeNull();
  });
});
