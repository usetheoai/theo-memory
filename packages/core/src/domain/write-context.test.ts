import { describe, expect, test } from 'vitest';

import { InvalidScope } from './errors.js';
import { attachWriteContext, OBSERVED_AT_CLOCK_SKEW_MS, validateWriteContext, writeRequestHash } from './write-context.js';

const MESSAGES = [{ role: 'user' as const, content: 'I moved to Lisbon last month' }];
/** writeRequestHash(MESSAGES, { infer: false }) as computed by the function before observedAt existed. */
const LEGACY_HASH_INFER_FALSE = '27d809473f082faed478b11bc808a136b7c99cd000001912bf2a3a99d902af0e';

describe('validateWriteContext observedAt', () => {
  test('accepts an observation time in the past', () => {
    expect(() => validateWriteContext({ observedAt: new Date('2023-05-08T13:56:00Z') })).not.toThrow();
  });

  test('rejects an invalid Date', () => {
    expect(() => validateWriteContext({ observedAt: new Date('not a date') })).toThrow(InvalidScope);
  });

  test('rejects a value that is not a Date', () => {
    expect(() => validateWriteContext({ observedAt: '2023-05-08' as unknown as Date })).toThrow(InvalidScope);
  });

  test('rejects an observation time in the future beyond the clock-skew allowance', () => {
    const future = new Date(Date.now() + OBSERVED_AT_CLOCK_SKEW_MS + 60_000);
    expect(() => validateWriteContext({ observedAt: future })).toThrow(/observedAt/);
  });

  test('accepts an observation time inside the clock-skew allowance', () => {
    const nearFuture = new Date(Date.now() + OBSERVED_AT_CLOCK_SKEW_MS / 2);
    expect(() => validateWriteContext({ observedAt: nearFuture })).not.toThrow();
  });
});

describe('writeRequestHash observedAt', () => {
  test('two writes of the same text observed at different times are different requests', () => {
    const a = writeRequestHash(MESSAGES, { observedAt: new Date('2023-05-08T00:00:00Z') });
    const b = writeRequestHash(MESSAGES, { observedAt: new Date('2023-06-08T00:00:00Z') });
    expect(a).not.toBe(b);
  });

  test('a write without observedAt keeps the hash it had before the option existed', () => {
    // Pinned value: the hash of this exact request before observedAt was added to it.
    expect(writeRequestHash(MESSAGES, { infer: false })).toBe(LEGACY_HASH_INFER_FALSE);
  });
});

describe('attachWriteContext observedAt', () => {
  test('records the observation time as the row valid-from instant', () => {
    const payload: Record<string, string | number | boolean | null> = { text: 'x' };
    attachWriteContext(payload, MESSAGES, { observedAt: new Date('2023-05-08T13:56:00Z') });
    expect(payload['t_valid']).toBe('2023-05-08T13:56:00.000Z');
  });

  test('leaves the valid-from instant to the store when no observation time is given', () => {
    const payload: Record<string, string | number | boolean | null> = { text: 'x', t_valid: 'stale' };
    attachWriteContext(payload, MESSAGES, {});
    expect(payload['t_valid']).toBeUndefined();
  });
});
