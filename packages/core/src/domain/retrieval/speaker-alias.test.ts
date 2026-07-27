/**
 * M28 (#157) — speaker-alias for the recall lexical path.
 */
import { describe, expect, test } from 'vitest';

import { isSpeakerReferring, withSpeakerAlias } from './speaker-alias.js';

describe('speaker-alias (M28 #157)', () => {
  test('detects speaker-referring queries (PT + EN), rejects non-speaker', () => {
    expect(isSpeakerReferring('Qual a profissão do usuário?')).toBe(true);
    expect(isSpeakerReferring('O que você faz?')).toBe(true);
    expect(isSpeakerReferring('What does the user prefer?')).toBe(true);
    expect(isSpeakerReferring('Em qual SO roda o deploy?')).toBe(false);
    expect(isSpeakerReferring('Qual o limiar do circuit breaker?')).toBe(false);
  });

  test('appends the user token for a speaker query so BM25/entity reach the speaker facts', () => {
    expect(withSpeakerAlias('Qual a profissão do usuário?')).toBe('Qual a profissão do usuário? user');
    expect(withSpeakerAlias('O que você faz?')).toBe('O que você faz? user');
  });

  test('does NOT touch a non-speaker query (byte-identical)', () => {
    expect(withSpeakerAlias('Em qual SO roda o deploy de produção?')).toBe(
      'Em qual SO roda o deploy de produção?',
    );
  });

  test('does NOT double-append when the query already has the user token', () => {
    expect(withSpeakerAlias('What does the user prefer?')).toBe('What does the user prefer?');
  });

  test('does not spuriously match a substring (usuários plural is still a speaker ref; "superuser" is not usuário)', () => {
    // whole-word only: "usuario" inside a larger token must not trigger on unrelated words
    expect(isSpeakerReferring('musicausuariox')).toBe(false);
  });
});
