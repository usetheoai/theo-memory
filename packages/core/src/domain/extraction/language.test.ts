/**
 * Unit tests for deterministic input-language detection (EG-4 fixes-cycle-1 T1.1).
 * Pure functions — no LLM, no I/O.
 *
 */
import { describe, expect, it } from 'vitest';

import { detectInputLanguage } from './language.js';

describe('detectInputLanguage', () => {
  it('returns English for an English sentence', () => {
    const got = detectInputLanguage('My name is Sarah and I love rock climbing');
    expect(got?.iso6391).toBe('en');
    expect(got?.name).toBe('English');
  });

  it('returns Portuguese for a Portuguese sentence', () => {
    const got = detectInputLanguage('Eu trabalho como engenheiro mecânico em Lisboa');
    expect(got?.iso6391).toBe('pt');
    expect(got?.name).toBe('Portuguese');
  });

  it('returns null for undetermined or short input', () => {
    expect(detectInputLanguage('hi')).toBeNull();
    expect(detectInputLanguage('')).toBeNull();
  });

  it('never throws on garbage input (returns null)', () => {
    expect(detectInputLanguage('@@@ 123 \n')).toBeNull();
  });

  it('returns null for a detected-but-unmapped ISO code (EC-1)', () => {
    // A Mandarin sentence: eld classifies it as `zh`, which is intentionally
    // NOT in the supported name map for this cycle → no directive injected.
    expect(detectInputLanguage('我叫保罗，我是一名软件工程师，我住在里斯本')).toBeNull();
  });

  it('detects the aggregate language of joined Portuguese facts (guard input)', () => {
    // The post-extraction guard detects over the JOINED facts (not per-fact), which
    // is long enough for the detector to reliably classify Portuguese.
    const joined = 'Sarah trabalha como cientista de dados. Sarah adora escalada.';
    expect(detectInputLanguage(joined)?.iso6391).toBe('pt');
  });

  it('recovers English from agreeing sentence samples when a long domain-specific turn is globally uncertain', () => {
    const turn = "I've been working on a solo project for my Data Mining class, and I'm really interested in applying some of these techniques to my customer purchase data. I'm trying to identify patterns and trends, and I think feature engineering will really help me with that. Do you have any specific tips on how to handle high cardinality categorical variables in my dataset?";
    expect(detectInputLanguage(turn)?.iso6391).toBe('en');
  });

  it('does not force a language for a turn split evenly between English and Portuguese', () => {
    const mixed = 'I am working on a research project for school this semester. Estou trabalhando em um projeto de pesquisa para a escola neste semestre.';
    expect(detectInputLanguage(mixed)).toBeNull();
  });
});
