import { describe, expect, it } from 'vitest';

import { matchEntityKeysInQuery } from './entity-query-match.js';

/**
 * T1.1 — query↔entity matching.
 *
 * The write path normalizes entity names with `normalizeEntityKey`
 * (`domain/extraction/entity-linking.ts:49`): `trim().toLowerCase().replace(/\s+/g,'_')`.
 * Diacritics survive; spaces become underscores.
 *
 * The BM25 lemmatizer is NOT a usable counterpart: `lemmatizeForBm25` splits on
 * `/\W+/` without the `u` flag, so `ã` is a non-word character and "são paulo"
 * degrades to ["s","o","paulo"]. Matching BM25 tokens against `normalized_key`
 * would never hit — the boost would ship and stay dead, which is theo-memory#122
 * reintroduced in a subtler form.
 *
 * So the query is normalized INTO the key's alphabet, and `_` counts as a word
 * boundary. That direction is what lets `são_paulo` and `user_id` both match.
 */
describe('matchEntityKeysInQuery', () => {
  it('test_entity_key_with_regex_metacharacters_does_not_throw', () => {
    // Entity names come from the LLM. `C++` normalizes to `c++`, and
    // `new RegExp('c++')` throws SyntaxError: Nothing to repeat — an exception
    // on the hot read path that a single memory in the corpus would trigger.
    const keys = ['c++', 'f#', '.net', 'a*'];

    expect(() => matchEntityKeysInQuery('eu escrevo em C++', keys)).not.toThrow();
    expect(matchEntityKeysInQuery('eu escrevo em C++', keys)).toContain('c++');
  });

  it('test_normalized_query_matches_single_word_entity_key', () => {
    expect(matchEntityKeysInQuery('quem é o Paulo', ['paulo'])).toContain('paulo');
  });

  it('test_normalized_query_matches_multi_word_entity_key', () => {
    // The case the BM25 lemmatizer could never resolve.
    expect(matchEntityKeysInQuery('moro em São Paulo desde 2020', ['são_paulo'])).toContain(
      'são_paulo',
    );
  });

  it('test_diacritics_are_preserved_in_matching', () => {
    expect(matchEntityKeysInQuery('conheço são paulo', ['são_paulo'])).toContain('são_paulo');
    // The write path never folds diacritics, so the read path must not either —
    // folding on one side only produces a silent permanent zero.
    expect(matchEntityKeysInQuery('conheço são paulo', ['sao_paulo'])).not.toContain('sao_paulo');
  });

  it('test_partial_word_does_not_match', () => {
    expect(matchEntityKeysInQuery('paul mccartney', ['paulo'])).toHaveLength(0);
  });

  it('test_case_is_ignored', () => {
    expect(matchEntityKeysInQuery('PAULO', ['paulo'])).toContain('paulo');
  });

  it('test_empty_query_matches_no_entity_key', () => {
    // A naive containment check would let the empty string match every key,
    // boosting every candidate.
    expect(matchEntityKeysInQuery('', ['paulo'])).toHaveLength(0);
    expect(matchEntityKeysInQuery('   ', ['paulo'])).toHaveLength(0);
  });

  it('test_entity_key_with_literal_underscore_still_matches', () => {
    expect(matchEntityKeysInQuery('o campo user_id está nulo', ['user_id'])).toContain('user_id');
  });

  it('test_match_is_found_after_a_non_boundary_occurrence', () => {
    // The first occurrence of `paulo` sits inside `mcpaulo` and must be rejected, but the
    // scan has to keep going and find the standalone one. Collapsing the loop into a single
    // indexOf still passes every other test here while silently returning no match — the
    // boost going quietly to zero is exactly the failure class this plan closes.
    expect(matchEntityKeysInQuery('mcpaulo e paulo', ['paulo'])).toContain('paulo');
  });

  it('test_empty_entity_key_is_skipped_without_hanging', () => {
    // `''.indexOf` clamps instead of advancing, so an empty key would spin forever on the
    // hot read path — an unbounded loop, not a wrong answer. Rows written before the noise
    // filter (or by a reextract) can carry one, so the read path cannot assume it away.
    expect(matchEntityKeysInQuery('paulo', ['', 'paulo'])).toEqual(['paulo']);
  });
});
