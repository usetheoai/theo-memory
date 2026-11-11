/**
 * PgMessageLog: MessageLog over Postgres (`memory_messages` + `memory_message_sources`,
 * migration 0037). Row-level security confines every statement to the connection's
 * workspace; the scope columns narrow it to one user/session/agent within it.
 *
 * Erasure of a memory's source messages is also enforced by the database: a BEFORE DELETE
 * trigger on `memories` removes them in the same transaction as the memory itself.
 */
import type { Pool } from 'pg';

import { assertEmbeddingsAligned } from '../../domain/dip/message-log.js';
import type { LoggedMessage, MessageLog, MessageSearchOptions, ScoredLoggedMessage } from '../../domain/dip/message-log.js';
import type { Message } from '../../domain/message.js';
import { BM25_B, BM25_K1 } from '../../domain/retrieval/bm25.js';
import { RRF_K } from '../../domain/retrieval/rank-fusion.js';
import type { Filters } from '../../domain/scope.js';

import { scopePartition, scopeVisibility } from './scope-partition.js';

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

function toVectorLiteral(vector: readonly number[]): string {
  if (!vector.every(Number.isFinite)) throw new RangeError('MessageLog: embedding holds a non-finite value');
  return `[${vector.join(',')}]`;
}

function toLogged(row: MessageRow): LoggedMessage {
  return { id: row.message_id, role: row.role, content: row.content, observedAt: row.observed_at, loggedAt: row.logged_at };
}

export class PgMessageLog implements MessageLog {
  constructor(private readonly pool: Pool) {}

