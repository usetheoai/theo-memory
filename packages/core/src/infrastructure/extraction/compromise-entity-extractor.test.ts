/**
 * T1.2 — CompromiseEntityExtractor behavior tests.
 *
 * Ported from the reference entity-extraction checklist: proper nouns, quoted
 * text, compound nouns, empty input, generic-only drop, (type,name) tuple shape,
 * dedup, regex fallback when the NLP lib is absent, and the EC-2 empty/short
 * drop guard (the SEPA-flagged hard checkpoint).
 *
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T1.2
 */
import { describe, test, expect } from 'vitest';

import type { EntityType } from '../../domain/dip/entity-extractor.js';
import { CompromiseEntityExtractor } from './compromise-entity-extractor.js';

const extractor = new CompromiseEntityExtractor();
const names = (text: string): string[] => extractor.extract(text).map((e) => e.name);
const types = (text: string): EntityType[] => extractor.extract(text).map((e) => e.type);

describe('CompromiseEntityExtractor (T1.2)', () => {
  test('extracts proper nouns', () => {
    const result = extractor.extract('John Smith works at Google on machine learning');
    const t = result.map((e) => e.type);
    expect(t).toContain('PROPER');
    expect(result.some((e) => e.name.includes('John Smith') || e.name.includes('Google'))).toBe(true);
  });

  test('extracts quoted text', () => {
    expect(names('She is reading "The Great Gatsby" this week').some((n) => n.includes('Great Gatsby'))).toBe(
      true,
    );
  });

  test('extracts compound nouns', () => {
    expect(types('The machine learning engineer built a neural network')).toContain('COMPOUND');
  });

  test('empty string returns empty array', () => {
    expect(extractor.extract('')).toEqual([]);
  });

  test('generic-only text yields no entities', () => {
    const out = names('I like things and stuff');
    expect(out).not.toContain('things');
    expect(out).not.toContain('stuff');
  });

  test('returns (type,name) pairs; type in the closed enum', () => {
    const closed: EntityType[] = ['PROPER', 'QUOTED', 'COMPOUND', 'NOUN'];
    for (const e of extractor.extract('John Smith lives in New York City')) {
      expect(closed).toContain(e.type);
      expect(typeof e.name).toBe('string');
    }
  });

  test('deduplicates a repeated entity', () => {
    const googleCount = names('Google is great. I love working at Google.').filter(
      (n) => n === 'Google',
    ).length;
    expect(googleCount).toBeLessThanOrEqual(1);
  });

  test('regex fallback works when the NLP lib is absent (never throws)', () => {
    // Inject a loader that throws → extractor must degrade to regex, not throw.
    const fallbackExtractor = new CompromiseEntityExtractor({
      loadNlp: () => {
        throw new Error('compromise not installed');
      },
    });
    const out = fallbackExtractor.extract('She read "Dune" today');
    expect(out.some((e) => e.name.includes('Dune'))).toBe(true);
  });

  test('EC-2: blank or punctuation-only candidate is dropped (no empty/short name)', () => {
    for (const e of extractor.extract('"" and " " and "ok" and a , . ; symbol')) {
      expect(e.name.trim().length).toBeGreaterThanOrEqual(2);
    }
  });

  test('F-L/recall: sentence-initial proper noun is NOT truncated (John Smith, not Smith)', () => {
    expect(names('John Smith works at Google')).toContain('John Smith');
  });

  test('F-L/recall: a lone sentence-initial proper noun is kept (Google), not dropped', () => {
    expect(names('Google is a search engine')).toContain('Google');
  });

  test('F-L/recall precision: lone sentence-initial starter stopwords are NOT entities', () => {
    const out = names('Today I went home');
    expect(out).not.toContain('Today');
    expect(out).not.toContain('I');
    const out2 = names('The cat sat down');
    expect(out2).not.toContain('The');
  });
});
