/**
 * OTel metrics for the v1.5 semantic recall cache — Item 19 AC#2.
 *
 * Lazy-init pattern per `src/local/eviction/pg-evictor.ts:56-75` (F-dom-6
 * v0.4b-fixes T10.1): resolves the Meter on FIRST observation instead of at
 * module load. Consumers that register their MeterProvider AFTER importing
 * `@usetheo/memory` (the canonical boot order
 * `createLocalMemory() → MeterProvider.setGlobalMeterProvider(...)`)
 * see emissions routed to their provider. Module-load resolution would
 * capture the no-op default provider permanently — the F-dom-6 bug fixed
 * there is what we're avoiding here too.
 *
 * Three instruments per blueprint D5 + Item 19 AC#2:
 *   - `theo.memory.recall_cache.hit`               — Counter (INT)
 *   - `theo.memory.recall_cache.hit.duration_ms`   — Histogram (DOUBLE)
 *   - `theo.memory.recall_cache.miss.duration_ms`  — Histogram (DOUBLE)
 *
 * Labels per blueprint D5:
 *   - `scope_tier`   — user / agent / session / repo
 *   - `embedder_kind`— constructor.name of the configured Embedder (best-effort)
 *
 * @see src/local/eviction/pg-evictor.ts § getSoftDeleteCounter (F-dom-6 precedent)
 */
import { metrics, ValueType, type Counter, type Histogram } from '@opentelemetry/api';

const METER_NAME = '@usetheo/memory/cache-pg';

const RECALL_CACHE_HIT_COUNTER_NAME = 'theo.memory.recall_cache.hit';
const RECALL_CACHE_HIT_DURATION_HISTOGRAM_NAME = 'theo.memory.recall_cache.hit.duration_ms';
const RECALL_CACHE_MISS_DURATION_HISTOGRAM_NAME = 'theo.memory.recall_cache.miss.duration_ms';

let lazyHitCounter: Counter | undefined;
let lazyHitDurationHistogram: Histogram | undefined;
let lazyMissDurationHistogram: Histogram | undefined;

export function getRecallCacheHitCounter(): Counter {
  if (lazyHitCounter === undefined) {
    lazyHitCounter = metrics.getMeter(METER_NAME).createCounter(RECALL_CACHE_HIT_COUNTER_NAME, {
      description: 'Number of semantic recall cache hits (cumulative)',
      valueType: ValueType.INT,
    });
  }
  return lazyHitCounter;
}

export function getRecallCacheHitDurationHistogram(): Histogram {
  if (lazyHitDurationHistogram === undefined) {
    lazyHitDurationHistogram = metrics
      .getMeter(METER_NAME)
      .createHistogram(RECALL_CACHE_HIT_DURATION_HISTOGRAM_NAME, {
        description: 'Latency of a recall cache HIT path (ms)',
        unit: 'ms',
        valueType: ValueType.DOUBLE,
      });
  }
  return lazyHitDurationHistogram;
}

export function getRecallCacheMissDurationHistogram(): Histogram {
  if (lazyMissDurationHistogram === undefined) {
    lazyMissDurationHistogram = metrics
      .getMeter(METER_NAME)
      .createHistogram(RECALL_CACHE_MISS_DURATION_HISTOGRAM_NAME, {
        description: 'Latency of a recall cache MISS path (ms)',
        unit: 'ms',
        valueType: ValueType.DOUBLE,
      });
  }
  return lazyMissDurationHistogram;
}

/**
 * @internal Test-only — resets the lazy cache so a subsequent observation
 * re-resolves `metrics.getMeter()` against the now-current MeterProvider.
 * Production paths do NOT call this; instruments are cached for the lifetime
 * of the process per OTel guidance.
 */
export function __resetRecallCacheMetricsForTesting(): void {
  lazyHitCounter = undefined;
  lazyHitDurationHistogram = undefined;
  lazyMissDurationHistogram = undefined;
}
