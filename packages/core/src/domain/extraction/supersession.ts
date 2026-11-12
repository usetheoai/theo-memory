/**
 * Supersession on write (ADR-0029). The extractor may say that a new fact replaces existing
 * memories it was shown; this module turns those prompt ids into invalidations. A replaced
 * memory is never deleted: the store sets its `t_invalid` to the new fact's valid time, so
 * `recall({ asOf })` before that instant still returns it. Every outcome is observable.
 */
import type { Tracer } from '@opentelemetry/api';

import type { HistoryBatchRecord } from '../dip/history-manager.js';
import type { VectorStore } from '../dip/vector-store.js';
import { emitEvent } from '../memory-event.js';
import type { MemoryItem } from '../memory-item.js';
import type { Filters } from '../scope.js';

import { differentPeriods } from './period-anchor.js';

export interface SupersessionRequest {
  /** The persisted memory, with the store's authoritative id. */
  readonly memory: MemoryItem;
  /** The existing-memory ids the extractor listed, as numbered in the prompt. */
  readonly promptIds: readonly string[];
}

export interface SupersessionResult {
  /** Memory id → ids of the memories it invalidated. Only memories that invalidated something. */
  readonly supersededBy: ReadonlyMap<string, readonly string[]>;
  readonly history: readonly HistoryBatchRecord[];
}

/**
 * Invalidate what each request names. Ids the prompt never showed, the memory itself, and a
 * memory about a different explicit period than the new fact (a 2023 count is not a version of
 * the 2024 count, #252) are rejected (`supersession_rejected`). Memories the store declines, because they are no
 * longer current or became valid after `at`, are reported as `supersession_skipped`.
 */
export async function applySupersessions(
  requests: readonly SupersessionRequest[],
  shown: ReadonlyMap<number, { readonly id: string; readonly text: string }>,
  filters: Filters,
  at: Date,
  store: Pick<VectorStore, 'supersede'>,
  tracer: Tracer | undefined,
): Promise<SupersessionResult> {
  const supersededBy = new Map<string, readonly string[]>();
  const history: HistoryBatchRecord[] = [];
  const pending = requests.filter((request) => request.promptIds.length > 0);
  if (pending.length === 0) return { supersededBy, history };
  if (store.supersede === undefined) {
    emitEvent(tracer, 'supersession_skipped', { reason: 'unsupported_store', count: pending.length });
    return { supersededBy, history };
  }
  for (const { memory, promptIds } of pending) {
    const targets = new Map<string, string>();
    for (const promptId of promptIds) {
      const target = /^\d+$/.test(promptId) ? shown.get(Number(promptId)) : undefined;
      if (target === undefined || target.id === memory.id) {
        emitEvent(tracer, 'supersession_rejected', { reason: target === undefined ? 'unknown_id' : 'self' });
        continue;
      }
      if (differentPeriods(memory.text, target.text)) {
        emitEvent(tracer, 'supersession_rejected', { reason: 'different_period' });
        continue;
      }
      targets.set(target.id, target.text);
    }
    if (targets.size === 0) continue;
    const invalidated = await store.supersede(filters, [...targets.keys()], { memoryId: memory.id, at });
    const declined = targets.size - invalidated.length;
    if (declined > 0) emitEvent(tracer, 'supersession_skipped', { reason: 'not_current_or_newer', count: declined });
    if (invalidated.length === 0) continue;
    supersededBy.set(memory.id, invalidated);
    emitEvent(tracer, 'memory_superseded', { count: invalidated.length });
    for (const id of invalidated) {
      history.push({ memoryId: id, previousValue: targets.get(id) ?? null, newValue: memory.text, action: 'supersede' });
    }
  }
  return { supersededBy, history };
}
