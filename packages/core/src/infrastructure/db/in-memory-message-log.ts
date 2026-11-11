/**
 * In-process MessageLog for unit tests and the in-memory runtime. Same contract as
 * PgMessageLog, checked by the shared conformance suite (message-log-conformance.ts).
 */
import { randomUUID } from 'node:crypto';

import type { LoggedMessage, MessageLog, MessageSearchOptions, ScoredLoggedMessage } from '../../domain/dip/message-log.js';
import { assertEmbeddingsAligned } from '../../domain/dip/message-log.js';
import type { Message } from '../../domain/message.js';
import { bm25Scores } from '../../domain/retrieval/bm25.js';
import { cosineSimilarity } from '../../domain/retrieval/cosine.js';
import { reciprocalRankFusion } from '../../domain/retrieval/rank-fusion.js';
import type { Filters } from '../../domain/scope.js';

import { isVisible, matchesPartitionColumn, scopePartition, scopeVisibility } from './scope-partition.js';

interface Row extends LoggedMessage {
  readonly scopeKey: string;
  readonly seq: number;
  readonly embedding: readonly number[] | null;
}

function scopeKey(filters: Filters): string {
  return JSON.stringify([filters.workspace_id ?? 'default', filters.user_id ?? null, filters.session_id ?? null, filters.agent_id ?? null]);
}

function rowScope(row: Row): { workspaceId: string; userId: string | null; sessionId: string | null; agentId: string | null } {
  const [workspaceId, userId, sessionId, agentId] = JSON.parse(row.scopeKey) as [string, string | null, string | null, string | null];
  return { workspaceId, userId, sessionId, agentId };
}

/** Same tokenization as the in-memory store's keyword search (no stemming, no stop words). */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((t) => t.length > 0);
}

/**
 * Best score first; a tie goes to the message closest to the query in meaning (one with no
 * embedding, or any message when the search has no query vector, after those that have one), then
 * to the one logged first. Never to the id, which is random (ADR-0031).
 */
function byScoreThenMeaning(rows: ReadonlyMap<string, Row>, closeness: ReadonlyMap<string, number>) {
  return (a: { id: string; score: number }, b: { id: string; score: number }): number => {
    if (b.score !== a.score) return b.score - a.score;
    const left = closeness.get(a.id);
    const right = closeness.get(b.id);
    if (left !== right) {
      if (left === undefined) return 1;
      if (right === undefined) return -1;
      return right - left;
    }
    return rows.get(a.id)!.seq - rows.get(b.id)!.seq;
  };
}

function project(row: Row): LoggedMessage {
  return { id: row.id, role: row.role, content: row.content, observedAt: row.observedAt, loggedAt: row.loggedAt };
}

export class InMemoryMessageLog implements MessageLog {
  private readonly rows = new Map<string, Row>();
  /** memoryId -> messageIds, per scope key. */
  private readonly links = new Map<string, Set<string>>();
  private seq = 0;

  async append(
    filters: Filters,
    messages: readonly Message[],
    observedAt?: Date,
    embeddings?: readonly (readonly number[] | null)[],
  ): Promise<readonly string[]> {
    assertEmbeddingsAligned(messages, embeddings);
    const key = scopeKey(filters);
    const loggedAt = new Date();
    const ids = messages.map((m, index) => {
      const id = randomUUID();
      this.seq += 1;
      this.rows.set(id, {
        id, role: m.role, content: m.content,
        observedAt: observedAt === undefined ? null : new Date(observedAt),
        loggedAt, scopeKey: key, seq: this.seq,
        embedding: embeddings?.[index] ?? null,
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
      const scope = rowScope(row);
      if (scope.workspaceId === partition.workspaceId
        && matchesPartitionColumn(partition.userId, scope.userId)
        && matchesPartitionColumn(partition.sessionId, scope.sessionId)
        && matchesPartitionColumn(partition.agentId, scope.agentId)) {
        erased.push(row.id);
      }
    }
    for (const id of erased) this.rows.delete(id);
    for (const set of this.links.values()) for (const id of erased) set.delete(id);
    await Promise.resolve();
    return erased.length;
  }

  async search(filters: Filters, query: string, options: MessageSearchOptions): Promise<readonly ScoredLoggedMessage[]> {
    const visibility = scopeVisibility(filters);
    const asOf = filters.asOf;
    const visible = [...this.rows.values()].filter((row) => isVisible(visibility, rowScope(row))
      && (asOf === undefined || (row.observedAt ?? row.loggedAt) <= asOf));
    const queryVector = options.queryVector;
    const closeness = new Map<string, number>(queryVector === undefined ? [] : visible
      .filter((row) => row.embedding !== null)
      .map((row) => [row.id, cosineSimilarity(queryVector, row.embedding!)]));
    const order = byScoreThenMeaning(this.rows, closeness);
    const bm25 = bm25Scores(tokenize(query), visible.map((row) => ({ id: row.id, terms: tokenize(row.content) })));
    const lexical = visible
      .filter((row) => bm25.has(row.id))
      .map((row) => ({ id: row.id, score: bm25.get(row.id) ?? 0 }))
      .sort(order);
    // Each ranking contributes only its first `limit` ids (a window equal to the list size), so a
    // weak word match cannot outrank the best match by meaning just by appearing in both (ADR-0031).
    const window = Math.max(0, options.limit);
    const ranked = queryVector === undefined
      ? lexical
      : reciprocalRankFusion([
        lexical.slice(0, window).map((r) => r.id),
        [...closeness].map(([id, score]) => ({ id, score }))
          .sort(order)
          .slice(0, window)
          .map((r) => r.id),
      ]).sort(order);
    await Promise.resolve();
    const turns = options.surroundingTurns ?? 0;
    return ranked.slice(0, Math.max(0, options.limit)).map((r) => {
      const row = this.rows.get(r.id)!;
      const result = { ...project(row), score: r.score };
      if (turns <= 0) return result;
      // The result's own stream, oldest first: the same scope key, still under asOf.
      const stream = [...this.rows.values()]
        .filter((other) => other.scopeKey === row.scopeKey && (asOf === undefined || (other.observedAt ?? other.loggedAt) <= asOf))
        .sort((a, b) => a.seq - b.seq);
      const at = stream.findIndex((other) => other.id === row.id);
      return {
        ...result,
        surrounding: {
          before: stream.slice(Math.max(0, at - turns), at).map(project),
          after: stream.slice(at + 1, at + 1 + turns).map(project),
        },
      };
    });
  }

}
