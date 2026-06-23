/**
 * Deterministic language detection for the extraction pipeline (EG-4
 * fixes-cycle-1). The write pipeline calls {@link detectInputLanguage} BEFORE
 * building the extraction prompt and injects the explicit target-language NAME, so
 * the LLM follows a concrete instruction ("Write ALL facts in English") instead of
 * the unreliable self-detection that let English inputs be persisted as Portuguese
 * facts (integrated live-test 2026-06-23). Pure functions, no I/O.
 *
 * Detection uses `eld` (efficient-language-detector, Apache-2.0, pure-JS, no native
 * bindings). `eld` is markedly more accurate than trigram detectors on short text
 * and on close-language pairs (e.g. it classifies "Eu trabalho como engenheiro
 * mecânico" as Portuguese, where franc-min picked Spanish — which would have forced
 * the WRONG output language). Returns `null` — meaning "inject no directive; preserve
 * current behavior" — when the input is shorter than {@link MIN_DETECT_CHARS}, the
 * detector is not reliable, OR the detected ISO-639-1 code is not in the supported
 * name map (so a raw/unsupported code is never injected into the prompt).
 *
 * @see .claude/knowledge-base/plans/extraction-language-determinism-fixes-cycle-1-plan.md
 */
import { eld } from 'eld';

/**
 * Minimum trimmed length before detection is attempted. Short fragments classify
 * unreliably; below this we return `null` (no directive) rather than guess.
 */
export const MIN_DETECT_CHARS = 12;

/**
 * Supported ISO-639-1 → English language name. Scope for fixes-cycle-1: the
 * Latin-script major languages, including the dogfood pair (en/pt). A detected
 * code outside this map yields `null` (no injection), preserving today's behavior
 * for unsupported scripts/languages.
 */
const ISO6391_TO_NAME: Readonly<Record<string, string>> = {
  en: 'English',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
};

export interface DetectedLanguage {
  /** ISO-639-1 code (e.g. `en`, `pt`). */
  readonly iso6391: string;
  readonly name: string;
}

function detectCode(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_DETECT_CHARS) {
    return null;
  }
  try {
    const result = eld.detect(trimmed);
    const code = result.language;
    if (code === '' || (typeof result.isReliable === 'function' && !result.isReliable())) {
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

/**
 * Detect the language deterministically. Returns a `{ iso6391, name }` pair only
 * when the language is confidently classified AND supported; otherwise `null` (the
 * caller injects no language directive and behaves exactly as before). Used for both
 * the input text (drives the prompt directive) and the joined fact text (drives the
 * post-extraction correction guard).
 */
export function detectInputLanguage(text: string): DetectedLanguage | null {
  const code = detectCode(text);
  if (code === null) {
    return null;
  }
  const name = ISO6391_TO_NAME[code];
  if (name === undefined) {
    return null; // detected but unmapped — never inject a raw/unsupported code (EC-1)
  }
  return { iso6391: code, name };
}
