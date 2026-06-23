/**
 * Unit tests for deterministic input-language detection (EG-4 fixes-cycle-1 T1.1).
 * Pure functions — no LLM, no I/O.
 *
 * @see .claude/knowledge-base/plans/extraction-language-determinism-fixes-cycle-1-plan.md § T1.1
 */
import { describe, expect, it } from 'vitest';

import { detectInputLanguage, factLanguageMatches } from './language.js';

describe('detectInputLanguage', () => {
  it('returns English for an English sentence', () => {
    const got = detectInputLanguage('My name is Sarah and I love rock climbing');
    expect(got?.iso6393).toBe('eng');
    expect(got?.name).toBe('English');
  });

  it('returns Portuguese for a Portuguese sentence', () => {
    const got = detectInputLanguage('Eu trabalho como engenheiro mecânico em Lisboa');
    expect(got?.iso6393).toBe('por');
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
    // A Mandarin sentence: franc classifies it as `cmn`, which is intentionally
    // NOT in the supported name map for this cycle → no directive injected.
    expect(detectInputLanguage('我叫保罗，我是一名软件工程师，我住在里斯本')).toBeNull();
  });
});

describe('factLanguageMatches', () => {
  it('is fail-soft when the fact is too short to judge', () => {
    expect(factLanguageMatches('ok', 'eng')).toBe(true);
  });

  it('returns true when the fact language equals the expected', () => {
    expect(factLanguageMatches('Sarah works as a data scientist and enjoys climbing', 'eng')).toBe(true);
  });

  it('returns false when a confident supported language differs from the expected', () => {
    // Portuguese fact under an English-input expectation → real mismatch.
    expect(factLanguageMatches('Sarah trabalha como cientista de dados e adora escalada', 'eng')).toBe(false);
  });
});
