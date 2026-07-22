/**
 * CompromiseEntityExtractor — default EntityExtractor adapter.
 *
 * Extracts four kinds of nodes from text: PROPER (capitalized sequences),
 * QUOTED (quoted spans), COMPOUND (multi-word noun phrases) and NOUN (single
 * salient nouns). Uses the optional JS-native NLP package when present; falls
 * back to regex-only extraction when it is absent (the package is an OPTIONAL
 * dependency — lazy-loaded, never a hard import, so the default bundle does not
 * pull it). Synchronous + deterministic; embedding of the names happens later
 * in the write pipeline.
 *
 */
import type { EntityExtractor, EntityType, ExtractedEntity } from '../../domain/dip/entity-extractor.js';
import { isEntityNoise } from '../../domain/extraction/entity-noise-filter.js';
import { detectInputLanguage } from '../../domain/extraction/language.js';
import {
  BOUNDARY_STOP,
  CONJUGATED_VERB,
  GENERIC_HEADS,
  NON_SPECIFIC_ADJ,
  PROPER_GLUE,
  SENTENCE_STARTERS,
} from './english-word-lists.js';

/**
 * Scrub redaction markers (`[REDACTED:high_entropy]`, …) MUST never surface as
 * entities (#111 — the marker survived the bare-token strip as `REDACTEDhighentropy`
 * and became the 2nd most-connected "entity" in the dev graph). Stripped from the
 * input before any extraction path runs.
 */
const REDACTION_MARKER = /\[REDACTED:[a-z_]+\]/gi;

/** QUOTED spans longer than this are whole-sentence quotes, not entity titles (#111). */
const MAX_QUOTED_WORDS = 6;

/** Minimum surface length for a candidate to count as an entity (EC-2). */
const MIN_NAME_LENGTH = 2;

/** Trim leading/trailing function words from a candidate and drop predicate/clause
 *  fragments. Returns the cleaned entity name, or `null` when nothing entity-like
 *  remains. Fixes graph noise ("is a", "on the", "project uses", "and commutes",
 *  "the machine learning engineer"→"machine learning engineer") WITHOUT dropping
 *  legitimate noun phrases that merely carry a leading article. */
export function cleanCandidateName(raw: string): string | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && BOUNDARY_STOP.has((tokens[0] ?? '').toLowerCase())) tokens.shift();
  while (tokens.length > 0 && BOUNDARY_STOP.has((tokens[tokens.length - 1] ?? '').toLowerCase())) tokens.pop();
  if (tokens.length === 0) return null;
  const first = (tokens[0] ?? '').toLowerCase();
  const last = (tokens[tokens.length - 1] ?? '').toLowerCase();
  if (CONJUGATED_VERB.has(first) || CONJUGATED_VERB.has(last)) return null;
  return tokens.join(' ');
}

type NlpFactory = (text: string) => {
  nouns: () => { out: (fmt: 'array') => string[] };
};

export interface CompromiseEntityExtractorDeps {
  /** Loader for the optional NLP package. Defaults to a lazy require with
   *  graceful fallback. Injectable so tests can simulate an absent package. */
  loadNlp?: () => NlpFactory | undefined;
}

function defaultLoadNlp(): NlpFactory | undefined {
  try {
    // Lazy, optional: absence degrades to regex-only (no hard dependency).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require('compromise');
    const factory = (mod as { default?: unknown }).default ?? mod;
    return typeof factory === 'function' ? (factory as NlpFactory) : undefined;
  } catch {
    return undefined;
  }
}

function isMeaningful(name: string): boolean {
  return name.trim().length >= MIN_NAME_LENGTH;
}

function pushUnique(acc: Map<string, ExtractedEntity>, type: EntityType, raw: string): void {
  let name = raw.trim();
  if (!isMeaningful(name)) return; // EC-2 drop guard
  // Trim function-word edges + drop predicate/clause fragments ("is a", "on the",
  // "project uses", "and commutes", "the machine learning engineer"→"machine learning
  // engineer"). QUOTED spans are intentional, so they bypass the cleaner.
  if (type !== 'QUOTED') {
    const cleaned = cleanCandidateName(name);
    if (cleaned === null || !isMeaningful(cleaned)) return;
    name = cleaned;
    // EG-2 defense-in-depth: drop pronoun/contraction/generic/verb-fragment
    // noise the boundary-word cleaner misses ("I'm", "m reading", "love science",
    // "user"). QUOTED spans bypass (a quoted title may legitimately be anything).
    if (isEntityNoise(name)) return;
  }
  const key = `${type}::${name.toLowerCase()}`;
  if (!acc.has(key)) acc.set(key, { type, name });
}

/** Push a QUOTED candidate unless it is a whole-sentence quote (#111). */
function pushQuoted(acc: Map<string, ExtractedEntity>, raw: string): void {
  if (raw.trim().split(/\s+/).filter(Boolean).length > MAX_QUOTED_WORDS) return;
  pushUnique(acc, 'QUOTED', raw);
}

function extractQuoted(text: string, acc: Map<string, ExtractedEntity>): void {
  const doubleQuote = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = doubleQuote.exec(text)) !== null) pushQuoted(acc, m[1] ?? '');
  const singleQuote = /(?:^|[\s([{,;])'([^']+)'(?=[\s.,;:!?)\]]|$)/g;
  while ((m = singleQuote.exec(text)) !== null) pushQuoted(acc, m[1] ?? '');
}

