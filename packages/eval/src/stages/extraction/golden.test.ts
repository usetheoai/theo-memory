/**
 * T3.1 — extraction golden set. Guards against the F-M5 vacuous-fixtures
 * failure mode: the set MUST carry negative (noise-only -> zero facts, the #111
 * function-word case) and ambiguous cases, not only easy proper-noun hits.
 */
import { describe, expect, it } from 'vitest';

import {
  ExtractionFixtureSchema,
  countByKind,
  loadExtractionGolden,
} from './golden.js';

describe('extraction golden', () => {
  it('test_extraction_golden_has_negative_and_ambiguous_cases', () => {
    const rows = loadExtractionGolden();
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const counts = countByKind(rows);
    expect(counts.negative).toBeGreaterThanOrEqual(3);
    expect(counts.ambiguous).toBeGreaterThanOrEqual(3);
    expect(counts.hard).toBeGreaterThanOrEqual(1);
    // Every negative case declares zero expected entities (the contract).
    for (const r of rows) {
      if (r.kind === 'negative') expect(r.expectedEntities).toHaveLength(0);
    }
  });

  it('NEGATIVE: a malformed fixture throws a ZodError', () => {
    // Bad `kind`.
    expect(() =>
      ExtractionFixtureSchema.parse({ id: 'x', kind: 'nope', text: 't', expectedEntities: [] }),
    ).toThrow();
    // A negative fixture that declares entities violates the contract.
    expect(() =>
      ExtractionFixtureSchema.parse({
        id: 'x',
        kind: 'negative',
        text: 'the of and',
        expectedEntities: ['Google'],
      }),
    ).toThrow();
    // Missing required field.
    expect(() => ExtractionFixtureSchema.parse({ id: 'x', kind: 'hard' })).toThrow();
  });
});
