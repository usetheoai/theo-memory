/**
 * Reciprocal Rank Fusion: combines ranked lists whose scores live on different scales (BM25
 * and cosine) by rank alone. Each id scores sum(1 / (k + rank)) over the lists that hold it,
 * ranks counted from 1.
 *
 * k = 60 is the constant of the original publication, used unchanged; it was not fitted to
 * any dataset.
 */
export const RRF_K = 60;

export interface FusedRank {
  readonly id: string;
  readonly score: number;
}

export function reciprocalRankFusion(lists: readonly (readonly string[])[], k: number = RRF_K): FusedRank[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
