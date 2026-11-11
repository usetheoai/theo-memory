import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { caseFileSchema, firstHitRank, formViolations, rankSummary, summarize, summarizeSemantic, type QuestionResult, type SemanticResult } from './scoring.js';

const row = (over: Partial<QuestionResult>): QuestionResult => ({
  user: 'u', query: 'q', form: 'lexical', lostByExtraction: true, messagesHit: true, factsHit: false, recallUnchanged: true, ...over,
});

describe('message-recall scoring', () => {
  test.each(['cases.json', 'cases-paraphrase.json', 'cases-fusion.json'])('every question in %s has the form it declares', (file) => {
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

  describe('semantic message search (H25, H26)', () => {
    const sem = (over: Partial<SemanticResult>): SemanticResult => ({ ...row({ form: 'paraphrase' }), bm25Hit: false, ...over });

    test('H25 passes at 60% of lost paraphrases when hybrid beats BM25', () => {
      const s = summarizeSemantic([sem({}), sem({}), sem({}), sem({ messagesHit: false }), sem({ messagesHit: false })]);
      expect(s.h25).toEqual({ hybrid: { hits: 3, total: 5 }, bm25: { hits: 0, total: 5 } });
      expect(s.h25Pass).toBe(true);
    });

    test('H25 fails below 60% or without beating BM25', () => {
      expect(summarizeSemantic([sem({}), sem({ messagesHit: false })]).h25Pass).toBe(false);
      expect(summarizeSemantic([sem({ bm25Hit: true }), sem({ bm25Hit: true })]).h25Pass).toBe(false);
    });

    test('H25 ignores paraphrases that extraction kept', () => {
      expect(summarizeSemantic([sem({ lostByExtraction: false })]).h25.hybrid.total).toBe(0);
    });

    test('H26 fails when hybrid loses a lexical question BM25 found', () => {
      const lex = (over: Partial<SemanticResult>) => sem({ form: 'lexical', ...over });
      expect(summarizeSemantic([lex({ bm25Hit: true, messagesHit: false })]).h26Pass).toBe(false);
      expect(summarizeSemantic([lex({ bm25Hit: true }), lex({ messagesHit: false })]).h26Pass).toBe(true);
    });

    test('H27 fails when any recall changed', () => {
      expect(summarizeSemantic([sem({ recallUnchanged: false })]).h27Pass).toBe(false);
    });
  });

  test('firstHitRank gives the 1-based position of the first match, or null', () => {
    expect(firstHitRank('washer', ['tap', 'a worn washer', 'washer again'])).toBe(2);
    expect(firstHitRank('washer', ['tap'])).toBeNull();
  });

  test('rankSummary counts top-1 and averages reciprocal ranks, a miss counting 0', () => {
    expect(rankSummary([1, 2, null, 4])).toEqual({ top1: 1, total: 4, mrr: (1 + 0.5 + 0 + 0.25) / 4 });
    expect(rankSummary([])).toEqual({ top1: 0, total: 0, mrr: 0 });
  });
});
