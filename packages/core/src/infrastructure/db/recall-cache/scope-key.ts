/**
 * Deterministic `scopeKey` derivation from a `Scope` discriminated union.
 *
 * Pure function — easily unit-testable, no I/O.
 *
 * Format `${kind}:${id}` per blueprint D4 cache key composition:
 *   - UserScope    → `user:${userId}`
 *   - SessionScope → `session:${sessionId}` (drops userId — session scope is
 *                    the smaller subset; if a session has a user, the user
 *                    scope is separately cached)
 *   - AgentScope   → `agent:${agentId}`    (drops userId — same rationale)
 *   - RepoScope    → `repo:${repoId}`      (skill scope per ADR-0010; the
 *                    `kind` discriminator IS `'repo'` even though the conceptual
 *                    name in the ScopeTierTtlConfig is the skill-scope tier)
 *
 * @see src/core/scope.ts (Scope union — discriminator-based exhaustive switch)
 */
import { DEFAULT_WORKSPACE_ID } from '../../../domain/principal.js';
import type { Scope } from '../../../domain/scope.js';

/**
 * multi-tenant-rbac-and-slice1-completion T3.1 (Slice 1 100% / EC-8): the cache
 * key is PREFIXED with the workspace so a byte-identical query under the same
 * scope in two workspaces produces two DISTINCT keys — no cross-workspace cache
 * hit. `workspaceId` defaults to {@link DEFAULT_WORKSPACE_ID} for unbound
 * SDK/unit callers (ADR D7), matching the `workspace_id` column default.
 */
export function deriveScopeKey(scope: Scope, workspaceId: string = DEFAULT_WORKSPACE_ID): string {
  const ws = `ws:${workspaceId}|`;
  switch (scope.kind) {
    case 'user':
      return `${ws}user:${scope.userId}`;
    case 'session':
      return `${ws}session:${scope.sessionId}`;
    case 'agent':
      return `${ws}agent:${scope.agentId}`;
    case 'repo':
      return `${ws}repo:${scope.repoId}`;
  }
}
