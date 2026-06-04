/**
 * RED-phase tests for src/core/lemmatization.ts — T1.2 of v0-1-local-runtime plan v1.3.
 *
 * Behavior locked per blueprint Recommendation 3 + upstream reference
 * utils/lemmatization.ts:246-278. Optional `natural` (Porter stemmer) with
 * in-house `simpleStem` fallback when `natural` is not installed.
 *
 * EC-7 documents the English-only STOP_WORDS limitation (Portuguese passes
 * through unaltered; multilingual deferred to v0.2+).
 */
import { describe, expect, test } from 'vitest';
import { STOP_WORDS, lemmatizeForBm25, simpleStem } from '../lemmatization.js';

describe('STOP_WORDS', () => {
  test('contains the canonical English minimum set', () => {
    for (const word of ['the', 'a', 'an', 'is', 'and', 'or']) {
      expect(STOP_WORDS.has(word)).toBe(true);
    }
  });
});

describe('simpleStem', () => {
  test('drops trailing s but preserves ss', () => {
    expect(simpleStem('cats')).toBe('cat');
    expect(simpleStem('pass')).toBe('pass');
  });

  test('drops ing suffix when word stays long enough', () => {
    expect(simpleStem('running')).toBe('runn');
    expect(simpleStem('walking')).toBe('walk');
  });

  test('drops ed suffix', () => {
    expect(simpleStem('walked')).toBe('walk');
  });

  test('drops ly suffix', () => {
    expect(simpleStem('quickly')).toBe('quick');
  });

  test('preserves single-char input', () => {
    expect(simpleStem('a')).toBe('a');
  });

  test('returns empty for empty input', () => {
    expect(simpleStem('')).toBe('');
  });

  test('returns lowercased value', () => {
    expect(simpleStem('Cats')).toBe('cat');
  });
});

describe('lemmatizeForBm25', () => {
  test('drops stop words', () => {
    const out = lemmatizeForBm25('the cat sat on the mat');
    expect(out).not.toContain('the');
    expect(out).not.toContain('on');
    expect(out).toContain('cat');
    expect(out).toContain('sat');
    expect(out).toContain('mat');
  });

  test('lowercases all tokens', () => {
    const out = lemmatizeForBm25('CAT and DOG');
    expect(out).toContain('cat');
    expect(out).toContain('dog');
  });

  test('returns empty array when input is all stop words', () => {
    expect(lemmatizeForBm25('the a an is')).toEqual([]);
  });

  test('Portuguese passes through (EC-7: STOP_WORDS is English-only at v0.1; coincidence with English stop-words is documented)', () => {
    // Portuguese sentence chosen to avoid coincidence with English STOP_WORDS
    // (the English set includes 'a', 'no', 'is', etc. which collide with Portuguese articles/prepositions).
    // Both stemmers (Porter via natural OR simpleStem fallback) may reshape tokens; test
    // asserts count (all 5 input words survive stop-word filter) + prefix match (stems
    // start with the lowercased input word's leading chars) to be stemmer-agnostic.
    const inputs = ['gato', 'sentou', 'tapete', 'vermelho', 'enorme'];
    const out = lemmatizeForBm25(inputs.join(' '));
    expect(out.length).toBe(inputs.length);
    for (let i = 0; i < inputs.length; i += 1) {
      const inputWord = inputs[i] as string;
      const stemmedToken = out[i] as string;
      // Stem MUST be a prefix of the input lowercase word (Porter only drops suffixes; simpleStem too)
      expect(inputWord.startsWith(stemmedToken)).toBe(true);
      expect(stemmedToken.length).toBeGreaterThan(0);
    }
  });

  test('handles non-alphanumeric separators (punctuation)', () => {
    const out = lemmatizeForBm25('cats, dogs; birds!');
    expect(out).toContain('cat');
    expect(out).toContain('dog');
    expect(out).toContain('bird');
  });
});
