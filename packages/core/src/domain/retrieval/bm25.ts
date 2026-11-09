/**
 * Okapi BM25 with the Lucene IDF, the lexical score the recall pipeline expects from
 * `VectorStore.keywordSearch` (its sigmoid normalization is centered on raw BM25 values).
 *
 *   idf(t)   = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
 *   score(d) = Σ_t idf(t) · tf(t,d)·(k1 + 1) / (tf(t,d) + k1·(1 - b + b·|d| / avgdl))
 *
 * k1 and b are the standard published defaults, not values fitted to any dataset.
 * The corpus is the set of rows the search is scoped to.
 */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export interface Bm25Document {
  readonly id: string;
  /** The document's terms in order, repeats included (term frequency and length come from it). */
  readonly terms: readonly string[];
}

export function bm25Scores(queryTerms: readonly string[], docs: readonly Bm25Document[]): Map<string, number> {
  const query = new Set(queryTerms);
  const scores = new Map<string, number>();
  if (query.size === 0 || docs.length === 0) return scores;
  const avgdl = docs.reduce((sum, d) => sum + d.terms.length, 0) / docs.length;
  const tfByDoc = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const term of d.terms) if (query.has(term)) tf.set(term, (tf.get(term) ?? 0) + 1);
    return tf;
  });
  const df = new Map<string, number>();
  for (const tf of tfByDoc) for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const n = docs.length;
  docs.forEach((d, i) => {
    const tf = tfByDoc[i]!;
    if (tf.size === 0) return;
    let score = 0;
    for (const [term, f] of tf) {
      const dfT = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5));
      score += (idf * f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * d.terms.length) / avgdl));
    }
    scores.set(d.id, score);
  });
  return scores;
}
