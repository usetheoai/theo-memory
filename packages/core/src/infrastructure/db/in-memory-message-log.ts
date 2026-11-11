/**
 * In-process MessageLog for unit tests and the in-memory runtime. Same contract as
 * PgMessageLog, checked by the shared conformance suite (message-log-conformance.ts).
 */
import { randomUUID } from 'node:crypto';

import type { LoggedMessage, MessageLog } from '../../domain/dip/message-log.js';
import type { Message } from '../../domain/message.js';
import type { Filters } from '../../domain/scope.js';

import { matchesPartitionColumn, scopePartition } from './scope-partition.js';

interface Row extends LoggedMessage {
  readonly scopeKey: string;
  readonly seq: number;
}

function scopeKey(filters: Filters): string {
  return JSON.stringify([filters.workspace_id ?? 'default', filters.user_id ?? null, filters.session_id ?? null, filters.agent_id ?? null]);
}

function project(row: Row): LoggedMessage {
  return { id: row.id, role: row.role, content: row.content, observedAt: row.observedAt, loggedAt: row.loggedAt };
}

export class InMemoryMessageLog implements MessageLog {
  private readonly rows = new Map<string, Row>();
  /** memoryId -> messageIds, per scope key. */
  private readonly links = new Map<string, Set<string>>();
  private seq = 0;

  async append(filters: Filters, messages: readonly Message[], observedAt?: Date): Promise<readonly string[]> {
    const key = scopeKey(filters);
    const loggedAt = new Date();
    const ids = messages.map((m) => {
      const id = randomUUID();
      this.seq += 1;
      this.rows.set(id, {
        id, role: m.role, content: m.content,
        observedAt: observedAt === undefined ? null : new Date(observedAt),
        loggedAt, scopeKey: key, seq: this.seq,
      });
      return id;
    });
    await Promise.resolve();
    return ids;
  }

  async linkSources(filters: Filters, memoryIds: readonly string[], messageIds: readonly string[]): Promise<void> {
    const key = scopeKey(filters);
    const owned = messageIds.filter((id) => this.rows.get(id)?.scopeKey === key);
    for (const memoryId of memoryIds) {
      const linkKey = `${key}|${memoryId}`;
      const set = this.links.get(linkKey) ?? new Set<string>();
      for (const id of owned) set.add(id);
      this.links.set(linkKey, set);
    }
    await Promise.resolve();
  }

  async recent(filters: Filters, limit: number): Promise<readonly LoggedMessage[]> {
    const key = scopeKey(filters);
    const inScope = [...this.rows.values()].filter((r) => r.scopeKey === key).sort((a, b) => a.seq - b.seq);
    await Promise.resolve();
    return limit <= 0 ? [] : inScope.slice(-limit).map(project);
  }

  async sourcesOf(filters: Filters, memoryId: string): Promise<readonly LoggedMessage[]> {
    const ids = this.links.get(`${scopeKey(filters)}|${memoryId}`) ?? new Set<string>();
    await Promise.resolve();
    return [...ids].map((id) => this.rows.get(id)).filter((r): r is Row => r !== undefined).sort((a, b) => a.seq - b.seq).map(project);
  }

  async sourcesFor(filters: Filters, memoryIds: readonly string[]): Promise<ReadonlyMap<string, readonly LoggedMessage[]>> {
    const byMemory = new Map<string, readonly LoggedMessage[]>();
    for (const memoryId of memoryIds) {
      const sources = await this.sourcesOf(filters, memoryId);
      if (sources.length > 0) byMemory.set(memoryId, sources);
    }
    return byMemory;
  }

  async eraseSourcesOf(filters: Filters, memoryId: string): Promise<number> {
    const key = scopeKey(filters);
    const ids = this.links.get(`${key}|${memoryId}`) ?? new Set<string>();
    let erased = 0;
    for (const id of ids) if (this.rows.delete(id)) erased += 1;
    for (const set of this.links.values()) for (const id of ids) set.delete(id);
    this.links.delete(`${key}|${memoryId}`);
    await Promise.resolve();
    return erased;
  }

  async eraseScope(filters: Filters): Promise<number> {
    const partition = scopePartition(filters);
    const erased: string[] = [];
    for (const row of this.rows.values()) {
      const [workspaceId, userId, sessionId, agentId] = JSON.parse(row.scopeKey) as [string, string | null, string | null, string | null];
      if (workspaceId === partition.workspaceId
        && matchesPartitionColumn(partition.userId, userId)
        && matchesPartitionColumn(partition.sessionId, sessionId)
        && matchesPartitionColumn(partition.agentId, agentId)) {
        erased.push(row.id);
      }
    }
    for (const id of erased) this.rows.delete(id);
    for (const set of this.links.values()) for (const id of erased) set.delete(id);
    await Promise.resolve();
    return erased.length;
  }
}
