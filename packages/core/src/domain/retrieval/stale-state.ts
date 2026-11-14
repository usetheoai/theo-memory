import type { Tracer } from '@opentelemetry/api';

import { emitEvent } from '../memory-event.js';
import { DURABILITY_KEY, EVENT_START_KEY } from '../memory-time.js';

import type { ScoredRow } from './stages/threshold-filter.js';

function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** A fact the extractor labeled as a state of the moment, with no event date, said before the day of the query. */
function isStaleState(row: ScoredRow, clock: Date): boolean {
  const said = row.payload['t_valid'] ?? row.payload['created_at'];
  if (row.payload[DURABILITY_KEY] !== 'temporary' || row.payload[EVENT_START_KEY] !== undefined || typeof said !== 'string') return false;
  return said.slice(0, 10) < utcDay(clock);
}

/**
 * Puts states of an earlier day after everything else, keeping the order inside each group.
 *
 * A fact labeled as a passing state is no longer ended with its day, because the label is also
 * given to things that last and ending those loses them. It stays stored, and recall shows it
 * only after the facts that are not passing states: it never takes a place above one of them,
 * and it still answers when nothing else does.
 */
export function demoteStaleStates(scored: readonly ScoredRow[], clock: Date, tracer: Tracer | undefined): ScoredRow[] {
  const stale = scored.filter((row) => isStaleState(row, clock));
  if (stale.length === 0) return [...scored];
  emitEvent(tracer, 'recall_stale_state_demoted', { demoted: stale.length });
  return [...scored.filter((row) => !isStaleState(row, clock)), ...stale];
}
