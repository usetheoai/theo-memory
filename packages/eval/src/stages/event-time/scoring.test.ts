import { describe, expect, it } from 'vitest';

import { classifyEventTime } from './scoring.js';

describe('classifyEventTime', () => {
  it('is not-stored when the write kept nothing', () => {
    expect(classifyEventTime([], '2024-03-14')).toBe('not-stored');
  });

  it('is correct when a stored text carries the expected day', () => {
    expect(classifyEventTime(['user has a dentist appointment on 2024-03-14'], '2024-03-14')).toBe('correct');
  });

  it('is wrong-date when the stored day is another one', () => {
    expect(classifyEventTime(['user has a dentist appointment on 2024-03-15'], '2024-03-14')).toBe('wrong-date');
  });

  it('is undated when the stored text keeps only the relative wording', () => {
    expect(classifyEventTime(['user has a dentist appointment tomorrow'], '2024-03-14')).toBe('undated');
  });

  it('accepts a day inside the expected month', () => {
    expect(classifyEventTime(['user is flying to Lisbon on 2024-03-02'], '2024-03')).toBe('correct');
  });

  it('does not accept the month alone when a day is expected', () => {
    expect(classifyEventTime(['user is flying to Lisbon in 2024-03'], '2024-03-14')).toBe('wrong-date');
  });

  it('does not read part of a longer number as a date', () => {
    expect(classifyEventTime(['order 12024-03-145 arrived'], '2024-03-14')).toBe('undated');
  });

  it('is correct when one of several stored texts carries the date', () => {
    expect(classifyEventTime(['user has a cat', 'user adopted a cat on 2024-03-14'], '2024-03-14')).toBe('correct');
  });
});
