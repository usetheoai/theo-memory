/**
 * T0.1 RED test — `croner` runtime dep availability.
 *
 * Asserts the `croner` package is installed AND exposes the Cron class API
 * that `SleepTimeReflectionPolicy` (T3.1) depends on:
 *   - `new Cron(expression, { paused: true })` — constructor accepts cron string
 *   - `.stop()` — instance method exists (lifecycle hook for cleanup)
 *
 * Per plan v0-4a-reflection-pipeline § T0.1 + ADR D10 (croner runtime dep,
 * exact version pin `^10.0.1` per deps-audit-golden-rule).
 *
 */
import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';

describe('croner runtime dep (T0.1)', () => {
  it('exposes Cron constructor accepting expression + options', () => {
    const job = new Cron('* * * * *', { paused: true });
    expect(job).toBeDefined();
  });

  it('Cron instance exposes .stop() method (T3.1 lifecycle dependency)', () => {
    const job = new Cron('* * * * *', { paused: true });
    expect(typeof job.stop).toBe('function');
  });
});
