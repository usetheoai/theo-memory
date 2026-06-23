/**
 * Deterministic input-language detection for the extraction pipeline
 * (EG-4 fixes-cycle-1). The write pipeline calls {@link detectInputLanguage}
 * BEFORE building the extraction prompt and injects the explicit target-language
 * NAME, so the LLM follows a concrete instruction ("Write ALL facts in English")
 * instead of the unreliable self-detection that let English inputs be persisted
 * as Portuguese facts (integrated live-test 2026-06-23). Pure functions, no I/O.
 *
 * Detection uses `franc-min` (MIT, pure-JS, no native bindings). Returns `null` —
 * meaning "inject no directive; preserve current behavior" — when the language is
 * undetermined, the input is shorter than {@link MIN_DETECT_CHARS}, OR the
 * detected ISO-639-3 code is not in the supported name map (so a raw code such as
 * `cmn` is never injected into the prompt).
 *
 * @see .claude/knowledge-base/plans/extraction-language-determinism-fixes-cycle-1-plan.md
 */
import { franc } from 'franc-min';

/**
 * Minimum trimmed length before detection is attempted. Short fragments classify
 * unreliably; below this we return `null` (no directive) rather than guess.
 */
export const MIN_DETECT_CHARS = 12;

/**
 * Supported ISO-639-3 → English language name. Scope for fixes-cycle-1: the
 * Latin-script major languages, including the dogfood pair (eng/por). A detected
 * code outside this map yields `null` (no injection), preserving today's behavior
 * for unsupported scripts/languages.
 */
const ISO6393_TO_NAME: Readonly<Record<string, string>> = {
  eng: 'English',
  por: 'Portuguese',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  ita: 'Italian',
  nld: 'Dutch',
};

export interface DetectedLanguage {
  readonly iso6393: string;
  readonly name: string;
}

function detectCode(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_DETECT_CHARS) {
    return null;
  }
  try {
    const code = franc(trimmed);
    return code === 'und' ? null : code;
  } catch {
    return null;
  }
}

/**
 * Detect the input language deterministically. Returns a `{ iso6393, name }` pair
 * only when the language is confidently classified AND supported; otherwise `null`
 * (the caller injects no language directive and behaves exactly as before).
 */
export function detectInputLanguage(text: string): DetectedLanguage | null {
  const code = detectCode(text);
  if (code === null) {
    return null;
  }
  const name = ISO6393_TO_NAME[code];
  if (name === undefined) {
    return null; // detected but unmapped — never inject a raw ISO code (EC-1)
  }
  return { iso6393: code, name };
}

/**
 * Fail-soft language-match check used by the post-extraction guard. Returns
 * `true` (do NOT flag a mismatch) whenever either side is undetermined, too short,
 * or detected in a language outside the supported map — only a CONFIDENT,
 * supported, DIFFERENT language returns `false`.
 */
export function factLanguageMatches(factText: string, expectedIso6393: string): boolean {
  const code = detectCode(factText);
  if (code === null) {
    return true; // undetermined / too short → fail-soft
  }
  if (ISO6393_TO_NAME[code] === undefined) {
    return true; // detected but unsupported → do not flag
  }
  return code === expectedIso6393;
}
