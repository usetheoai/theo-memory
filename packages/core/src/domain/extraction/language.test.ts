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
});
