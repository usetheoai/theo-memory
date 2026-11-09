/**
 * HistoryManager DIP — adapter contract for audit-trail persistence.
 *
 * @see ADR-0008 — DIP method counts (HistoryManager: 4 required + 3 optional).
 * @see ADR-0003 — ADD-only public API; history is the audit primitive.
 */
import type { HistoryAction, HistoryEntry } from '../history-entry.js';
import type { Message } from '../message.js';

export interface HistoryBatchRecord {
  readonly memoryId: string;
  readonly previousValue: string | null;
  readonly newValue: string | null;
  readonly action: HistoryAction;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  readonly isDeleted?: boolean;
}

export interface HistoryManager {
  /**
   * Persist a single audit-trail event.
   *
   * Notes vs the upstream contract:
   *   - action is the string-union (the upstream uses bare `string`).
   *   - isDeleted is boolean (the upstream uses number).
   *   - createdAt / updatedAt are Date (the upstream uses string; parsing happens at the adapter boundary).
   */
  addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: HistoryAction,
    createdAt?: Date,
    updatedAt?: Date,
    isDeleted?: boolean,
  ): Promise<void>;

  /** Retrieve the chronological audit trail for one memory. */
  getHistory(memoryId: string): Promise<readonly HistoryEntry[]>;

  /** Drop ALL history rows. Administrative operation. */
  reset(): Promise<void>;

  /** Release adapter resources (DB pool, sockets, etc). Synchronous because most clients release sync. */
  close(): void;

  /**
   * Optional V3 message-history persistence.
   * Only adapters with a chat-log backend (e.g., Supabase, certain SQLite shapes) implement this.
   * Adapters that do not support session-scoped messages MUST omit the method.
   */
  saveMessages?(messages: readonly Message[], sessionScope: string): Promise<void>;

  /** Optional V3 message retrieval — see saveMessages. */
  getLastMessages?(
    sessionScope: string,
    limit?: number,
  ): Promise<readonly (Message & { readonly createdAt: Date })[]>;

  /**
   * Optional batch-insert for high-throughput scenarios.
   * Adapters MAY fall back to N sequential addHistory() calls if batch is not natively supported.
   */
  batchAddHistory?(records: readonly HistoryBatchRecord[]): Promise<void>;
}
