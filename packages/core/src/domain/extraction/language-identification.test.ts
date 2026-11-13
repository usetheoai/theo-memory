import { describe, expect, test } from 'vitest';

import type { LLM, Message } from '../dip/llm.js';

import { identifyInputLanguage, maskNamesAndNumbers } from './language-identification.js';

const answering = (answer: unknown): LLM & { seen: (readonly Message[])[] } => {
  const seen: (readonly Message[])[] = [];
  return {
    seen,
    generateResponse: (messages) => {
      seen.push(messages);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    generateChat: () => Promise.resolve({ role: 'assistant' as const, content: '' }),
  };
};

describe('maskNamesAndNumbers', () => {
  test('masks capitalised words and words with digits, keeping possessives and punctuation', () => {
    expect(maskNamesAndNumbers("Mihaela's nephew Sorin is a pilot.")).toBe("X's nephew X is a pilot.");
    expect(maskNamesAndNumbers('Bogdan owns a Peugeot 208.')).toBe('X owns a X N');
    expect(maskNamesAndNumbers('Zsófia supports Ferencváros.')).toBe('X supports X.');
  });

  test('drops a name particle between two names (#254)', () => {
    expect(maskNamesAndNumbers('Gonçalo reads Eça de Queirós.')).toBe('X reads X X.');
    expect(maskNamesAndNumbers('Pieter van der Velde installs solar panels.')).toBe('X X installs solar panels.');
  });

  test('keeps a particle that is not between two names', () => {
    expect(maskNamesAndNumbers('a irmã de Débora mora em Manaus')).toBe('a irmã de X mora em X');
  });

  test('leaves lower-case words, accents included, untouched', () => {
    expect(maskNamesAndNumbers('a irmã de Débora mora em Manaus')).toBe('a irmã de X mora em X');
  });
});

describe('identifyInputLanguage', () => {
  test('sends the masked text and returns a supported language', async () => {
    const llm = answering({ language: 'EN' });
    const result = await identifyInputLanguage(llm, 'Ilinca keeps tortoises.');
    expect(result).toEqual({ ok: true, language: { iso6391: 'en', name: 'English' } });
    expect(llm.seen[0]?.[1]?.content).toBe('X keeps tortoises.');
  });

  test('accepts an answer given as a JSON string', async () => {
    expect(await identifyInputLanguage(answering('{"language":"pt"}'), 'Eu moro em Lisboa')).toEqual({
      ok: true,
      language: { iso6391: 'pt', name: 'Portuguese' },
    });
  });

  test('reports an unsupported language with its code', async () => {
    expect(await identifyInputLanguage(answering({ language: 'pl' }), 'Ola mieszka w Krakowie')).toEqual({
      ok: false,
      reason: 'unsupported_language',
      code: 'pl',
    });
  });

  test('reports a malformed answer', async () => {
    expect(await identifyInputLanguage(answering({ lang: 'en' }), 'x')).toEqual({ ok: false, reason: 'malformed_answer' });
    expect(await identifyInputLanguage(answering('not json'), 'x')).toEqual({ ok: false, reason: 'malformed_answer' });
  });

  test('reports a failed call without throwing', async () => {
    const error = new TypeError('network down');
    expect(await identifyInputLanguage(answering(error), 'x')).toEqual({ ok: false, reason: 'llm_error', error: 'TypeError' });
  });
});
