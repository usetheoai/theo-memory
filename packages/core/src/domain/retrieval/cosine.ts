/**
 * Cosine similarity over two number vectors — the single canonical implementation
 * shared by the post-threshold reranks that measure candidate-to-candidate
 * similarity (MMR diversify + M22 recency-collapse). Extracted so the two stages
 * cannot drift on the similarity definition (DRY).
 *
 * Returns 0 when either vector has zero norm (defensive — a zero-norm vector has
 * no direction, so similarity is undefined; 0 is the neutral "not similar").
 * Compares over the shorter length when the two differ.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
