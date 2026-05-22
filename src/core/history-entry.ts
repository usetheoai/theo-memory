/**
 * Audit-trail entry for a single memory mutation event.
 * Produced by the HistoryManager DIP; consumed by Memory.history().
 *
 * @see ADR-0003 — ADD-only public API: every event is a new fact + soft delete.
 * @see ADR-0008 — DIP method counts (HistoryManager required methods 4).
 */

export interface HistoryEntry {
  readonly action: 'remember' | 'forget' | 'reflect';
  readonly at: Date;
  readonly previousValue: string | null;
  readonly newValue: string | null;
}
