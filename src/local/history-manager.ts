/**
 * Drizzle-backed HistoryManager — T6.1 of v0-1-local-runtime plan v1.3.
 *
 * Implements the HistoryManager DIP (4 required + 1 optional method) over the
 * `history` table from T2.1 schema. Audit trail consumed by Memory.history(id).
 *
 * EC-18 absorbed: query orders by (timestamp DESC, id DESC) so concurrent
 * persists in the same millisecond still produce strict ordering via Postgres
 * `bigserial` PK tiebreaker.
 *
 * v0.1 ships with addHistory + batchAddHistory + getHistory + reset + close.
 * saveMessages / getLastMessages / batchAddHistory remain OPTIONAL per the DIP;
 * batchAddHistory is implemented at v0.1 because the extraction pipeline's
 * Phase 6.5 uses it for high-throughput.
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T6.1
 * @see src/local/schema.ts § history table
 */
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { HistoryBatchRecord, HistoryManager } from '../core/dip/history-manager.js';
import type { HistoryEntry } from '../core/history-entry.js';

import { history } from './schema.js';

type HistoryAction = 'remember' | 'forget' | 'reflect';

export class DrizzleHistoryManager implements HistoryManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: NodePgDatabase<any>) {}

  async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: HistoryAction,
    createdAt?: Date,
    // v0.1 history table is append-only (no soft-delete column); updatedAt + isDeleted
    // accepted from the DIP signature but persisted as createdAt + presence-of-row.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _updatedAt?: Date,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _isDeleted?: boolean,
  ): Promise<void> {
    const timestamp = createdAt ?? new Date();
    await this.db.insert(history).values({
      memoryId,
      event: action,
      prevText: previousValue,
      newText: newValue,
      timestamp,
    });
  }

  async batchAddHistory(records: readonly HistoryBatchRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const rows = records.map((r) => ({
      memoryId: r.memoryId,
      event: r.action,
      prevText: r.previousValue,
      newText: r.newValue,
      timestamp: r.createdAt ?? new Date(),
    }));
    await this.db.insert(history).values(rows);
  }

  async getHistory(memoryId: string): Promise<readonly HistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(history)
      .where(eq(history.memoryId, memoryId))
      .orderBy(sql`${history.timestamp} DESC, ${history.id} DESC`);
    return rows.map((r) => ({
      action: r.event as HistoryAction,
      at: r.timestamp,
      previousValue: r.prevText,
      newValue: r.newText,
    }));
  }

  async reset(): Promise<void> {
    await this.db.delete(history);
  }

  close(): void {
    // Pool lifecycle is owned by the caller (createLocalMemory or test fixture).
  }
}
