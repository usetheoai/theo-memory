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
 */
import { eld } from 'eld';

/**
 * Minimum trimmed length before detection is attempted. Short fragments classify
 * unreliably; below this we return `null` (no directive) rather than guess.
 */
export const MIN_DETECT_CHARS = 12;
const MAX_SEGMENT_CHARS = 180;
const MIN_SEGMENT_CHARS = 40;

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

function reliableLanguage(text: string): string | null {
  if (text.trim().length < MIN_DETECT_CHARS) return null;
  try {
    const result = eld.detect(text.trim());
    if (result.language === '' || (typeof result.isReliable === 'function' && !result.isReliable())) {
      return null;
    }
    return result.language;
  } catch {
    return null;
  }
}

function boundedSegments(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  const segments: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_SEGMENT_CHARS) {
      if (sentence.length >= MIN_SEGMENT_CHARS) segments.push(sentence);
      continue;
    }
    let current = '';
    for (const word of sentence.split(/\s+/)) {
      if (current.length > 0 && current.length + word.length + 1 > MAX_SEGMENT_CHARS) {
        if (current.length >= MIN_SEGMENT_CHARS) segments.push(current);
        current = '';
      }
      current = current.length === 0 ? word : `${current} ${word}`;
    }
    if (current.length >= MIN_SEGMENT_CHARS) segments.push(current);
  }
  return segments;
}

function detectCode(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_DETECT_CHARS) {
    return null;
  }
  const direct = reliableLanguage(trimmed);
  // Long/domain-heavy turns can make the detector's global guess unreliable; it
  // can also confidently pick the wrong majority language on a bilingual turn.
  // Use independent substantial samples to confirm a directive in either case.
  const votes = new Map<string, number>();
  let total = 0;
  let reliableSegments = 0;
  for (const segment of boundedSegments(trimmed)) {
    const language = reliableLanguage(segment);
    if (language === null) continue;
    reliableSegments += 1;
    const weight = segment.length;
    votes.set(language, (votes.get(language) ?? 0) + weight);
    total += weight;
  }
  if (reliableSegments < 2 || votes.size === 0) return direct;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (winner === undefined || (runnerUp !== undefined && runnerUp[1] === winner[1])) return null;
  const winningWeight = winner[1];
  if (winningWeight / total < 0.75) return null;
  if (direct !== null && direct !== winner[0] && (votes.get(direct) ?? 0) / total >= 0.25) {
    return null;
  }
  return winner[0];
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
