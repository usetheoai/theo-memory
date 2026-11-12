/**
 * Query↔entity matching for the recall entity boost (M15 / theo-memory#122).
 *
 * Pure domain logic: no I/O, no LLM call on the read path. The write path already
 * paid the extraction cost; paying it again per recall would put a network round-trip
 * on the hot read path.
 *
 * ## Why the query is normalized into the key's alphabet
 *
 * Entity keys are persisted by {@link normalizeEntityKey}
 * (`domain/entity-key.ts`): lowercase, trimmed, whitespace collapsed
 * into `_`. Diacritics survive. So "São Paulo" is stored as `são_paulo`.
 *
 * The BM25 lemmatizer is not a usable counterpart: `lemmatizeForBm25`
 * (`domain/lemmatization.ts`) splits on `/\W+/` without the `u` flag, so `ã` reads as a
 * non-word character and "são paulo" degrades to `["s","o","paulo"]`. Matching those
 * tokens against `normalized_key` would never hit, and the boost would ship permanently
 * zero — theo-memory#122 reintroduced in a form that is harder to notice.
 *
 * Normalizing the query with the SAME function keeps one authoritative representation of
 * the rule, and makes both hard cases work at once: `são_paulo` matches because the
 * query's space became `_` too, and `user_id` matches because its literal `_` was never
 * rewritten. Reverting the key's `_` back to a space would break the second case, since
 * `_` is ambiguous once written — it encodes both "was a space" and "was an underscore".
 *
 * @see {@link entityKeysNamedIn} — the rule, shared with the write path, which links an entity
 *   to the facts that name it.
 */

import { entityKeysNamedIn } from '../entity-key.js';

/**
 * Returns the subset of `entityKeys` mentioned in `query`.
 *
 * An empty or whitespace-only query matches nothing: a naive containment check would let
 * the empty string match every key and boost every candidate.
 *
 * @param query - raw user query text, unnormalized.
 * @param entityKeys - `normalized_key` values as persisted by the write path.
 */
export function matchEntityKeysInQuery(
  query: string,
  entityKeys: readonly string[],
): readonly string[] {
  return entityKeysNamedIn(query, entityKeys);
}

/**
 * Counts, per memory, how many DISTINCT entities mentioned in the query are linked to it —
 * the `numLinked` that {@link entityBoost} turns into a score contribution.
 *
 * Memories with no matched entity are absent from the result rather than present with a
 * zero. That keeps `entityBoostById.size > 0` an honest predicate for "the entity signal
 * actually contributed", which is what the pipeline uses to decide whether the signal is
 * active for this query.
 *
 * Each distinct key is matched against the query once for the whole candidate set, not once
 * per memory: candidates share entities heavily (that is precisely why they are candidates),
 * so per-memory matching would redo the same comparisons across the whole over-fetch window.
 *
 * @param query - raw user query text, unnormalized.
 * @param linkedKeysByMemory - memory id to the `normalized_key` values linked to it. The
 *   store returns one row per link, so the same key may legitimately appear twice; counting
 *   occurrences instead of distinct entities would inflate the boost.
 */
export function countMatchedEntitiesPerMemory(
  query: string,
  linkedKeysByMemory: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const distinctKeys = new Set<string>();
  for (const keys of linkedKeysByMemory.values()) {
    for (const key of keys) {
      distinctKeys.add(key);
    }
  }

  const matchedKeys = new Set(matchEntityKeysInQuery(query, [...distinctKeys]));
  const counts = new Map<string, number>();
  if (matchedKeys.size === 0) {
    return counts;
  }

  for (const [memoryId, keys] of linkedKeysByMemory) {
    const hits = new Set(keys.filter((key) => matchedKeys.has(key)));
    if (hits.size > 0) {
      counts.set(memoryId, hits.size);
    }
  }
  return counts;
}
