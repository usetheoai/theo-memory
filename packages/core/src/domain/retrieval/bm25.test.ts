import { describe, expect, test } from 'vitest';

import { BM25_B, BM25_K1, bm25Scores } from './bm25.js';

describe('bm25Scores', () => {
  test('matches the Lucene BM25 formula on a hand-computed case', () => {
    // N = 2 docs, avgdl = 2. Term "tea" in 1 doc: idf = ln(1 + (2 - 1 + 0.5) / (1 + 0.5)) = ln 2.
    // Doc "d1" = [melanie, tea]: tf = 1, dl = 2 → tf·(k1+1) / (tf + k1·(1 - b + b·dl/avgdl)) = 2.2 / 2.2 = 1.
    const scores = bm25Scores(['tea'], [
      { id: 'd1', terms: ['melanie', 'tea'] },
      { id: 'd2', terms: ['melanie', 'running'] },
    ]);
    expect(BM25_K1).toBe(1.2);
    expect(BM25_B).toBe(0.75);
    expect(scores.get('d1')).toBeCloseTo(Math.log(2), 10);
    expect(scores.has('d2')).toBe(false);
  });

  test('a term present in every document still counts, but less than a rare one', () => {
    const scores = bm25Scores(['melanie', 'sunrise'], [
      { id: 'common', terms: ['melanie', 'tea'] },
      { id: 'rare', terms: ['sunrise', 'lake'] },
      { id: 'other', terms: ['melanie', 'book'] },
    ]);
    expect(scores.get('rare')).toBeGreaterThan(scores.get('common') ?? 0);
    expect(scores.get('common')).toBeGreaterThan(0);
  });

  test('repeating a query term does not count it twice', () => {
    const docs = [{ id: 'd1', terms: ['tea'] }, { id: 'd2', terms: ['coffee'] }];
    expect(bm25Scores(['tea', 'tea'], docs).get('d1')).toBe(bm25Scores(['tea'], docs).get('d1'));
  });

  test('an empty query or corpus scores nothing', () => {
    expect(bm25Scores([], [{ id: 'd1', terms: ['tea'] }]).size).toBe(0);
    expect(bm25Scores(['tea'], []).size).toBe(0);
  });
});
