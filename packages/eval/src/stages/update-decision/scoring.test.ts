import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PAIR_LABELS, summarizeDecisions, type UpdatePair } from './scoring.js';

function pair(id: string, label: UpdatePair['label']): UpdatePair {
  return { id, label, language: 'en', dateA: '2020-01-01', dateB: '2024-01-01', textA: 'a', textB: 'b', valueA: 'a', valueB: 'b' };
}

describe('summarizeDecisions', () => {
  const pairs = [pair('u1', 'update'), pair('u2', 'update'), pair('c1', 'correction'), pair('p1', 'different-period'), pair('r1', 'restated'), pair('m1', 'additional-value')];

  it('counts an ended update or correction as found', () => {
    const summary = summarizeDecisions(pairs, new Map([['u1', true], ['u2', false], ['c1', true], ['p1', false], ['r1', false], ['m1', false]]));

    expect([summary.found.count, summary.found.of]).toEqual([2, 3]);
    expect([summary.wronglyEnded.count, summary.wronglyEnded.of]).toEqual([0, 3]);
  });

  it('counts an ended note that stays true as wrongly ended', () => {
    const summary = summarizeDecisions(pairs, new Map([['u1', true], ['u2', true], ['c1', true], ['p1', true], ['r1', false], ['m1', true]]));

    expect([summary.wronglyEnded.count, summary.wronglyEnded.of]).toEqual([2, 3]);
    expect(summary.byLabel['different-period']).toEqual({ ended: 1, of: 1 });
  });

  it('a decision that ends everything finds every update and is wrong on every other pair', () => {
    const summary = summarizeDecisions(pairs, new Map(pairs.map((p) => [p.id, true])));

    expect([summary.found.count, summary.wronglyEnded.count]).toEqual([3, 3]);
  });

  it('rejects a pair with no decision', () => {
    expect(() => summarizeDecisions(pairs, new Map([['u1', true]]))).toThrow("No decision recorded for pair 'u2'.");
  });
});

describe('the committed pair set', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pairs = JSON.parse(readFileSync(resolve(here, 'pairs.json'), 'utf8')) as UpdatePair[];

  it('has at least 30 pairs of each label, in English and Portuguese', () => {
    for (const label of PAIR_LABELS) {
      const ofLabel = pairs.filter((p) => p.label === label);
      expect(ofLabel.length, label).toBeGreaterThanOrEqual(30);
      expect(new Set(ofLabel.map((p) => p.language))).toEqual(new Set(['en', 'pt']));
    }
  });

  it('writes the second note after the first and names each value in its note', () => {
    expect(pairs.filter((p) => p.dateB <= p.dateA || !p.textA.includes(p.valueA) || !p.textB.includes(p.valueB))).toEqual([]);
  });
});
