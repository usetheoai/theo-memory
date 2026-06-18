/**
 * Shared scope-candidate loader for the v0.4b eviction pipeline.
 *
 * v0.4b-fixes T6.1: closes F-arch-3 MAJOR (DRY rule-of-three) by extracting
 * the `ScopeCandidateRow` shape + `rowToMemoryItem` mapper + `loadCandidates`
 * SQL helper that previously lived duplicated across
 * `capacity-based-trigger.ts` + `time-based-trigger.ts`. T7.1 will become the
 * third consumer when `LocalScopedMemory.forget()` delegates through the
 * PgEvictor path.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T6.1 + F-arch-3
 */
import type { PoolClient } from 'pg';

import type { MemoryItem } from '../../../domain/memory-item.js';
import type { Scope } from '../../../domain/scope.js';

import { scopeWhereClause } from './scope-where.js';

/**
 * Raw `memories` row shape used by the eviction trigger pipeline. Mirrors the
 * column set returned by the candidate-fetch SQL — keep in sync with
 * `loadCandidates` below + the v0.1 + v0.4b schema columns.
 */
export interface ScopeCandidateRow {
  readonly id: string;
  readonly text: string;
  readonly hash: string;
  readonly user_id: string | null;
  readonly session_id: string | null;
  readonly agent_id: string | null;
  readonly payload: Record<string, string | number | boolean | null>;
  readonly t_valid: Date | null;
  readonly t_invalid: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly last_accessed_at: Date | null;
  readonly access_count: number;
  readonly half_life_seconds: number | null;
  readonly llm_importance_score: number | null;
}

/**
 * Materializes a typed `MemoryItem` from a raw `memories` row. Reconstructs
 * the `MemoryItem['scope']` from the persisted columns following the v0.4b
 * convention (agent_id wins, then session_id, then user_id).
 *
 * Note: this reverses the WRITE-side rule that `scope.kind` is authoritative
 * (T3.1 / EC-5). At READ time we only have columns; the canonical `agent →
 * session → user` precedence reproduces the original write-side scope shape
 * for downstream scoring.
 */
export function rowToMemoryItem(row: ScopeCandidateRow): MemoryItem {
  const scope: MemoryItem['scope'] =
    row.agent_id !== null
      ? { kind: 'agent', agentId: row.agent_id }
      : row.session_id !== null
        ? { kind: 'session', sessionId: row.session_id }
        : { kind: 'user', userId: row.user_id ?? '' };
  return {
    id: row.id,
    text: row.text,
    hash: row.hash,
    scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.payload,
    tValid: row.t_valid,
    tInvalid: row.t_invalid,
    llmImportanceScore: row.llm_importance_score,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    halfLifeSeconds: row.half_life_seconds,
  };
}

const CANDIDATE_COLUMNS = `id, text, hash, user_id, session_id, agent_id, payload,
              t_valid, t_invalid, created_at, updated_at,
              last_accessed_at, access_count, half_life_seconds, llm_importance_score`;

/**
 * Loads every active (non-invalidated) candidate row in the given scope.
 *
 * Composes the `WHERE` predicate via `scopeWhereClause` so the query routes
 * to `user_id` / `session_id` / `agent_id` based on `scope.kind`. Returns
 * already-mapped `MemoryItem[]` to give callers the typed shape they need
 * for `EvictionPolicy.selectVictims` without re-importing `rowToMemoryItem`.
 */
export async function loadCandidates(
  client: PoolClient,
  scope: Scope,
  workspaceId?: string,
): Promise<readonly MemoryItem[]> {
  // multi-tenant-rbac-and-slice1-completion T3.1: candidates are workspace-bound
  // when a workspace is supplied — the eviction pass cannot load (and therefore
  // cannot soft-delete) a row from another tenant.
  const where = scopeWhereClause(scope, 1, workspaceId);
  const result = await client.query<ScopeCandidateRow>(
    `SELECT ${CANDIDATE_COLUMNS}
       FROM memories
      WHERE ${where.sql}
        AND t_invalid IS NULL`,
    [...where.params],
  );
  return result.rows.map(rowToMemoryItem);
}
