/**
 * Unit tests for isEntityNoise — EG-2 entity-extraction-noise-filter T1.1.
 *
 */
import { describe, expect, it } from 'vitest';

import { isEntityNoise } from './entity-noise-filter.js';

describe('isEntityNoise', () => {
  it('drops pronoun/contraction/generic/verb-fragment nodes (observed dogfood noise)', () => {
    const noise = ["I'm", 'm reading', 'love science', 'user', 'i', 'me', 'we', "i've", 'User', 'People'];
    for (const name of noise) {
      expect(isEntityNoise(name), `expected "${name}" to be noise`).toBe(true);
    }
  });

  it('keeps real entities incl. multilingual + verb-homograph compounds (recall preserved)', () => {
    const keep = [
      'Dune',
      'Frank Herbert',
      'Japan',
      'ramen',
      'trains',
      'software engineer',
      'machine learning',
      'São Paulo',
      'José',
      'fiction novels',
      'Love Island', // EC-1 capitalized-proper exception
      'watch list', // EC-2 action verb excluded
      'think tank', // EC-2
      'read me', // EC-2
      'People magazine', // EC-5 2-word brand kept
      "user's", // EC-3 possessive kept (KISS)
      'It', // F-dom-1: capitalized pronoun homograph (film title) kept
      'Her', // F-dom-1
      'Us', // F-dom-1
    ];
    for (const name of keep) {
      expect(isEntityNoise(name), `expected "${name}" to be kept`).toBe(false);
    }
  });

  it('#111 — drops all-function-word PT/EN fragments but keeps PT content words', () => {
    // The 83%-noise import surfaced standalone/paired function words as entities
    // (`Não` had 140 refs; `o de` in the top). A name whose EVERY token is a closed-class
    // function word (article/preposition/conjunction/pronoun/negation, PT or EN) is noise.
    const noise = ['Não', 'o de', 'o', 'de', 'a de', 'the of', 'e', 'que', 'para o', 'REDACTEDhighentropy', 'REDACTED:high_entropy'];
    for (const name of noise) {
      expect(isEntityNoise(name), `expected "${name}" to be noise`).toBe(true);
    }
    // PT content words (and mixed names with ≥1 content token) MUST survive — the language
    // routing (eld) handles the rest; the filter must not kill recall.
    const keep = ['engenheiro', 'engenheiro mecânico', 'São Paulo', 'José', 'balbucio', 'Lisboa', 'de Souza'];
    for (const name of keep) {
      expect(isEntityNoise(name), `expected "${name}" to be kept`).toBe(false);
    }
  });

  it('never throws + always returns a boolean (totality)', () => {
    const pathological = ['', '   ', '\n', 'x'.repeat(5000), '🜲', "O'Brien"];
    for (const name of pathological) {
      expect(() => isEntityNoise(name)).not.toThrow();
      expect(typeof isEntityNoise(name)).toBe('boolean');
    }
    // O'Brien is an Irish surname, NOT a contraction remnant — must be kept.
    expect(isEntityNoise("O'Brien")).toBe(false);
  });
});
