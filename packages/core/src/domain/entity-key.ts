/**
 * The entity key and the rule that decides whether a text names it.
 *
 * Both the write path (which fact a write links an entity to) and the read path (which
 * entities a query names, for the recall entity boost) use this rule, so a fact the write
 * path links to an entity is exactly a fact the read path would say names it. It lives
 * outside both so neither has to import the other.
 */

/** Lowercase + underscore the surface name → the per-scope dedup key (EC-1). */
export function normalizeEntityKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * A character that can be part of a word, diacritics included. Anything else — `_`, `+`,
 * `#`, `.`, `*` — is a boundary. The `u` flag is what keeps `ã` a letter instead of
 * splitting it, which is precisely where the BM25 lemmatizer fails.
 */
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/** Positions outside the string count as boundaries, so start/end anchor a match. */
function isBoundaryAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return true;
  }
  return !WORD_CHAR_RE.test(text.charAt(index));
}

/**
 * True when `key` occurs in `haystack` delimited by word boundaries, so `paulo` does not
 * match inside `paul_mccartney`.
 *
 * Boundaries are checked by index arithmetic, never by a regex built from the key. Keys
 * come from LLM-emitted entity names, where `C++`, `F#`, `.NET` and `A*` are ordinary;
 * `new RegExp('c++')` throws `SyntaxError: Nothing to repeat`.
 */
function containsAsWord(haystack: string, key: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(key, from);
    if (at === -1) {
      return false;
    }
    if (isBoundaryAt(haystack, at - 1) && isBoundaryAt(haystack, at + key.length)) {
      return true;
    }
    from = at + 1;
  }
}

/**
 * Returns the subset of `entityKeys` that `text` names. The text is normalized with
 * {@link normalizeEntityKey}, so "São Paulo" names `são_paulo` and `user_id` names
 * `user_id`. An empty or whitespace-only text names nothing.
 *
 * @param text - raw text (a query or a memory), unnormalized.
 * @param entityKeys - keys as {@link normalizeEntityKey} produces them.
 */
export function entityKeysNamedIn(text: string, entityKeys: readonly string[]): readonly string[] {
  const normalized = normalizeEntityKey(text);
  if (normalized.length === 0) {
    return [];
  }
  return entityKeys.filter((key) => key.length > 0 && containsAsWord(normalized, key));
}
