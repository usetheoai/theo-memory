/**
 * PgMessageLog: MessageLog over Postgres (`memory_messages` + `memory_message_sources`,
 * migration 0037). Row-level security confines every statement to the connection's
 * workspace; the scope columns narrow it to one user/session/agent within it.
 *
 * Erasure of a memory's source messages is also enforced by the database: a BEFORE DELETE
 * trigger on `memories` removes them in the same transaction as the memory itself.
 */
import type { Pool } from 'pg';

import type { LoggedMessage, MessageLog } from '../../domain/dip/message-log.js';
import type { Message } from '../../domain/message.js';
import type { Filters } from '../../domain/scope.js';

interface MessageRow {
  readonly message_id: string;
  readonly role: Message['role'];
  readonly content: string;
  readonly observed_at: Date | null;
  readonly logged_at: Date;
}

/** Exact-scope predicate over the scope columns of `alias`, bound to parameters $1..$4. */
function scopeSql(alias: string): string {
  return (
    `${alias}.workspace_id = $1 AND ${alias}.user_id IS NOT DISTINCT FROM $2` +
    ` AND ${alias}.session_id IS NOT DISTINCT FROM $3 AND ${alias}.agent_id IS NOT DISTINCT FROM $4`
  );
}

function scopeParams(filters: Filters): [string, string | null, string | null, string | null] {
  return [filters.workspace_id ?? 'default', filters.user_id ?? null, filters.session_id ?? null, filters.agent_id ?? null];
}

function toLogged(row: MessageRow): LoggedMessage {
  return { id: row.message_id, role: row.role, content: row.content, observedAt: row.observed_at, loggedAt: row.logged_at };
}

export class PgMessageLog implements MessageLog {
  constructor(private readonly pool: Pool) {}

  async append(filters: Filters, messages: readonly Message[], observedAt?: Date): Promise<readonly string[]> {
    if (messages.length === 0) return [];
    // One statement, so the batch takes consecutive `seq` values in message order.
    const { rows } = await this.pool.query<{ message_id: string; seq: string }>(
      `INSERT INTO memory_messages (workspace_id, user_id, session_id, agent_id, role, content, observed_at)
       SELECT $1, $2, $3, $4, m.role, m.content, $7::timestamptz
         FROM unnest($5::text[], $6::text[]) WITH ORDINALITY AS m(role, content, ord)
        ORDER BY m.ord
       RETURNING message_id, seq`,
      [...scopeParams(filters), messages.map((m) => m.role), messages.map((m) => m.content), observedAt?.toISOString() ?? null],
    );
    // RETURNING order is not guaranteed; restore message order from seq.
    return [...rows].sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1)).map((r) => r.message_id);
  }

  async linkSources(filters: Filters, memoryIds: readonly string[], messageIds: readonly string[]): Promise<void> {
    if (memoryIds.length === 0 || messageIds.length === 0) return;
    // Only messages logged under this exact scope can be linked.
    await this.pool.query(
      `INSERT INTO memory_message_sources (workspace_id, memory_id, message_id)
       SELECT m.workspace_id, mem.id, m.message_id
         FROM memory_messages m
         CROSS JOIN unnest($5::uuid[]) AS mem(id)
        WHERE m.message_id = ANY($6::uuid[]) AND ${scopeSql('m')}
       ON CONFLICT DO NOTHING`,
      [...scopeParams(filters), memoryIds, messageIds],
    );
  }

  async recent(filters: Filters, limit: number): Promise<readonly LoggedMessage[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT message_id, role, content, observed_at, logged_at FROM (
         SELECT message_id, role, content, observed_at, logged_at, seq FROM memory_messages m
          WHERE ${scopeSql('m')} ORDER BY seq DESC LIMIT $5
       ) last ORDER BY seq`,
      [...scopeParams(filters), limit],
    );
    return rows.map(toLogged);
  }

  async sourcesOf(filters: Filters, memoryId: string): Promise<readonly LoggedMessage[]> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT m.message_id, m.role, m.content, m.observed_at, m.logged_at
         FROM memory_message_sources s JOIN memory_messages m ON m.message_id = s.message_id
        WHERE s.memory_id = $5 AND ${scopeSql('m')}
        ORDER BY m.seq`,
      [...scopeParams(filters), memoryId],
    );
    return rows.map(toLogged);
  }

  async sourcesFor(filters: Filters, memoryIds: readonly string[]): Promise<ReadonlyMap<string, readonly LoggedMessage[]>> {
    const byMemory = new Map<string, LoggedMessage[]>();
    if (memoryIds.length === 0) return byMemory;
    const { rows } = await this.pool.query<MessageRow & { memory_id: string }>(
      `SELECT s.memory_id, m.message_id, m.role, m.content, m.observed_at, m.logged_at
         FROM memory_message_sources s JOIN memory_messages m ON m.message_id = s.message_id
        WHERE s.memory_id = ANY($5::uuid[]) AND ${scopeSql('m')}
        ORDER BY s.memory_id, m.seq`,
      [...scopeParams(filters), memoryIds],
    );
    for (const row of rows) {
      const list = byMemory.get(row.memory_id) ?? [];
      list.push(toLogged(row));
      byMemory.set(row.memory_id, list);
    }
    return byMemory;
  }

  async eraseSourcesOf(filters: Filters, memoryId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM memory_messages m USING memory_message_sources s
        WHERE s.memory_id = $5 AND s.message_id = m.message_id AND ${scopeSql('m')}`,
      [...scopeParams(filters), memoryId],
    );
    return result.rowCount ?? 0;
  }
}
