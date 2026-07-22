/**
 * English word lists consumed by the CompromiseEntityExtractor heuristics.
 * Pure vocabulary data (no logic) — split from compromise-entity-extractor.ts
 * per the 300-line module budget (SRP: data vs extraction logic). These lists
 * are ENGLISH-only BY DESIGN: for non-English text the extractor gates the
 * heuristic paths off entirely (#111) instead of growing per-language lists.
 */

/** Words too generic to be a useful entity head. */
export const GENERIC_HEADS = new Set<string>([
  'thing', 'things', 'stuff', 'way', 'time', 'experience', 'situation', 'case',
  'fact', 'matter', 'issue', 'idea', 'thought', 'feeling', 'place', 'area',
  'part', 'kind', 'type', 'sort', 'lot', 'bit', 'day', 'year', 'week', 'month',
  'moment', 'instance', 'example', 'technique', 'method', 'approach', 'process',
  'step', 'tool', 'result', 'outcome', 'goal', 'task', 'item', 'topic',
]);

/** Adjectives too vague to make a compound specific. */
export const NON_SPECIFIC_ADJ = new Set<string>([
  'many', 'few', 'several', 'some', 'any', 'all', 'most', 'more', 'less', 'much',
  'little', 'enough', 'various', 'numerous', 'multiple', 'great', 'good', 'bad',
  'nice', 'best', 'worst', 'new', 'old', 'recent', 'current', 'previous', 'next',
  'last', 'first', 'other', 'another', 'such', 'certain', 'important', 'main',
  'major', 'minor', 'key', 'primary', 'real', 'whole', 'entire', 'full',
  'complete', 'total', 'basic', 'simple', 'general', 'common', 'usual', 'normal',
]);

/** Capitalization-insensitive function words that may glue a proper sequence. */
export const PROPER_GLUE = new Set<string>(['of', 'the', 'and', 'for', 'in', 'at']);

/** Function words that, when a candidate STARTS or ENDS with them (or consists
 *  entirely of them), mark the candidate as a predicate/clause fragment rather
 *  than an entity — e.g. "is a", "on the", "and commutes", "lives in", "s skip".
 *  These leak from `nouns()` over-matching and the regex-fallback bigrams. */
export const BOUNDARY_STOP = new Set<string>([
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
export const CONJUGATED_VERB = new Set<string>([
  'uses', 'used', 'using', 'lives', 'lived', 'living', 'commutes', 'commuted',
  'commuting', 'works', 'worked', 'working', 'reports', 'reported', 'reporting',
  'studies', 'studied', 'acquires', 'acquired', 'manages', 'managed', 'managing',
  'builds', 'built', 'knows', 'knew', 'knowing', 'runs', 'ran', 'running', 'makes',
  'made', 'making', 'leads', 'led', 'leading', 'joins', 'joined', 'joining',
  'leaves', 'left', 'leaving', 'owns', 'owned', 'owning', 'likes', 'liked',
  'wants', 'wanted', 'needs', 'needed', 'gets', 'got', 'getting', 'goes', 'went',
  'going', 'comes', 'came', 'coming', 'is', 'are', 'was', 'were',
]);

/** Common sentence-initial words that are NOT proper nouns even when capitalized.
 *  A LONE sentence-initial capital matching this set is dropped (precision); a
 *  capital that starts a multi-word run, or a non-starter like "Google", is kept
 *  (recall) — fixes the sentence-initial truncation edge from the /review. */
export const SENTENCE_STARTERS = new Set<string>([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'i', 'we', 'he', 'she',
  'they', 'it', 'you', 'my', 'our', 'your', 'his', 'her', 'their', 'today',
  'yesterday', 'tomorrow', 'then', 'there', 'here', 'when', 'where', 'why',
  'how', 'what', 'who', 'if', 'so', 'but', 'and', 'or', 'now', 'later',
]);

