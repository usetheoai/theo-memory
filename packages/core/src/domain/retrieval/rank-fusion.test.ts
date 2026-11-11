import { describe, expect, test } from 'vitest';

import { RRF_K, reciprocalRankFusion } from './rank-fusion.js';

describe('reciprocalRankFusion', () => {
  test('sums 1/(k + rank) over the lists that hold each id, best first', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c'], ['c', 'a']]);

    expect(fused.map((f) => f.id)).toEqual(['a', 'c', 'b']);
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2));
    expect(fused[2]!.score).toBeCloseTo(1 / (RRF_K + 2));
  });

  test('an id present in one list only still ranks', () => {
    expect(reciprocalRankFusion([['x'], []]).map((f) => f.id)).toEqual(['x']);
  });

  test('ties keep a stable order by id', () => {
    expect(reciprocalRankFusion([['b'], ['a']]).map((f) => f.id)).toEqual(['a', 'b']);
  });

  test('no lists give no result', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  test('uses the published constant k = 60', () => {
    expect(RRF_K).toBe(60);
  });
});
