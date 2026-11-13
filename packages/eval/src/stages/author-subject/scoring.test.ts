import { describe, expect, it } from 'vitest';

import { scoreAuthorSubjectCase, scoreSubject, type AuthorSubjectCase } from './scoring.js';

const named = { value: 'a piano tuner', subject: 'Maeve' };

describe('scoreSubject', () => {
  it('accepts a fact that names the author the message names', () => {
    expect(scoreSubject(named, [], ['Maeve works as a piano tuner'])).toBe('correct');
  });

  it('matches the value without its leading article', () => {
    expect(scoreSubject(named, [], ['Maeve is a piano tuner by trade'])).toBe('correct');
  });

  it('rejects a fact that keeps the speaker token for a named author', () => {
    expect(scoreSubject(named, [], ['user works as a piano tuner'])).toBe('wrong');
  });

  it('rejects when one of two facts with the value loses the name', () => {
    expect(scoreSubject(named, [], ['Maeve works as a piano tuner', 'user is a piano tuner'])).toBe('wrong');
  });

  it('reports a value no fact carries as missing', () => {
    expect(scoreSubject(named, [], ['Maeve lives in Graz'])).toBe('missing');
  });

  it('accepts the speaker token when the author is unnamed', () => {
    expect(scoreSubject({ value: 'Graz', subject: 'user' }, ['Note'], ['user lives in Graz'])).toBe('correct');
  });

  it('rejects a label taken for a person when the author is unnamed', () => {
    expect(scoreSubject({ value: 'Graz', subject: 'user' }, ['Note'], ['Note lives in Graz'])).toBe('wrong');
    expect(scoreSubject({ value: 'Graz', subject: 'user' }, ['Note'], ['user Note lives in Graz'])).toBe('wrong');
  });

  it('does not read a name inside a longer word', () => {
    expect(scoreSubject({ value: 'Graz', subject: 'Ana' }, [], ['Anabela lives in Graz'])).toBe('wrong');
  });

  it('rejects the author as subject of a fact about a third person', () => {
    expect(scoreSubject({ value: 'the oboe', subject: 'Rhys' }, ['Farah'], ['Farah plays the oboe'])).toBe('wrong');
    expect(scoreSubject({ value: 'the oboe', subject: 'Rhys' }, ['Farah'], ['Rhys plays the oboe'])).toBe('correct');
  });
});

describe('scoreAuthorSubjectCase', () => {
  const fixture: AuthorSubjectCase = {
    id: 'two',
    language: 'en',
    family: 'two-authors',
    messages: [
      { role: 'user', content: 'Maeve: I tune pianos for a living, a piano tuner.' },
      { role: 'user', content: 'Bram: I live in Graz.' },
    ],
    expected: [named, { value: 'Graz', subject: 'Bram' }],
    notSubjects: ['Maeve', 'Bram'],
  };

  it('passes only when every pair is correct', () => {
    expect(scoreAuthorSubjectCase(fixture, ['Maeve is a piano tuner', 'Bram lives in Graz']).passed).toBe(true);
    const mixed = scoreAuthorSubjectCase(fixture, ['Maeve is a piano tuner', 'Maeve lives in Graz']);
    expect(mixed.outcomes).toEqual(['correct', 'wrong']);
    expect(mixed.passed).toBe(false);
  });
});
