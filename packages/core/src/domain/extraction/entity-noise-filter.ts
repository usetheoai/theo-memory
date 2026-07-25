/**
 * Entity noise filter — a pure, total, deterministic predicate that decides
 * whether an extracted entity surface name is NOISE (a pronoun/contraction,
 * a generic role word, or a verb-led clause fragment) that should NOT become a
 * node in the entity-graph.
 *
 * Applied at the single `linkEntities`/`upsertNodes` chokepoint so it cleans
 * BOTH the LLM-primary and the compromise-fallback node sources, and reused by
 * the compromise extractor for defense-in-depth. Dependency-free (works on every
 * path, including the regex-only fallback).
 *
 * Design (precision without killing recall):
 *  - Drops ONLY KNOWN English noise tokens + structural fragments; unknown /
 *    non-English tokens are KEPT (multilingual surface names like "São Paulo",
 *    "José" must survive).
 *  - The verb-led 2-word rule fires only for perception/desire verbs ("love
 *    science") and never for a capitalized-proper first token ("Love Island")
 *    nor for action verbs that head legitimate noun compounds ("watch list").
 *
 */

/** Bare pronouns (single token). */
const PRONOUNS = new Set<string>([
  'i', 'me', 'we', 'us', 'you', 'he', 'him', 'she', 'her', 'they', 'them', 'it',
]);

/** Pronoun + auxiliary/copula contractions (whole-name match). */
const PRONOUN_CONTRACTIONS = new Set<string>([
  "i'm", "i've", "i'd", "i'll", "we're", "we've", "we'd", "we'll", "you're",
  "you've", "you'd", "you'll", "they're", "they've", "he's", "she's", "it's",
  "that's", "there's", "who's", "what's",
]);

/** Single-token apostrophe remnants left by tokenizers ("I'm" -> "m"). */
const CONTRACTION_REMNANTS = new Set<string>(['m', 're', 've', 'll', 'd', 's', 't']);

/** Role/placeholder words too generic to be a useful entity. */
const GENERIC_ROLE = new Set<string>([
  'user', 'users', 'person', 'people', 'someone', 'somebody', 'anyone',
  'anybody', 'everybody', 'everyone', 'thing', 'things',
]);

/** Perception/desire/cognition verbs that lead a verb+object clause fragment
 *  ("love science", "want coffee"). Action verbs (read/watch/play/make/take/
 *  get/see/think/feel) are DELIBERATELY EXCLUDED — they head legitimate noun
 *  compounds ("watch list", "read me", "think tank", "feel good") and dropping
 *  them would regress recall (EC-2). */
const PERCEPTION_DESIRE_VERB = new Set<string>([
  'love', 'like', 'want', 'need', 'hate', 'enjoy', 'prefer', 'dislike',
]);

/**
 * Closed-class function words (PT + EN articles / prepositions / conjunctions / the PT negation)
 * that carry no entity content. A name whose EVERY token is one of these is noise (#111 — the
 * PT import surfaced `Não`, `o de`, `o` as top entities). DELIBERATELY excludes ambiguous words
 * that can be content ("são" = the verb "are" / part of "São Paulo"; "sim") so multilingual
 * surface names survive. Only names where ALL tokens are function words are dropped, so any
 * single content token ("de Souza", "para Deus") keeps the name.
 */
const FUNCTION_WORDS = new Set<string>([
  // PT
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no',
  'na', 'nos', 'nas', 'e', 'ou', 'que', 'com', 'por', 'para', 'pra', 'ao', 'aos', 'à', 'às',
  'não', 'mais', 'como', 'mas', 'ou', 'num', 'numa',
  // EN
  'the', 'of', 'an', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
]);

/**
 * Returns `true` when `name` should be DROPPED as a noise node. Pure + total:
 * never throws for any input; always returns a boolean.
 */
export function isEntityNoise(name: string): boolean {
  const s = name.trim().toLowerCase();
  if (s.length === 0) return true;

  // #111 deny-list: a scrub redaction marker that survived tokenization as a bare token
  // ("REDACTEDhighentropy" had 158 refs). The extractor strips `[REDACTED:…]` before extraction;
  // this is defense-in-depth for any residual (e.g. re-extracting legacy rows).
  if (s.startsWith('redacted')) return true;

  // Whole-name contraction match ("i'm", "we're") regardless of token count.
  if (PRONOUN_CONTRACTIONS.has(s)) return true;

  const tokens = s.split(/\s+/).filter(Boolean);

  // #111: every token is a closed-class function word (PT/EN) ⇒ no entity content ("não",
  // "o de", "para o"). A single content token anywhere keeps the name (recall over precision).
  if (tokens.every((t) => FUNCTION_WORDS.has(t))) return true;

  if (tokens.length === 1) {
    // Generic-role + contraction remnants are noise regardless of case
    // ("User", "M"). A BARE pronoun is dropped only when lowercase: a
    // capitalized single-token pronoun homograph is very likely a TITLE
    // ("It", "Her", "Us", "Them" are films), so the EC-1 capitalized-proper
    // exception applies here too — keep it (recall over precision per D2).
    if (CONTRACTION_REMNANTS.has(s) || GENERIC_ROLE.has(s)) return true;
    const firstIsProper = /^\p{Lu}/u.test(name.trim());
    return PRONOUNS.has(s) && !firstIsProper;
  }

  if (tokens.length === 2) {
    const first = tokens[0] ?? '';
    // "m reading" — leading contraction remnant.
    if (CONTRACTION_REMNANTS.has(first)) return true;
    // "love science" — perception/desire verb + object, but NOT a capitalized
    // proper compound ("Love Island", EC-1).
    const originalFirst = name.trim().split(/\s+/)[0] ?? '';
    const firstIsProper = /^\p{Lu}/u.test(originalFirst);
    if (PERCEPTION_DESIRE_VERB.has(first) && !firstIsProper) return true;
  }

  return false;
}
