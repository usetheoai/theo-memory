/**
 * The scope partition a wipe deletes, derived from `Filters` with the memory store's rules:
 * an id present in the filters must match, an absent id matches anything, and the user
 * tier's `scopeHierarchy: 'global'` means "no session and no agent". Shared by the message
 * log adapters so `Memory.reset` erases the same partition from memories and messages.
 */
import { InvalidScope } from '../../domain/errors.js';
import type { Filters } from '../../domain/scope.js';

/** `string`: must equal. `null`: must be absent. `undefined`: any value. */
export type PartitionColumn = string | null | undefined;

export interface ScopePartition {
  readonly workspaceId: string;
  readonly userId: PartitionColumn;
  readonly sessionId: PartitionColumn;
  readonly agentId: PartitionColumn;
}

export function scopePartition(filters: Filters): ScopePartition {
  const hierarchy = filters.scopeHierarchy;
  if (hierarchy !== undefined && hierarchy !== 'global') {
    throw new InvalidScope('a session hierarchy is a recall predicate and cannot name a partition to erase');
  }
  const global = hierarchy === 'global';
  return {
    workspaceId: filters.workspace_id ?? 'default',
    userId: filters.user_id,
    sessionId: global ? null : filters.session_id,
    agentId: global ? null : filters.agent_id,
  };
}

export function matchesPartitionColumn(expected: PartitionColumn, actual: string | null): boolean {
  return expected === undefined || expected === actual;
}

/**
 * What a scope can READ, which is wider than what it erases: a user-bound session reads its own
 * rows plus the user's global rows. `sessionIds` lists the allowed session values (`null` is
 * "no session"); `undefined` allows any.
 */
export interface ScopeVisibility {
  readonly workspaceId: string;
  readonly userId: PartitionColumn;
  readonly agentId: PartitionColumn;
  readonly sessionIds: readonly (string | null)[] | undefined;
}

export function scopeVisibility(filters: Filters): ScopeVisibility {
  const hierarchy = filters.scopeHierarchy;
  const base = { workspaceId: filters.workspace_id ?? 'default', userId: filters.user_id };
  if (hierarchy === 'global') return { ...base, agentId: null, sessionIds: [null] };
  if (hierarchy !== undefined) return { ...base, agentId: null, sessionIds: [hierarchy.session, null] };
  return { ...base, agentId: filters.agent_id, sessionIds: filters.session_id === undefined ? undefined : [filters.session_id] };
}

export function isVisible(visibility: ScopeVisibility, row: { workspaceId: string; userId: string | null; sessionId: string | null; agentId: string | null }): boolean {
  return row.workspaceId === visibility.workspaceId
    && matchesPartitionColumn(visibility.userId, row.userId)
    && matchesPartitionColumn(visibility.agentId, row.agentId)
    && (visibility.sessionIds === undefined || visibility.sessionIds.includes(row.sessionId));
}
