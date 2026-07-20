/**
 * Unit test for validateRecallTraceStoreConfig (T0.1).
 *
 * EC-1: `maxRowsPerRecall` MUST be a positive integer ≤ MAX_ROWS_PER_RECALL
 * (5000) — the Postgres 65 535 bind-param guard. NaN / Infinity / non-integer
 * silently pass a bare `<= 0 || > 5000` comparison (IEEE 754 gap, mirrors the
 * `validateRecallCacheStoreConfig` Number.isFinite precedent), so the validator
 * uses an integer+range guard.
 *
 * @see plan explainable-recall § Phase 0 / T0.1
 */
import { describe, expect, test } from 'vitest';

import { InvalidRecallTraceConfig } from '../errors.js';

import {
  DEFAULT_MAX_ROWS_PER_RECALL,
  MAX_ROWS_PER_RECALL,
  validateRecallTraceStoreConfig,
} from './recall-trace-store.js';

describe('validateRecallTraceStoreConfig', () => {
  test('test_validate_config_accepts_bounds — undefined, 1 (min), 5000 (max)', () => {
    expect(() => validateRecallTraceStoreConfig({})).not.toThrow();
    expect(() => validateRecallTraceStoreConfig({ maxRowsPerRecall: 1 })).not.toThrow();
    expect(() =>
      validateRecallTraceStoreConfig({ maxRowsPerRecall: MAX_ROWS_PER_RECALL }),
    ).not.toThrow();
  });

  test('test_validate_config_rejects_nonpositive — 0 and negative throw InvalidRecallTraceConfig', () => {
    expect(() => validateRecallTraceStoreConfig({ maxRowsPerRecall: 0 })).toThrow(
      InvalidRecallTraceConfig,
    );
    expect(() => validateRecallTraceStoreConfig({ maxRowsPerRecall: -1 })).toThrow(
      InvalidRecallTraceConfig,
    );
  });

  test('test_validate_config_rejects_over_max — 5001 throws InvalidRecallTraceConfig (EC-1)', () => {
    expect(() =>
      validateRecallTraceStoreConfig({ maxRowsPerRecall: MAX_ROWS_PER_RECALL + 1 }),
    ).toThrow(InvalidRecallTraceConfig);
  });

  test('rejects non-integer / NaN / Infinity (IEEE 754 gap)', () => {
    expect(() => validateRecallTraceStoreConfig({ maxRowsPerRecall: 3.5 })).toThrow(
      InvalidRecallTraceConfig,
    );
    expect(() => validateRecallTraceStoreConfig({ maxRowsPerRecall: Number.NaN })).toThrow(
      InvalidRecallTraceConfig,
    );
    expect(() =>
      validateRecallTraceStoreConfig({ maxRowsPerRecall: Number.POSITIVE_INFINITY }),
    ).toThrow(InvalidRecallTraceConfig);
  });

  test('DEFAULT_MAX_ROWS_PER_RECALL is a valid in-bounds default', () => {
    expect(DEFAULT_MAX_ROWS_PER_RECALL).toBeGreaterThan(0);
    expect(DEFAULT_MAX_ROWS_PER_RECALL).toBeLessThanOrEqual(MAX_ROWS_PER_RECALL);
    expect(() =>
      validateRecallTraceStoreConfig({ maxRowsPerRecall: DEFAULT_MAX_ROWS_PER_RECALL }),
    ).not.toThrow();
  });
});