  async append(
    filters: Filters,
    messages: readonly Message[],
    observedAt?: Date,
    embeddings?: readonly (readonly number[] | null)[],
  ): Promise<readonly string[]> {
    assertEmbeddingsAligned(messages, embeddings);
    if (messages.length === 0) return [];
    const vectors = messages.map((_, index) => {
      const vector = embeddings?.[index];
      return vector === undefined || vector === null ? null : toVectorLiteral(vector);
    });
    // One statement, so the batch takes consecutive `seq` values in message order.
    const { rows } = await this.pool.query<{ message_id: string; seq: string }>(
      `INSERT INTO memory_messages (workspace_id, user_id, session_id, agent_id, role, content, observed_at, embedding)
       SELECT $1, $2, $3, $4, m.role, m.content, $7::timestamptz, m.embedding::vector
         FROM unnest($5::text[], $6::text[], $8::text[]) WITH ORDINALITY AS m(role, content, embedding, ord)
        ORDER BY m.ord
       RETURNING message_id, seq`,
      [...scopeParams(filters), messages.map((m) => m.role), messages.map((m) => m.content), observedAt?.toISOString() ?? null, vectors],
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

  async eraseScope(filters: Filters): Promise<number> {
    const partition = scopePartition(filters);
    const params: string[] = [partition.workspaceId];
    const clauses = ['workspace_id = $1'];
    const columns = [['user_id', partition.userId], ['session_id', partition.sessionId], ['agent_id', partition.agentId]] as const;
    for (const [column, value] of columns) {
      if (value === undefined) continue;
      if (value === null) {
        clauses.push(`${column} IS NULL`);
      } else {
        params.push(value);
        clauses.push(`${column} = $${String(params.length)}`);
      }
    }
    // Their memory_message_sources rows go with them (ON DELETE CASCADE).
    const result = await this.pool.query(`DELETE FROM memory_messages WHERE ${clauses.join(' AND ')}`, params);
    return result.rowCount ?? 0;
  }

  async search(filters: Filters, query: string, options: MessageSearchOptions): Promise<readonly ScoredLoggedMessage[]> {
    const limit = Math.max(0, Math.trunc(options.limit));
    if (limit === 0) return [];
    const visibility = scopeVisibility(filters);
    // $1 = query text, $2 = limit, $3 = workspace, then the scope columns.
    const params: unknown[] = [query, limit, visibility.workspaceId];
    const clauses = ['m.workspace_id = $3'];
    for (const [column, value] of [['user_id', visibility.userId], ['agent_id', visibility.agentId]] as const) {
      if (value === undefined) continue;
      if (value === null) {
        clauses.push(`m.${column} IS NULL`);
      } else {
        params.push(value);
        clauses.push(`m.${column} = $${String(params.length)}`);
      }
    }
    if (visibility.sessionIds !== undefined) {
      const named = visibility.sessionIds.filter((id): id is string => id !== null);
      const parts: string[] = [];
      if (visibility.sessionIds.includes(null)) parts.push('m.session_id IS NULL');
      if (named.length > 0) {
        params.push(named);
        parts.push(`m.session_id = ANY($${String(params.length)}::text[])`);
      }
      clauses.push(`(${parts.join(' OR ')})`);
    }
    if (filters.asOf !== undefined) {
      params.push(filters.asOf.toISOString());
      clauses.push(`COALESCE(m.observed_at, m.logged_at) <= $${String(params.length)}::timestamptz`);
    }
    // With a query vector, the BM25 ranking and the cosine ranking of the messages that carry an
    // embedding are fused by Reciprocal Rank Fusion; both rankings break ties on message_id, as
    // the in-memory adapter does.
    let fused = ', final AS (SELECT message_id, rank AS score FROM scored)';
    if (options.queryVector !== undefined) {
      params.push(toVectorLiteral(options.queryVector));
      const q = `$${String(params.length)}::vector`;
      fused = `, lexical AS (
         SELECT message_id, row_number() OVER (ORDER BY rank DESC, message_id) AS r FROM scored
       ),
       semantic AS (
         SELECT message_id, row_number() OVER (ORDER BY embedding <=> ${q}, message_id) AS r
           FROM docs WHERE embedding IS NOT NULL
       ),
       final AS (
         SELECT message_id,
                COALESCE(1.0 / (${String(RRF_K)} + l.r), 0) + COALESCE(1.0 / (${String(RRF_K)} + s.r), 0) AS score
           FROM lexical l FULL OUTER JOIN semantic s USING (message_id)
       )`;
    }
    // Same Okapi BM25 (Lucene IDF, k1, b) and english lexemes as PgvectorStore.keywordSearch,
    // over the messages this scope can see.
    const { rows } = await this.pool.query<MessageRow & { rank: number }>(
      `WITH q AS (
         SELECT array_agg(DISTINCT lexeme) AS lexemes FROM unnest(to_tsvector('english', $1))
       ),
       docs AS (
         SELECT m.message_id, m.role, m.content, m.observed_at, m.logged_at, m.embedding, to_tsvector('english', m.content) AS tsv
           FROM memory_messages m
          WHERE ${clauses.join(' AND ')}
       ),
       doc_len AS (
         SELECT d.message_id, COALESCE(SUM(COALESCE(array_length(u.positions, 1), 1)), 0)::float8 AS dl
           FROM docs d LEFT JOIN LATERAL unnest(d.tsv) u ON true
          GROUP BY d.message_id
       ),
       stats AS (
         SELECT COUNT(*)::float8 AS n, COALESCE(AVG(dl), 0)::float8 AS avgdl FROM doc_len
       ),
       terms AS (
         SELECT d.message_id, u.lexeme, COALESCE(array_length(u.positions, 1), 1)::float8 AS tf
           FROM docs d, q, unnest(d.tsv) u
          WHERE u.lexeme = ANY(q.lexemes)
       ),
       df AS (
         SELECT lexeme, COUNT(*)::float8 AS df FROM terms GROUP BY lexeme
       ),
       scored AS (
         SELECT t.message_id,
                SUM(ln(1 + (s.n - f.df + 0.5) / (f.df + 0.5))
                    * t.tf * (${String(BM25_K1)} + 1)
                    / (t.tf + ${String(BM25_K1)} * (1 - ${String(BM25_B)} + ${String(BM25_B)} * l.dl / NULLIF(s.avgdl, 0)))) AS rank
           FROM terms t
           JOIN df f USING (lexeme)
           JOIN doc_len l ON l.message_id = t.message_id
           CROSS JOIN stats s
          GROUP BY t.message_id
       )
       ${fused}
       SELECT d.message_id, d.role, d.content, d.observed_at, d.logged_at, f.score::float8 AS rank
         FROM final f JOIN docs d ON d.message_id = f.message_id
        ORDER BY f.score DESC, d.message_id
        LIMIT $2`,
      params,
    );
    return rows.map((row) => ({ ...toLogged(row), score: Number(row.rank) }));
  }
}
