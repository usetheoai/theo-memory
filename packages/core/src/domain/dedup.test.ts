/**
 * RED-phase tests for src/core/dedup.ts — T1.1 of v0-1-local-runtime plan v1.3.
 *
 * Behavior locked per blueprint D3 + upstream reference index.ts:735:
 * exact-text MD5; NO normalization (lowercase, NFC/NFD, whitespace).
 *
 * EC-6 absorption: NFC vs NFD produce different hashes (documented byte-level
 * dedup, NOT semantic — matches the upstream behavior).
 */
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { hashFact } from './dedup.js';

describe('hashFact', () => {
  test('returns a 32-char lowercase hex string', () => {
    const hash = hashFact('Paulo likes coffee');
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  test('is deterministic for identical input', () => {
    expect(hashFact('I prefer dark mode')).toBe(hashFact('I prefer dark mode'));
  });

  test('produces different hashes for different inputs', () => {
    expect(hashFact('a')).not.toBe(hashFact('b'));
  });

  test('accepts the empty string and still returns a 32-char hex', () => {
    expect(hashFact('')).toMatch(/^[a-f0-9]{32}$/);
  });

  test('case-sensitive — does NOT normalize case (matches blueprint D3)', () => {
    expect(hashFact('CAT')).not.toBe(hashFact('cat'));
  });

  test('NFC and NFD encodings of the same glyph produce different hashes (EC-6 byte-level invariant)', () => {
    // 'café' as 4 codepoints (precomposed é): c, a, f, é (U+00E9)
    const nfc = 'café';
    // 'café' as 5 codepoints (decomposed): c, a, f, e, combining acute (U+0301)
    const nfd = 'café';
    expect(nfc).not.toBe(nfd);
    expect(hashFact(nfc)).not.toBe(hashFact(nfd));
  });

  test('matches the canonical Node md5 of utf-8 bytes for a known fixture', () => {
    const known = createHash('md5').update('Paulo likes coffee', 'utf8').digest('hex');
    expect(hashFact('Paulo likes coffee')).toBe(known);
  });
});
