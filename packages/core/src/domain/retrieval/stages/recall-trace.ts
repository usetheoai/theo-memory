/**
 * explainable-recall (S1) — fail-soft write of the dropped-candidate trace (M19 / #124;
 * extracted from pipeline.ts).
 *
 * NO-OP unless BOTH `recallTrace` AND `recallTraceContext` are set (EC-5). Truncates to
 * `context.maxRows` and emits `recall_trace_truncated` when it clips (EC-4). A store failure emits
 * `recall_trace_write_failed` and is swallowed — the recall result is NEVER affected (D3).
 *
 * Takes only the narrow slice of the pipeline deps it needs (ISP) rather than the whole
 * `RetrievalDeps`, which also keeps this leaf module free of an import cycle with pipeline.ts.
 */
import type { Tracer } from '@opentelemetry/api';

import type { RecallTraceStore } from '../../dip/recall-trace-store.js';
import { emitEvent } from '../../memory-event.js';

import type { DroppedCandidate } from './threshold-filter.js';

export interface RecallTraceDeps {
  readonly recallTrace?: RecallTraceStore;
  readonly recallTraceContext?: {
    readonly recallId: string;
    readonly workspaceId: string;
    readonly scopeKey: string;
    readonly maxRows: number;
  };
  readonly tracer?: Tracer;
}

export async function writeRecallTrace(
  deps: RecallTraceDeps,
  drops: DroppedCandidate[],
  keptIds: ReadonlySet<string>,
): Promise<void> {
  const store: RecallTraceStore | undefined = deps.recallTrace;
  const context = deps.recallTraceContext;
  if (store === undefined || context === undefined) {
    return;
  }
  // Never report a candidate that ENDED UP in the returned set as "dropped": the opt-in
  // adaptive-relax (Step 8.6) / graph-expansion (Step 8.7) stages rebind `scored` and can
  // resurface a primary-pass drop into the final set. Pruning against the kept ids keeps the
  // trace consistent with what was returned (Princípio 3 — the trace must be justifiable).
  const filtered = keptIds.size === 0 ? drops : drops.filter((d) => !keptIds.has(d.memoryId));
  const rows = filtered.slice(0, context.maxRows);
  if (filtered.length > rows.length) {
    emitEvent(deps.tracer, 'recall_trace_truncated', {
      dropped_total: drops.length,
      persisted: rows.length,
    });
  }
  if (rows.length === 0) {
    return;
  }
  try {
    await store.record({
      recallId: context.recallId,
      workspaceId: context.workspaceId,
      scopeKey: context.scopeKey,
      rows,
    });
  } catch (err) {
    emitEvent(deps.tracer, 'recall_trace_write_failed', { error: String(err) });
  }
}
