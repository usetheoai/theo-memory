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
