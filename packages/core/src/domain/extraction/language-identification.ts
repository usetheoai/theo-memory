/**
 * Identifies the language of the input messages before extraction (#254). Both a
 * character-statistics detector and the model itself name the language of a short sentence
 * from its proper names: "Mihaela's nephew Sorin is a pilot." comes back as Romanian. The text
 * is therefore masked first, every word that starts with a capital letter becoming `X` and
 * every word with a digit becoming `N`, so only the common words are left to decide. A
 * lower-case name particle between two names ("Eça de Queirós", "van der Velde") is dropped
 * too: left in, "X reads X de X." was named Spanish. The model then names the language of
 * the masked text.
 */
import { z } from 'zod';

import type { LLM } from '../dip/llm.js';

import { languageFromCode, type DetectedLanguage } from './language.js';

/** Why an identification produced no language. */
export type LanguageIdentificationFailure = 'unsupported_language' | 'malformed_answer' | 'llm_error';

export type LanguageIdentification =
  | { readonly ok: true; readonly language: DetectedLanguage }
  | { readonly ok: false; readonly reason: LanguageIdentificationFailure; readonly code?: string; readonly error?: string };

const answerSchema = z.object({ language: z.string().min(1) });

/** System prompt of the identification call. */
export const LANGUAGE_IDENTIFICATION_PROMPT =
  'Name the language this text is written in, from its words. Answer JSON {"language": "<ISO 639-1>"}.';

const CAPITALISED = /^[("'“‘]?\p{Lu}/u;
const POSSESSIVE = /['’]s[.,!?;:]*$/u;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/u;

/** Lower-case particles that join the parts of a proper name. */
const NAME_PARTICLES: ReadonlySet<string> = new Set(['de', 'da', 'do', 'dos', 'das', 'del', 'della', 'di', 'du', 'van', 'von', 'der', 'den', 'ter', 'la', 'le', 'al', 'bin', 'ibn']);

/**
 * Replace each whitespace-separated word that contains a digit with `N`, and each word that
 * starts with a capital letter (after an opening quote or parenthesis) with `X`, keeping a
 * possessive `'s` and trailing punctuation. A run of name particles between two capitalised words
 * is dropped.
 */
export function maskNamesAndNumbers(text: string): string {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  const isParticle = (i: number): boolean => NAME_PARTICLES.has(words[i] ?? '');
  // A run of particles ("van der", "de la") joins names when the words on both sides of the run are capitalised.
  const joinsNames = (i: number): boolean => {
    let before = i - 1;
    while (before >= 0 && isParticle(before)) before -= 1;
    let after = i + 1;
    while (after < words.length && isParticle(after)) after += 1;
    return before >= 0 && after < words.length && CAPITALISED.test(words[before]!) && CAPITALISED.test(words[after]!);
  };
  const masked: string[] = [];
  words.forEach((word, i) => {
    if (/\d/u.test(word)) {
      masked.push('N');
    } else if (CAPITALISED.test(word)) {
      masked.push(`X${word.match(POSSESSIVE)?.[0] ?? word.match(TRAILING_PUNCTUATION)?.[0] ?? ''}`);
    } else if (!(isParticle(i) && joinsNames(i))) {
      masked.push(word);
    }
  });
  return masked.join(' ');
}

function parseAnswer(raw: unknown): string | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = answerSchema.safeParse(value);
  return parsed.success ? parsed.data.language.trim().toLowerCase() : null;
}

/** Identify the language of `text`. Never throws; a failure is returned with its reason. */
export async function identifyInputLanguage(llm: LLM, text: string): Promise<LanguageIdentification> {
  let raw: unknown;
  try {
    raw = await llm.generateResponse(
      [
        { role: 'system', content: LANGUAGE_IDENTIFICATION_PROMPT },
        { role: 'user', content: maskNamesAndNumbers(text) },
      ],
      { type: 'json' },
    );
  } catch (error) {
    return { ok: false, reason: 'llm_error', error: error instanceof Error ? error.name : 'UnknownError' };
  }
  const code = parseAnswer(raw);
  if (code === null) return { ok: false, reason: 'malformed_answer' };
  const language = languageFromCode(code);
  return language === null ? { ok: false, reason: 'unsupported_language', code } : { ok: true, language };
}
