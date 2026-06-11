/**
 * Token-set F1 score, SQuAD-style.
 *
 * Tokenization: lowercase + common-punctuation strip + whitespace split +
 * deduplicate (set semantics, no double-counting of repeated tokens).
 *
 * SQuAD convention for empty cases:
 * - both prediction and reference empty → 1.0 (vacuous-perfect)
 * - only one empty → 0.0 (no signal)
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.1
 */

function tokenize(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[.,!?;:()'"]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function calculateF1Score(prediction: string, reference: string): number {
  const pred = tokenize(prediction);
  const ref = tokenize(reference);

  if (pred.size === 0 && ref.size === 0) {
    return 1.0;
  }
  if (pred.size === 0 || ref.size === 0) {
    return 0.0;
  }

  let common = 0;
  for (const token of pred) {
    if (ref.has(token)) {
      common += 1;
    }
  }

  if (common === 0) {
    return 0.0;
  }

  const precision = common / pred.size;
  const recall = common / ref.size;
  return (2 * precision * recall) / (precision + recall);
}
