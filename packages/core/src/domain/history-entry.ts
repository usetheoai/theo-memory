/**
 * Audit-trail entry for a single memory mutation event.
 * Produced by the HistoryManager DIP; consumed by Memory.history().
 *
 * @see ADR-0003 — ADD-only public API: every event is a new fact + soft delete.
 * @see ADR-0008 — DIP method counts (HistoryManager required methods 4).
 */

/** What a history row records. `supersede` marks a memory a newer one replaced (ADR-0029). */
export type HistoryAction = 'remember' | 'forget' | 'reflect' | 'supersede';

export interface HistoryEntry {
  readonly action: HistoryAction;
  readonly at: Date;
  readonly previousValue: string | null;
  readonly newValue: string | null;
}
