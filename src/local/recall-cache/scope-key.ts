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
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T1.1
 * @see src/core/scope.ts (Scope union — discriminator-based exhaustive switch)
 */
import type { Scope } from '../../core/scope.js';

export function deriveScopeKey(scope: Scope): string {
  switch (scope.kind) {
    case 'user':
      return `user:${scope.userId}`;
    case 'session':
      return `session:${scope.sessionId}`;
    case 'agent':
      return `agent:${scope.agentId}`;
    case 'repo':
      return `repo:${scope.repoId}`;
  }
}
