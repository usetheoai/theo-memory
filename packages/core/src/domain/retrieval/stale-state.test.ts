import { describe, expect, it } from 'vitest';

import { demoteStaleStates } from './stale-state.js';
import type { ScoredRow } from './stages/threshold-filter.js';

const clock = new Date('2026-03-20T10:00:00Z');
const row = (id: string, score: number, payload: Record<string, string | number | boolean | null>): ScoredRow => ({ id, score, payload });

describe('demoteStaleStates', () => {
  it('moves a state of an earlier day after the other rows and keeps the order of each group', () => {
    const rows = [
      row('old-state', 0.9, { durability: 'temporary', t_valid: '2026-03-01T09:00:00.000Z' }),
      row('fact', 0.8, { durability: 'durable', t_valid: '2026-01-01T09:00:00.000Z' }),
      row('older-state', 0.7, { durability: 'temporary', t_valid: '2026-02-01T09:00:00.000Z' }),
      row('legacy', 0.6, { t_valid: '2025-01-01T09:00:00.000Z' }),
    ];
    expect(demoteStaleStates(rows, clock, undefined).map((r) => r.id)).toEqual(['fact', 'legacy', 'old-state', 'older-state']);
  });

  it('leaves a state said on the day of the query where it is', () => {
    const rows = [row('state', 0.9, { durability: 'temporary', t_valid: '2026-03-20T08:00:00.000Z' }), row('fact', 0.8, { durability: 'durable' })];
    expect(demoteStaleStates(rows, clock, undefined).map((r) => r.id)).toEqual(['state', 'fact']);
  });

  it('leaves a temporary fact that has an event date where it is', () => {
    const rows = [
      row('plan', 0.9, { durability: 'temporary', t_valid: '2026-03-01T09:00:00.000Z', event_start: '2026-03-25' }),
      row('fact', 0.8, { durability: 'durable' }),
    ];
    expect(demoteStaleStates(rows, clock, undefined).map((r) => r.id)).toEqual(['plan', 'fact']);
  });

  it('uses the creation time when the row has no valid-from', () => {
    const rows = [row('state', 0.9, { durability: 'temporary', created_at: '2026-03-01T09:00:00.000Z' }), row('fact', 0.8, { durability: 'durable' })];
    expect(demoteStaleStates(rows, clock, undefined).map((r) => r.id)).toEqual(['fact', 'state']);
  });

  it('returns the rows unchanged when none is a stale state', () => {
    const rows = [row('a', 0.9, { durability: 'durable' }), row('b', 0.8, {})];
    expect(demoteStaleStates(rows, clock, undefined)).toEqual(rows);
  });
});
