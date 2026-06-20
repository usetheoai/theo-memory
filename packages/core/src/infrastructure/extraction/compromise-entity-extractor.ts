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
 * @see .claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T1.2
 */
import type { EntityExtractor, EntityType, ExtractedEntity } from '../../domain/dip/entity-extractor.js';

/** Minimum surface length for a candidate to count as an entity (EC-2). */
const MIN_NAME_LENGTH = 2;

/** Words too generic to be a useful entity head. */
const GENERIC_HEADS = new Set<string>([
  'thing', 'things', 'stuff', 'way', 'time', 'experience', 'situation', 'case',
  'fact', 'matter', 'issue', 'idea', 'thought', 'feeling', 'place', 'area',
  'part', 'kind', 'type', 'sort', 'lot', 'bit', 'day', 'year', 'week', 'month',
  'moment', 'instance', 'example', 'technique', 'method', 'approach', 'process',
  'step', 'tool', 'result', 'outcome', 'goal', 'task', 'item', 'topic',
]);

/** Adjectives too vague to make a compound specific. */
const NON_SPECIFIC_ADJ = new Set<string>([
  'many', 'few', 'several', 'some', 'any', 'all', 'most', 'more', 'less', 'much',
  'little', 'enough', 'various', 'numerous', 'multiple', 'great', 'good', 'bad',
  'nice', 'best', 'worst', 'new', 'old', 'recent', 'current', 'previous', 'next',
  'last', 'first', 'other', 'another', 'such', 'certain', 'important', 'main',
  'major', 'minor', 'key', 'primary', 'real', 'whole', 'entire', 'full',
  'complete', 'total', 'basic', 'simple', 'general', 'common', 'usual', 'normal',
]);

/** Capitalization-insensitive function words that may glue a proper sequence. */
const PROPER_GLUE = new Set<string>(['of', 'the', 'and', 'for', 'in', 'at']);

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
  const name = raw.trim();
  if (!isMeaningful(name)) return; // EC-2 drop guard
  const key = `${type}::${name.toLowerCase()}`;
  if (!acc.has(key)) acc.set(key, { type, name });
}

function extractQuoted(text: string, acc: Map<string, ExtractedEntity>): void {
  const doubleQuote = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = doubleQuote.exec(text)) !== null) pushUnique(acc, 'QUOTED', m[1] ?? '');
  const singleQuote = /(?:^|[\s([{,;])'([^']+)'(?=[\s.,;:!?)\]]|$)/g;
  while ((m = singleQuote.exec(text)) !== null) pushUnique(acc, 'QUOTED', m[1] ?? '');
}

/** Capitalized multi/single-word sequences not at sentence start. */
function extractProper(text: string, acc: Map<string, ExtractedEntity>): void {
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/).filter(Boolean);
    let run: string[] = [];
    const flush = (): void => {
      if (run.length > 0) {
        // strip trailing glue words
        while (run.length > 0 && PROPER_GLUE.has((run[run.length - 1] ?? '').toLowerCase())) run.pop();
        if (run.length > 0) pushUnique(acc, 'PROPER', run.join(' '));
      }
      run = [];
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i] ?? '';
      const bare = tok.replace(/[^A-Za-z'-]/g, '');
      const isCap = /^[A-Z][a-z'-]+$/.test(bare);
      const isGlue = run.length > 0 && PROPER_GLUE.has(bare.toLowerCase());
      // skip the sentence-initial capitalized word (i===0) as a lone proper noun
      if (isCap && !(i === 0 && run.length === 0)) {
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

/** Multi-word noun phrases with a non-vague modifier (e.g. "machine learning"). */
function extractCompound(
  text: string,
  acc: Map<string, ExtractedEntity>,
  nlp: NlpFactory | undefined,
): void {
  const nounPhrases = collectNounPhrases(text, nlp);
  for (const phrase of nounPhrases) {
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;
    const head = (words[words.length - 1] ?? '').toLowerCase();
    const modifier = (words[0] ?? '').toLowerCase();
    if (GENERIC_HEADS.has(head)) continue;
    if (NON_SPECIFIC_ADJ.has(modifier)) continue;
    pushUnique(acc, 'COMPOUND', words.join(' '));
  }
}

/** Single salient nouns (NLP-derived; skipped entirely in regex fallback). */
function extractNoun(
  text: string,
  acc: Map<string, ExtractedEntity>,
  nlp: NlpFactory | undefined,
): void {
  if (nlp === undefined) return;
  for (const noun of collectNouns(text, nlp)) {
    const lower = noun.toLowerCase();
    if (GENERIC_HEADS.has(lower)) continue;
    if (noun.split(/\s+/).length === 1 && /^[a-z]/.test(noun)) pushUnique(acc, 'NOUN', noun);
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
  try {
    return nlp(text).nouns().out('array');
  } catch {
    return [];
  }
}

function collectNouns(text: string, nlp: NlpFactory): string[] {
  try {
    return nlp(text).nouns().out('array');
  } catch {
    return [];
  }
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
    if (text.trim().length === 0) return [];
    const acc = new Map<string, ExtractedEntity>();
    extractQuoted(text, acc);
    extractProper(text, acc);
    extractCompound(text, acc, this.nlp);
    extractNoun(text, acc, this.nlp);
    return Array.from(acc.values());
  }
}
