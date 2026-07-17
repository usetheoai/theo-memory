/**
 * Hand-authored near-paraphrase fixture set for principles-alignment-hardening
 * T5.1 + T4.2 — exercises MMR diversify against synthetic high-collinearity
 * candidates.
 *
 * Structure:
 *  - `nearParaphrases` — 10 phrasings of the same intent ("Alice likes coffee").
 *    Recall against any one of them produces 10 high-similarity candidates;
 *    MMR with lambda=0.7 should select fewer than half because the rest are
 *    semantically near-duplicates.
 *  - `distinctFacts` — 5 unrelated facts. MMR should KEEP all of them because
 *    each one's diversity score against the selected set is high.
 *
 * EC-9 disclosure: the 40% reduction target is fixture-dependent. T5.1 will
 * measure empirically; if not met, the commit body discloses retune-with-rationale
 * OR adjust-with-rationale per Inquebrável Rule 3 (NOT silent fixture padding).
 *
 */
export const nearParaphrases: readonly string[] = [
  'Alice likes coffee',
  'Alice prefers coffee',
  'Coffee is a favorite of Alice',
  'Alice enjoys coffee',
  'Alice loves coffee',
  "Alice's favorite drink is coffee",
  'Alice drinks coffee daily',
  'Alice is a coffee drinker',
  'Coffee is what Alice likes',
  'Alice likes drinking coffee',
];

export const distinctFacts: readonly string[] = [
  'Bob is a software engineer in Berlin',
  'The capital of France is Paris',
  'Quantum entanglement violates Bell inequalities',
  'TheMemory ships under MIT license',
  'Postgres 14 introduced multirange types',
];
