/**
 * T5.1 fixtures — 10 hand-authored near-duplicate query pairs for THE GOAL TEST.
 *
 * Each pair `(a, b)` is two phrasings of the same intent. With `threshold=0.8`
 * cosine + `Xenova/all-MiniLM-L6-v2` (the v1.4 LocalTransformerEmbedder default),
 * the cache should hit on `b` when seeded with `a` for ≥ 5 of 10 pairs to
 * satisfy Item 19 acceptance criterion #1 (hit rate ≥ 0.5).
 *
 */
export const NEAR_DUPLICATE_QUERY_PAIRS: readonly { readonly a: string; readonly b: string }[] = [
  { a: 'what is my favorite color?', b: 'what color do I prefer?' },
  { a: 'where do I live?', b: 'what is my home address?' },
  { a: 'do I have any pets?', b: 'what pets do I own?' },
  { a: 'what is my job?', b: 'what do I do for work?' },
  { a: 'when is my birthday?', b: 'what day was I born on?' },
  { a: 'what music do I listen to?', b: 'what kind of music do I enjoy?' },
  { a: 'do I have siblings?', b: 'do I have any brothers or sisters?' },
  { a: 'what is my favorite food?', b: 'what food do I like best?' },
  { a: 'where did I grow up?', b: 'where was I raised?' },
  { a: 'what languages do I speak?', b: 'which languages do I know?' },
];
