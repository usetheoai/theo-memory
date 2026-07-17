import { describe, expect, it } from 'vitest';
import {
  makeHashCounter,
  makeSeededRandom,
  shuffleDeterministic,
} from '../deterministic-hash.js';

/**
 * T11.2 unit tests for the deterministic-hash + Fisher-Yates helpers
 * (closes F-tests-1 + F-tests-2 MAJOR + EC-8 absorption).
 *
 */
describe('makeSeededRandom — LCG output is identical for the same seed across runs', () => {
  it('two RNGs with the same seed emit identical sequences', () => {
    const a = makeSeededRandom(42);
    const b = makeSeededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('two RNGs with different seeds emit different sequences', () => {
    const a = makeSeededRandom(1);
    const b = makeSeededRandom(2);
    let differs = false;
    for (let i = 0; i < 10; i++) {
      if (a() !== b()) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});

describe('shuffleDeterministic — same seed produces byte-identical permutation (EC-8)', () => {
  it('two shuffles with the same seed produce the same array', () => {
    const input = Array.from({ length: 100 }, (_, i) => i);
    const a = shuffleDeterministic(input, 0x4b_11_2);
    const b = shuffleDeterministic(input, 0x4b_11_2);
    expect(a).toEqual(b);
  });

  it('preserves the original input (no mutation)', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffleDeterministic(input, 7);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect(out).not.toBe(input);
  });

  it('different seeds produce different permutations', () => {
    const input = Array.from({ length: 100 }, (_, i) => i);
    const a = shuffleDeterministic(input, 1);
    const b = shuffleDeterministic(input, 2);
    expect(a).not.toEqual(b);
  });
});

describe('makeHashCounter — emits stable monotonic suffixes', () => {
  it('counts from 0 upward', () => {
    const next = makeHashCounter('h-test');
    expect(next()).toBe('h-test-0');
    expect(next()).toBe('h-test-1');
    expect(next()).toBe('h-test-2');
  });

  it('two counters are independent', () => {
    const a = makeHashCounter('a');
    const b = makeHashCounter('b');
    expect(a()).toBe('a-0');
    expect(a()).toBe('a-1');
    expect(b()).toBe('b-0');
    expect(a()).toBe('a-2');
  });
});