/** Capitalized multi/single-word sequences not at sentence start. */
function extractProper(
  text: string,
  acc: Map<string, ExtractedEntity>,
  opts: { keepLoneCapitals: boolean } = { keepLoneCapitals: true },
): void {
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/).filter(Boolean);
    let run: string[] = [];
    let runStartIdx = -1;
    const flush = (): void => {
      if (run.length > 0) {
        // strip trailing glue words
        while (run.length > 0 && PROPER_GLUE.has((run[run.length - 1] ?? '').toLowerCase())) run.pop();
        // Drop a LONE sentence-initial capital that is a common starter stopword
        // (e.g. "The", "Today", "I") — but keep multi-word runs ("John Smith") and
        // lone non-starters ("Google"). Fixes the sentence-initial recall edge.
        // #111 (global corpora): for non-English text the EN starter list cannot apply,
        // so ANY lone sentence-initial capital is dropped by POSITION (no per-language
        // vocabulary) — "Não"/"Aber"/"Entonces" are casing artifacts, while multi-word
        // runs ("São Paulo", "Claude Code") always survive.
        const loneSentenceInitial = run.length === 1 && runStartIdx === 0;
        const dropLone = loneSentenceInitial
          ? opts.keepLoneCapitals
            ? SENTENCE_STARTERS.has((run[0] ?? '').toLowerCase())
            : true
          : false;
        if (run.length > 0 && !dropLone) pushUnique(acc, 'PROPER', run.join(' '));
      }
      run = [];
      runStartIdx = -1;
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i] ?? '';
      // Unicode-aware: keep ANY-script letters (don't strip diacritics — "São" must
      // not become "So") and treat any uppercase letter as a capital ("José", "Über").
      const bare = tok.replace(/[^\p{L}'-]/gu, '');
      const isCap = /^\p{Lu}[\p{L}'-]+$/u.test(bare);
      const isGlue = run.length > 0 && PROPER_GLUE.has(bare.toLowerCase());
      if (isCap) {
        if (run.length === 0) runStartIdx = i;
        run.push(bare);
      } else if (isGlue) {
        run.push(bare.toLowerCase());
      } else {
        flush();
      }
    }
    flush();
  }
}

/**
 * NLP-derived paths, merged (hook: no dup blocks): COMPOUND — multi-word noun
 * phrases with a non-vague modifier (e.g. "machine learning") — and NOUN — single
 * salient nouns (skipped entirely in regex fallback). Both are `nouns()`-derived,
 * English-only signals; the caller gates them off for non-English text (#111).
 */
function extractNlpDerived(
  text: string,
  acc: Map<string, ExtractedEntity>,
  nlp: NlpFactory | undefined,
): void {
  for (const phrase of collectNounPhrases(text, nlp)) {
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const head = (words[words.length - 1] ?? '').toLowerCase();
      const modifier = (words[0] ?? '').toLowerCase();
      if (GENERIC_HEADS.has(head)) continue;
      if (NON_SPECIFIC_ADJ.has(modifier)) continue;
      pushUnique(acc, 'COMPOUND', words.join(' '));
    } else if (nlp !== undefined) {
      const noun = words[0] ?? '';
      if (GENERIC_HEADS.has(noun.toLowerCase())) continue;
      if (/^[a-z]/.test(noun)) pushUnique(acc, 'NOUN', noun);
    }
  }
}

/** NLP nouns() with crash isolation — shared by the compound + noun paths (hook: no dup blocks). */
function safeNouns(text: string, nlp: NlpFactory): string[] {
  try {
    return nlp(text).nouns().out('array');
  } catch {
    return [];
  }
}

function collectNounPhrases(text: string, nlp: NlpFactory | undefined): string[] {
  if (nlp === undefined) {
    // Regex fallback: lowercase bigrams of word characters.
    const out: string[] = [];
    const re = /\b([a-z]+)\s+([a-z]+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push(`${m[1]} ${m[2]}`);
    return out;
  }
  return safeNouns(text, nlp);
}

export class CompromiseEntityExtractor implements EntityExtractor {
  private readonly nlp: NlpFactory | undefined;

  constructor(deps: CompromiseEntityExtractorDeps = {}) {
    const loader = deps.loadNlp ?? defaultLoadNlp;
    let loaded: NlpFactory | undefined;
    try {
      loaded = loader();
    } catch {
      loaded = undefined; // injected loader that throws → regex fallback
    }
    this.nlp = loaded;
  }

  extract(text: string): readonly ExtractedEntity[] {
    // #111 gate 1 (language-independent): scrub redaction markers never become entities.
    const clean = text.replace(REDACTION_MARKER, ' ');
    if (clean.trim().length === 0) return [];
    const acc = new Map<string, ExtractedEntity>();
    extractQuoted(clean, acc);
    // #111 gate 2 (language-agnostic, no per-language lists): this extractor's heuristics
    // are ENGLISH-only. For detected non-English text, the nouns()-derived paths are
    // skipped entirely, and PROPER keeps only multi-word runs (lone sentence-initial
    // capitals like "Não"/"Aber"/"Entonces" are positional artifacts, not entities).
    const lang = detectInputLanguage(clean);
    const isEnglishish = lang === null || lang.iso6391 === 'en';
    extractProper(clean, acc, { keepLoneCapitals: isEnglishish });
    if (isEnglishish) extractNlpDerived(clean, acc, this.nlp);
    return Array.from(acc.values());
  }
}
