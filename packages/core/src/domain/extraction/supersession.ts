/**
 * Supersession on write (ADR-0029). The extractor may say that a new fact replaces existing
 * memories it was shown; this module turns those prompt ids into invalidations. A replaced
 * memory is never deleted: the store sets its `t_invalid` to the new fact's valid time, so
 * `recall({ asOf })` before that instant still returns it. Every outcome is observable.
 *
 * The extractor names the pair, and valid time decides which side ends (#253). When the named
 * memory became valid after the fact that is arriving, the arriving fact is the older value: it
 * is stored as already ended at the instant the named memory began.
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
  /** Memory id → the instant it ended, for a new memory that arrived after a newer value of the same thing. */
  readonly endedOnArrival: ReadonlyMap<string, Date>;
  readonly history: readonly HistoryBatchRecord[];
}

interface LaterVersion {
  readonly id: string;
  readonly text: string;
  readonly validFrom: Date;
}

/** Of the memories the store declined, the earliest one that is current and became valid after `at`. */
async function earliestLaterVersion(
  declined: ReadonlyMap<string, string>,
  at: Date,
  store: Pick<VectorStore, 'get'>,
): Promise<LaterVersion | null> {
  let earliest: LaterVersion | null = null;
  for (const [id, text] of declined) {
    const row = await store.get(id);
    const validFrom = row?.payload['t_valid'];
    const invalidFrom = row?.payload['t_invalid'];
    if (typeof validFrom !== 'string' || (invalidFrom !== undefined && invalidFrom !== null)) continue;
    const instant = new Date(validFrom);
    if (Number.isNaN(instant.getTime()) || instant.getTime() <= at.getTime()) continue;
    if (earliest === null || instant.getTime() < earliest.validFrom.getTime()) earliest = { id, text, validFrom: instant };
  }
  return earliest;
}

/**
 * Invalidate what each request names. Ids the prompt never showed, the memory itself, and a
 * memory about a different explicit period than the new fact (a 2023 count is not a version of
 * the 2024 count, #252) are rejected (`supersession_rejected`). A named memory that became valid
 * after `at` ends the new memory at that instant (`memory_ended_on_arrival`). Other memories the
 * store declines, because they are no longer current, are reported as `supersession_skipped`.
 */
export async function applySupersessions(
  requests: readonly SupersessionRequest[],
  shown: ReadonlyMap<number, { readonly id: string; readonly text: string }>,
  filters: Filters,
  at: Date,
  store: Pick<VectorStore, 'supersede' | 'get'>,
  tracer: Tracer | undefined,
): Promise<SupersessionResult> {
  const supersededBy = new Map<string, readonly string[]>();
  const endedOnArrival = new Map<string, Date>();
  const history: HistoryBatchRecord[] = [];
  const pending = requests.filter((request) => request.promptIds.length > 0);
  if (pending.length === 0) return { supersededBy, endedOnArrival, history };
  if (store.supersede === undefined) {
    emitEvent(tracer, 'supersession_skipped', { reason: 'unsupported_store', count: pending.length });
    return { supersededBy, endedOnArrival, history };
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
    const declined = new Map([...targets].filter(([id]) => !invalidated.includes(id)));
    // A declined memory that began after this fact is the newer value: this fact ends where it begins.
    const later = declined.size === 0 ? null : await earliestLaterVersion(declined, at, store);
    if (later !== null) {
      const ended = await store.supersede(filters, [memory.id], { memoryId: later.id, at: later.validFrom });
      if (ended.includes(memory.id)) {
        endedOnArrival.set(memory.id, later.validFrom);
        emitEvent(tracer, 'memory_ended_on_arrival', { count: 1 });
        history.push({ memoryId: memory.id, previousValue: memory.text, newValue: later.text, action: 'supersede' });
        declined.delete(later.id);
      }
    }
    if (declined.size > 0) emitEvent(tracer, 'supersession_skipped', { reason: 'not_current_or_newer', count: declined.size });
    if (invalidated.length === 0) continue;
    supersededBy.set(memory.id, invalidated);
    emitEvent(tracer, 'memory_superseded', { count: invalidated.length });
    for (const id of invalidated) {
      history.push({ memoryId: id, previousValue: targets.get(id) ?? null, newValue: memory.text, action: 'supersede' });
    }
  }
  return { supersededBy, endedOnArrival, history };
}
