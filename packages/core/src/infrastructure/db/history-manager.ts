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
 * @see src/local/schema.ts § history table
 */
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { HistoryBatchRecord, HistoryManager } from '../../domain/dip/history-manager.js';
import type { HistoryEntry } from '../../domain/history-entry.js';

import { history } from './schema.js';
import type { entities, memories } from './schema.js';
import { configureWorkspaceWritesFromPool, workspaceIdForWrite } from './workspace-write-scope.js';

type HistoryAction = 'remember' | 'forget' | 'reflect';

/**
 * O workspace de uma linha nova, decidido em código e não no SQL.
 *
 * Estrito por padrão: sem escopo, `workspaceIdForWrite` lança o mesmo
 * `WorkspaceScopeError` que o pool lança ao recusar uma conexão sem contexto. O
 * fallback single-tenant existe, mas só depois de declarado pelo ponto de
 * construção — nunca como comportamento padrão desta função.
 *
 * @see workspace-write-scope.ts — por que isto é uma declaração, não um default
 */

/**
 * Schema shape exposed to Drizzle's generic. Bundling the three v0.1 tables
 * (memories + entities + history) into one local type avoids:
 *   - namespace import (`import * as schema`) which the project's lint forbids
 *   - the previous `NodePgDatabase<any>` escape hatch (F-arch-1)
 *
 * Consumers passing a plain `drizzle(pool)` (no schema generic) still work
 * because TypeScript widens to the broader interface; only when the consumer
 * explicitly typed their db with a different schema would TS complain.
 */
interface ThemoryV01Schema {
  readonly memories: typeof memories;
  readonly entities: typeof entities;
  readonly history: typeof history;
  readonly [k: string]: unknown;
}
type HistoryDb = NodePgDatabase<ThemoryV01Schema>;

export class DrizzleHistoryManager implements HistoryManager {
  constructor(private readonly db: HistoryDb) {
    // Mesma fronteira dos outros stores: o pool que entra decide o modo de
    // escrita. Aqui ele chega dentro do handle do drizzle (`$client`), então é
    // de lá que se lê — em vez de acrescentar um parâmetro que todo chamador
    // teria de lembrar de passar, e cujo esquecimento seria invisível.
    const client = (db as unknown as { $client?: Pool }).$client;
    if (client !== undefined) {
      configureWorkspaceWritesFromPool(client);
    }
  }

  async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: HistoryAction,
    createdAt?: Date,
    // v0.1 history table is append-only (no soft-delete column); updatedAt + isDeleted
    // accepted from the DIP signature but persisted as createdAt + presence-of-row.

    _updatedAt?: Date,

    _isDeleted?: boolean,
  ): Promise<void> {
    const timestamp = createdAt ?? new Date();
    await this.db.insert(history).values({
      memoryId,
      // O workspace vem do contexto da conexão, que é exatamente o valor que a
      // policy compara — não de um argumento que cada chamador teria de lembrar
      // de passar. Omiti-lo caía no DEFAULT 'default': antes da migration 0029
      // isso gravava a linha no inquilino errado em silêncio; depois dela, a
      // escrita passou a ser recusada para todo workspace que não fosse esse.
      workspaceId: workspaceIdForWrite('addHistory'),
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
      workspaceId: workspaceIdForWrite('batchAddHistory'),
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
