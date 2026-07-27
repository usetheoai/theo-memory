/**
 * M28 (#157) — speaker alias for the recall LEXICAL path.
 *
 * The write path normalizes the first-person speaker to the token `user`
 * (`extraction/prompt.ts`: "represent the speaker as ONE consistent entity named exactly
 * `user`"). So a speaker's own fact is stored as "user works as a platform engineer", NOT
 * "o usuário trabalha…". A Portuguese query that refers to the speaker ("profissão do
 * usuário", "o que você faz") therefore fails to lexically match (BM25 `plainto_tsquery` +
 * entity key) the speaker's facts — and instead matches other facts that literally contain
 * "usuário" (cross-validation vs mem0, 2026-07-27: "profissão do usuário" returned the café
 * fact at top-1).
 *
 * This is a QUERY-side, LEXICAL-only alias: when the query refers to the speaker, append the
 * `user` token so the BM25 keyword search and the entity match reach the speaker's facts. It
 * is NOT applied to the semantic embedding (semantics already handle meaning) — kept minimal
 * to avoid over-boosting the speaker on non-speaker queries (plan Risk R1; guarded by the A/B
 * regression). Conservative trigger set: only unambiguous speaker references.
 */

/** Whole-word, accent-tolerant speaker references (PT + EN). Deliberately narrow. */
const SPEAKER_TERMS = ['usuário', 'usuario', 'você', 'voce', 'user'] as const;

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

function containsWord(lowerText: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(word, from);
    if (at === -1) return false;
    const before = at - 1;
    const after = at + word.length;
    const beforeOk = before < 0 || !WORD_CHAR_RE.test(lowerText.charAt(before));
    const afterOk = after >= lowerText.length || !WORD_CHAR_RE.test(lowerText.charAt(after));
    if (beforeOk && afterOk) return true;
    from = at + 1;
  }
}

/** True when the query unambiguously refers to the speaker (the `user`). */
export function isSpeakerReferring(query: string): boolean {
  const q = query.toLowerCase();
  return SPEAKER_TERMS.some((t) => containsWord(q, t));
}

/**
 * Return the query for the LEXICAL path (BM25 + entity match). When the query refers to the
 * speaker and does not already contain the `user` token, append it so the speaker's own facts
 * (stored under `user`) are reachable. Otherwise return the query unchanged (byte-identical —
 * non-speaker queries are never touched).
 */
export function withSpeakerAlias(query: string): string {
  if (!isSpeakerReferring(query)) return query;
  if (containsWord(query.toLowerCase(), 'user')) return query;
  return `${query} user`;
}
