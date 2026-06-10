import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T10.1 — `PgEvictor` resolves the OTel counter lazily so consumers that
 * register their `MeterProvider` AFTER importing `@usetheo/memory` still see
 * counter emissions routed through their provider. Closes F-dom-6 MAJOR.
 *
 * Pre-T10.1: `metrics.getMeter('@usetheo/memory')` ran at module load time;
 * the default no-op provider was captured permanently; any post-import
 * `metrics.setGlobalMeterProvider(...)` was a no-op for v0.4b counter
 * emissions.
 *
 * Post-T10.1: the counter is materialized on the first `evict()` call via
 * the private `getSoftDeleteCounter()` helper. A test-only
 * `__resetCounterCacheForTesting()` lets this test exercise the
 * "consumer-registers-provider-after-import" sequence deterministically.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T10.1
 * @see .claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md § F-dom-6
 */

describe('T10.1: PgEvictor OTel meter lazy init (F-dom-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves metrics.getMeter() on the FIRST evict() call, not at module load', async () => {
    const otel = await import('@opentelemetry/api');
    const evictorModule = await import('../pg-evictor.js');
    evictorModule.__resetCounterCacheForTesting();

    const getMeterSpy = vi.spyOn(otel.metrics, 'getMeter');

    // Construction must NOT trigger getMeter — that would lock in the
    // current MeterProvider regardless of consumer registration order.
    const evictor = new evictorModule.PgEvictor(
      // pool stub — empty array short-circuits before SQL roundtrip per EC-10
      // so we never actually need a real Pool here.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      { query: vi.fn() } as any,
    );
    expect(getMeterSpy).not.toHaveBeenCalled();

    // First evict() with an empty list still triggers no counter emission
    // (EC-10 short-circuits). Counter materialization still defers to a
    // non-empty call.
    await evictor.evict([]);
    expect(getMeterSpy).not.toHaveBeenCalled();
  });

  it('caches the counter after the first non-empty evict — subsequent evict() calls reuse', async () => {
    const otel = await import('@opentelemetry/api');
    const evictorModule = await import('../pg-evictor.js');
    evictorModule.__resetCounterCacheForTesting();

    const getMeterSpy = vi.spyOn(otel.metrics, 'getMeter');
    const poolStub = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'mem-a' }] }),
    };
        const evictor = new evictorModule.PgEvictor(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      poolStub as any,
    );

    await evictor.evict(['mem-a']);
    const callsAfterFirst = getMeterSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

    poolStub.query.mockResolvedValue({ rows: [{ id: 'mem-b' }] });
    await evictor.evict(['mem-b']);
    // Counter cached — no additional getMeter calls on subsequent evict.
    expect(getMeterSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});
