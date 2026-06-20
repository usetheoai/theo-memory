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

/** Function words that, when a candidate STARTS or ENDS with them (or consists
 *  entirely of them), mark the candidate as a predicate/clause fragment rather
 *  than an entity — e.g. "is a", "on the", "and commutes", "lives in", "s skip".
 *  These leak from `nouns()` over-matching and the regex-fallback bigrams. */
const BOUNDARY_STOP = new Set<string>([
  // copulas / auxiliaries
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', "'s", 's', "'re", 'do',
  'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
  // articles / determiners / pronouns
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'we', 'they',
  'he', 'she', 'you', 'my', 'our', 'your', 'his', 'her', 'their',
  // prepositions / conjunctions
  'of', 'on', 'in', 'at', 'to', 'for', 'and', 'or', 'but', 'with', 'by', 'from',
  'as', 'than', 'then', 'so', 'about', 'into', 'onto', 'over', 'under',
]);

/** Unambiguously-verbal (conjugated) forms — a candidate whose first or last
 *  token (after boundary-stripping) is one of these is a relation/clause fragment
 *  ("project uses", "lives in"→"lives", "and commutes"→"commutes"), not an entity.
 *  Only conjugated forms (-s / -ed / irregular past) are listed: BASE forms (lead,
 *  run, build, report, study, work, manage…) are noun-homographs ("team lead",
 *  "morning run", "the build") and MUST NOT be dropped — keeps recall on the
 *  English fallback path now that the LLM is the primary node source. */
const CONJUGATED_VERB = new Set<string>([
  'uses', 'used', 'using', 'lives', 'lived', 'living', 'commutes', 'commuted',
  'commuting', 'works', 'worked', 'working', 'reports', 'reported', 'reporting',
  'studies', 'studied', 'acquires', 'acquired', 'manages', 'managed', 'managing',
  'builds', 'built', 'knows', 'knew', 'knowing', 'runs', 'ran', 'running', 'makes',
  'made', 'making', 'leads', 'led', 'leading', 'joins', 'joined', 'joining',
  'leaves', 'left', 'leaving', 'owns', 'owned', 'owning', 'likes', 'liked',
  'wants', 'wanted', 'needs', 'needed', 'gets', 'got', 'getting', 'goes', 'went',
  'going', 'comes', 'came', 'coming', 'is', 'are', 'was', 'were',
]);

/** Trim leading/trailing function words from a candidate and drop predicate/clause
 *  fragments. Returns the cleaned entity name, or `null` when nothing entity-like
 *  remains. Fixes graph noise ("is a", "on the", "project uses", "s skip",
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

/** Common sentence-initial words that are NOT proper nouns even when capitalized.
 *  A LONE sentence-initial capital matching this set is dropped (precision); a
 *  capital that starts a multi-word run, or a non-starter like "Google", is kept
 *  (recall) — fixes the sentence-initial truncation edge from the /review. */
const SENTENCE_STARTERS = new Set<string>([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'i', 'we', 'he', 'she',
  'they', 'it', 'you', 'my', 'our', 'your', 'his', 'her', 'their', 'today',
  'yesterday', 'tomorrow', 'then', 'there', 'here', 'when', 'where', 'why',
  'how', 'what', 'who', 'if', 'so', 'but', 'and', 'or', 'now', 'later',
]);

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
  // "project uses", "s skip", "the machine learning engineer"→"machine learning
  // engineer"). QUOTED spans are intentional, so they bypass the cleaner.
  if (type !== 'QUOTED') {
    const cleaned = cleanCandidateName(name);
    if (cleaned === null || !isMeaningful(cleaned)) return;
    name = cleaned;
  }
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
    let runStartIdx = -1;
    const flush = (): void => {
      if (run.length > 0) {
        // strip trailing glue words
        while (run.length > 0 && PROPER_GLUE.has((run[run.length - 1] ?? '').toLowerCase())) run.pop();
        // Drop a LONE sentence-initial capital that is a common starter stopword
        // (e.g. "The", "Today", "I") — but keep multi-word runs ("John Smith") and
        // lone non-starters ("Google"). Fixes the sentence-initial recall edge.
        const loneSentenceInitialStarter =
          run.length === 1 && runStartIdx === 0 && SENTENCE_STARTERS.has((run[0] ?? '').toLowerCase());
        if (run.length > 0 && !loneSentenceInitialStarter) pushUnique(acc, 'PROPER', run.join(' '));
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
