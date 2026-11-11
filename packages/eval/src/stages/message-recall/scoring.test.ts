import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { caseFileSchema, formViolations, summarize, type QuestionResult } from './scoring.js';

const row = (over: Partial<QuestionResult>): QuestionResult => ({
  user: 'u', query: 'q', form: 'lexical', lostByExtraction: true, messagesHit: true, factsHit: false, recallUnchanged: true, ...over,
});

describe('message-recall scoring', () => {
  test.each(['cases.json', 'cases-paraphrase.json'])('every question in %s has the form it declares', (file) => {
    const cases = caseFileSchema.parse(JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')));
    expect(formViolations(cases)).toEqual([]);
  });

  test('a paraphrase that repeats a word of its answer is a violation', () => {
    const cases = caseFileSchema.parse({ users: [{ id: 'u', conversations: [[{ role: 'assistant', content: 'try chamomile tea' }]],
      questions: [{ query: 'which tea?', pattern: 'chamomile', form: 'paraphrase' }] }] });
    expect(formViolations(cases)).toEqual(['u: paraphrase "which tea?" repeats tea']);
  });

  test('H23 counts only lexical questions that extraction lost, and passes at two thirds', () => {
    const summary = summarize([
      row({}), row({}), row({ messagesHit: false }),
      row({ lostByExtraction: false, messagesHit: false }),
      row({ form: 'paraphrase', messagesHit: false }),
    ]);
    expect(summary.h23).toEqual({ hits: 2, total: 3 });
    expect(summary.h23Pass).toBe(true);
  });

  test('H23 fails below two thirds and when no lexical question was lost', () => {
    expect(summarize([row({}), row({ messagesHit: false }), row({ messagesHit: false })]).h23Pass).toBe(false);
    expect(summarize([row({ lostByExtraction: false })]).h23Pass).toBe(false);
  });

  test('H24 fails when any recall changed', () => {
    expect(summarize([row({}), row({ recallUnchanged: false })]).h24Pass).toBe(false);
  });
});
