/**
 * Case-insensitive, whitespace-trimmed exact-match metric.
 *
 * Returns true when `prediction` and `reference` are equal after Unicode
 * NFC normalization, lowercasing, and trim. Both-empty inputs are
 * considered a match; only-one-empty is not.
 *
 */

function normalize(input: string): string {
  return input.normalize('NFC').trim().toLowerCase();
}

export function calculateExactMatch(prediction: string, reference: string): boolean {
  return normalize(prediction) === normalize(reference);
}
