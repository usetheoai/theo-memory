/**
 * Case-insensitive, whitespace-trimmed exact-match metric.
 *
 * Returns true when `prediction` and `reference` are equal after Unicode
 * NFC normalization, lowercasing, and trim. Both-empty inputs are
 * considered a match; only-one-empty is not.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.1
 */

function normalize(input: string): string {
  return input.normalize('NFC').trim().toLowerCase();
}

export function calculateExactMatch(prediction: string, reference: string): boolean {
  return normalize(prediction) === normalize(reference);
}
