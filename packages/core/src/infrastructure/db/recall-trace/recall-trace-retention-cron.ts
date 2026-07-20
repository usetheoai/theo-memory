/**
 * recall-trace-retention-and-mcp M4 T3.1 — the periodic driver for the retention
 * sweep. A thin `croner` cron (Rule 9 — croner already installed) that calls
 * `RecallTraceRetentionPolicy.sweep` on a schedule + emits an OTel counter of
 * rows deleted. Wired at the composition root (run-server) under THEOMEM_RECALL_TRACE.
 *
 * TimeBasedTrigger (eviction) is coupled to EvictionPolicy, so we use croner
 * directly here rather than shoehorn it (KISS).
 */
import { metrics } from '@opentelemetry/api';
import { Cron } from 'croner';

import type { RecallTraceRetentionPolicy } from '../../../domain/dip/recall-trace-store.js';

export interface RecallTraceRetentionCronOptions {
  /** Rows older than this are swept. */
  readonly maxAgeSeconds: number;
  /** Cron expression (croner). Default daily at 03:00. */
  readonly cronExpression?: string;
  /** Test hook — invoked after each sweep with the deleted count. */
  readonly onTick?: (deleted: number) => void;
}

const DEFAULT_CRON = '0 3 * * *'; // daily 03:00

/** The unit of work each tick runs — sweep + emit the OTel counter. Exported for testing. */
export async function recallTraceRetentionTick(
  retention: RecallTraceRetentionPolicy,
  maxAgeSeconds: number,
): Promise<number> {
  const deleted = await retention.sweep(maxAgeSeconds);
  if (deleted > 0) {
    metrics
      .getMeter('@usetheo/memory/recall-trace')
      .createCounter('recall_trace_swept')
      .add(deleted);
  }
  return deleted;
}

/**
 * Start the retention cron. Returns a `{ stop }` handle whose `stop()` is async:
 * it halts future ticks AND awaits the in-flight tick (if any) so a caller can
 * drain a mid-DELETE sweep before closing the pool (FX5 /review M4-R5). Idempotent.
 * A tick failure is logged, never crashes the process (the next tick retries).
 */
export function startRecallTraceRetentionCron(
  retention: RecallTraceRetentionPolicy,
  options: RecallTraceRetentionCronOptions,
): { stop: () => Promise<void> } {
  const expr = options.cronExpression ?? DEFAULT_CRON;
  // Track the in-flight tick so stop() can await it (drain-on-shutdown).
  let inFlight: Promise<void> = Promise.resolve();
  const job = new Cron(expr, () => {
    inFlight = recallTraceRetentionTick(retention, options.maxAgeSeconds)
      .then((deleted) => {
        options.onTick?.(deleted);
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[recall-trace-retention] sweep tick failed:', err);
      });
  });
  return {
    stop: async () => {
      job.stop();
      await inFlight; // drain a tick that is mid-sweep before the pool closes
    },
  };
}
