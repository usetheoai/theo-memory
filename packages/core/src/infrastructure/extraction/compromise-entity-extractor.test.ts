/**
 * T1.2 — CompromiseEntityExtractor behavior tests.
 *
 * Ported from the reference entity-extraction checklist: proper nouns, quoted
 * text, compound nouns, empty input, generic-only drop, (type,name) tuple shape,
 * dedup, regex fallback when the NLP lib is absent, and the EC-2 empty/short
 * drop guard (the SEPA-flagged hard checkpoint).
 *
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

  test('multilingual: preserves diacritics in proper nouns (São Paulo, not So/Sao)', () => {
    const out = names('Eu moro em São Paulo com José');
    expect(out).toContain('São Paulo'); // NOT "So Paulo" / "So" — diacritics kept
    expect(out.some((n) => n.includes('José'))).toBe(true); // NOT "Jos"
    expect(out).not.toContain('So');
    expect(out).not.toContain('So Paulo');
  });

  test('drops predicate/clause-fragment noise ("is a", "on the", "project uses")', () => {
    // regex-fallback bigrams + nouns() over-match used to leak these as nodes.
    const out = names('he is a manager and the project uses postgres on the cloud');
    expect(out).not.toContain('is a');
    expect(out).not.toContain('on the');
    expect(out).not.toContain('project uses');
  });

  test('EG-2: drops contraction/verb-led/generic noise but keeps real entities', () => {
    // The dogfood sentence: noise ("I'm","m reading","love science") must NOT
    // leak; the real entity (Dune / Frank Herbert) must survive.
    const out = names("I'm reading Dune by Frank Herbert and I love science fiction novels");
    expect(out.some((n) => n.includes('Dune'))).toBe(true);
    expect(out).not.toContain("I'm");
    expect(out).not.toContain('m reading');
    expect(out).not.toContain('love science');
    expect(out).not.toContain('user');
  });
});

describe('#111 — corpus PT/técnico quality gates (graph noise post-M12 import)', () => {
  const extractor = new CompromiseEntityExtractor();
  const names = (text: string): string[] => extractor.extract(text).map((e) => e.name.toLowerCase());

  test('never extracts scrub redaction markers as entities', () => {
    const out = names('o deploy usa o token [REDACTED:high_entropy] e o arquivo [REDACTED:high_entropy].md no fluxo');
    expect(out.some((n) => n.includes('redacted'))).toBe(false);
  });

  test('non-English text skips the noun-phrase paths (no PT fragment compounds)', () => {
    const out = names(
      'O sistema produz balbucio quando o seam está errado e as informações sobre desenvolvimento se perdem, mantendo acurácia baixa em toda a extração do pipeline.',
    );
    expect(out).not.toContain('produz balbucio');
    expect(out).not.toContain('o seam');
    expect(out).not.toContain('informações sobre desenvolvimento');
  });

  test('keeps multi-word proper names from Portuguese text (Claude Code survives the gate)', () => {
    const out = names('Depois do deploy, o Claude Code grava a memória no theo-memory usando o Ralph Wiggum Loop em produção.');
    expect(out).toContain('claude code');
    expect(out).toContain('ralph wiggum loop');
  });

  test('drops lone sentence-initial Portuguese starters (Não/Isso/etc.)', () => {
    const out = names('Não funciona no ambiente novo. Isso quebra o fluxo inteiro do produto em staging.');
    expect(out).not.toContain('não');
    expect(out).not.toContain('isso');
  });

  test('drops whole-sentence QUOTED spans (keeps short quoted titles)', () => {
    const out = names(
      'Definimos "sistema de sanitization para as customtools dos usuários finais" e também o "Módulo Guardrails" no plano.',
    );
    expect(out).not.toContain('sistema de sanitization para as customtools dos usuários finais');
    expect(out).toContain('módulo guardrails');
  });
});
