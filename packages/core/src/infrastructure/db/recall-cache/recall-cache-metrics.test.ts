/**
 * T3.1 unit — lazy-init singleton verification for the 3 OTel instruments.
 *
 * Per F-dom-6 v0.4b-fixes T10.1 precedent: instruments MUST resolve on FIRST
 * observation (so a MeterProvider registered post-import is honored), and
 * MUST cache after that (production callers do not want a fresh instrument
 * per emission).
 *
 */
import { afterEach, describe, expect, test } from 'vitest';

import {
  __resetRecallCacheMetricsForTesting,
  getRecallCacheHitCounter,
  getRecallCacheHitDurationHistogram,
  getRecallCacheMissDurationHistogram,
} from './recall-cache-metrics.js';

afterEach(() => {
  __resetRecallCacheMetricsForTesting();
});

describe('T3.1 — recall-cache OTel instrument lazy-init', () => {
  test('T3.1-RED-1a — getRecallCacheHitCounter() returns same Counter across calls', () => {
    const a = getRecallCacheHitCounter();
    const b = getRecallCacheHitCounter();
    expect(a).toBe(b);
  });

  test('T3.1-RED-1b — getRecallCacheHitDurationHistogram() is singleton', () => {
    const a = getRecallCacheHitDurationHistogram();
    const b = getRecallCacheHitDurationHistogram();
    expect(a).toBe(b);
  });

  test('T3.1-RED-1c — getRecallCacheMissDurationHistogram() is singleton', () => {
    const a = getRecallCacheMissDurationHistogram();
    const b = getRecallCacheMissDurationHistogram();
    expect(a).toBe(b);
  });

  test('T3.1-RED-1d — __reset cache + emit Counter.add() does not throw (test-only contract)', () => {
    // Default no-op MeterProvider returns the SAME NoopCounter singleton regardless
    // of createCounter() call count, so we cannot assert identity changes. The
    // observable contract is that emissions on a reset+re-resolved Counter
    // continue to work without throwing. The reset path matters only when a real
    // MeterProvider is installed — covered by the integration test that registers
    // a capturing provider via metrics.setGlobalMeterProvider.
    __resetRecallCacheMetricsForTesting();
    const counter = getRecallCacheHitCounter();
    expect(() => counter.add(1, { scope_tier: 'user', embedder_kind: 'TestEmbedder' })).not.toThrow();
  });
});
