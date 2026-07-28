/** Unit tests for the bounded-concurrency map used to make the full LongMemEval run feasible. */
import { describe, expect, it } from 'vitest';

import { mapWithConcurrency, runSafely } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves input order (result[i] ↔ items[i]) regardless of completion order', async () => {
    const items = [30, 10, 20, 5];
    // Slower items resolve later, but the output must still line up by index.
    const out = await mapWithConcurrency(items, 2, (n) =>
      new Promise<number>((r) => setTimeout(() => r(n * 2), n)),
    );
    expect(out).toEqual([60, 20, 40, 10]);
  });

  it('never runs more than `limit` at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually parallelised
  });

  it('propagates a rejection (fail-loud — a failed example is never silently dropped)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('limit=1 is exact serial (default harness behavior, unchanged)', async () => {
    const order: number[] = [];
    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 1));
    });
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('runSafely', () => {
  it('returns fn result when it resolves', async () => {
    expect(await runSafely(() => Promise.resolve(42), () => -1)).toBe(42);
  });

  it('routes an Error to onError with its message (never propagates)', async () => {
    const out = await runSafely<{ v: string }>(
      () => Promise.reject(new Error('context_length_exceeded')),
      (m) => ({ v: m }),
    );
    expect(out.v).toBe('context_length_exceeded');
  });

  it('stringifies a non-Error throw defensively', async () => {
    const out = await runSafely<string>(
      // Rejecting with a raw string is the point of this test: it pins that
      // `runSafely` survives a non-Error throw. Satisfying the rule here would
      // delete the behaviour under test.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      () => Promise.reject('raw-string-failure'),
      (m) => m,
    );
    expect(out).toBe('raw-string-failure');
  });
});
