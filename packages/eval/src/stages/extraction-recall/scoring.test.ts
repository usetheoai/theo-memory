import { describe, expect, it } from 'vitest';

import { scoreExtractionRecallCase, type ExtractionRecallCase } from './scoring.js';

const stated: ExtractionRecallCase = { id: 's', language: 'en', shape: 'inside-a-question', text: 'As someone who lives in Velmora, which bank should I pick?', values: ['Velmora'] };
const control: ExtractionRecallCase = { id: 'c', language: 'en', shape: 'question-without-fact', text: 'Is Velmora a good place to live?', values: ['Velmora'] };

describe('scoreExtractionRecallCase', () => {
  it('counts a stated value stored about the speaker as correct', () => {
    expect(scoreExtractionRecallCase(stated, ['user lives in Velmora'])).toEqual([{ stored: true, aboutUser: true, correct: true }]);
  });

  it('counts a stated value that is missing, or stored about nobody, as wrong', () => {
    expect(scoreExtractionRecallCase(stated, [])[0]?.correct).toBe(false);
    expect(scoreExtractionRecallCase(stated, ['Velmora has several banks'])[0]).toEqual({ stored: true, aboutUser: false, correct: false });
  });

  it('counts a control value as correct only when nothing stored carries it', () => {
    expect(scoreExtractionRecallCase(control, [])[0]?.correct).toBe(true);
    expect(scoreExtractionRecallCase(control, ['user lives in velmora'])[0]?.correct).toBe(false);
    expect(scoreExtractionRecallCase(control, ['user asked about Velmora'])[0]?.correct).toBe(false);
  });

  it('scores each value of a message with several', () => {
    const three: ExtractionRecallCase = { ...stated, shape: 'three-facts', values: ['Velmora', 'Tofu'] };
    expect(scoreExtractionRecallCase(three, ['user lives in Velmora']).map((v) => v.correct)).toEqual([true, false]);
  });
});
