import type { MemoryItem } from '@usetheo/memory';

export interface SemanticCase {
  readonly name: string;
  readonly language: 'en' | 'pt';
  readonly input: string;
  readonly expected: readonly { readonly pattern: string; readonly kind: 'stated' | 'inferred' }[];
  readonly forbidden: readonly string[];
}

/**
 * Evaluate coverage separately from precision so empty output cannot pass the gate.
 *
 * Only lasting memories are scored. A passing state of the moment is stored with an end
 * (ADR-0035) and recall stops showing it after the day it was said, so it is not a mood that
 * became a lasting fact. A mood stored with no end still counts as forbidden.
 */
export function scoreCase(fixture: SemanticCase, stored: readonly MemoryItem[]) {
  const items = stored.filter((item) => item.expiresAt === undefined || item.expiresAt === null);
  const used = new Set<number>();
  const matches = fixture.expected.map((expected) => {
    const candidates = items.flatMap((item,index) => !used.has(index) && new RegExp(expected.pattern,'iu').test(item.text) ? [index] : []);
    const selected = candidates.find(index => items[index]?.evidence?.kind === expected.kind) ?? candidates[0];
    if (selected === undefined) return undefined;
    used.add(selected);
    return items[selected];
  });
  const relevant = items.filter((item) => fixture.expected.some((expected) => new RegExp(expected.pattern, 'iu').test(item.text)));
  return {
    expected: fixture.expected.length,
    covered: matches.filter(Boolean).length,
    emitted: items.length,
    relevant: relevant.length,
    classified: matches.filter((item, index) => item?.evidence?.kind === fixture.expected[index]?.kind).length,
    forbidden: items.filter((item) => fixture.forbidden.some((pattern) => new RegExp(pattern, 'iu').test(item.text))).length,
    invalidQuotes: items.filter((item) => item.evidence?.sourceQuote !== undefined && !fixture.input.includes(item.evidence.sourceQuote)).length,
  };
}
