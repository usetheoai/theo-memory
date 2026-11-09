import { describe, expect, test } from 'vitest';

import { validFromOf } from './valid-from.js';

const FALLBACK = new Date('2026-11-07T00:00:00Z');

describe('validFromOf', () => {
  test('reads the valid-from instant the store projected into the row payload', () => {
    expect(validFromOf({ t_valid: '2023-05-08T13:56:00.000Z' }, FALLBACK)).toEqual(new Date('2023-05-08T13:56:00.000Z'));
  });

  test('falls back when the row carries no valid-from instant', () => {
    expect(validFromOf({}, FALLBACK)).toBe(FALLBACK);
  });

  test('falls back when the stored value is null', () => {
    expect(validFromOf({ t_valid: null }, FALLBACK)).toBe(FALLBACK);
  });

  test('falls back when the stored value does not parse as a date', () => {
    expect(validFromOf({ t_valid: 'yesterday' }, FALLBACK)).toBe(FALLBACK);
  });
});
