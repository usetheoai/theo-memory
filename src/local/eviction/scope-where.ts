/**
 * Constructs the SQL `WHERE` predicate for scope-tier-aware queries.
 *
 * v0.4b-fixes T3.1: shared by `CapacityBasedTrigger`, `TimeBasedTrigger`, and
 * `PgNearestNeighborProvider` so each scope tier (User / Session / Agent /
 * Repo) routes to the correct column predicate without re-inlining the switch
 * in every call site.
 *
 * The column mapping mirrors `getNeighborScopeId` in `triadic-scoring-policy.ts`:
 * `kind='user'` → `user_id`, `kind='session'` → `session_id`,
 * `kind='agent'` → `agent_id`, `kind='repo'` → `agent_id` (per ADR-0010 /
 * EC-4 absorption from the v0.6 cycle — RepoScope column-aliases to agent_id
 * with the `kind='skill'` row discriminator).
 *
 * Closes the SRP smell that F-arch-4 surfaced (the `WHERE m.agent_id = $2`
 * hardcoding was duplicated across 3 modules + 2 inline call sites).
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T3.1
 * @see .claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md § F-arch-4
 */
import type { Scope } from '../../core/scope.js';

/**
 * Returns the SQL-column name for the given scope kind.
 */
export function scopeColumn(scope: Scope): 'user_id' | 'session_id' | 'agent_id' {
  switch (scope.kind) {
    case 'user':
      return 'user_id';
    case 'session':
      return 'session_id';
    case 'agent':
      return 'agent_id';
    case 'repo':
      // RepoScope persists into agent_id with the kind='skill' row discriminator
      // (ADR-0010). The trigger pipeline never receives `kind='repo'` today
      // because skills are not eviction-managed at v0.4b, but the mapping is
      // recorded here for symmetry with `getNeighborScopeId`.
      return 'agent_id';
  }
}

/**
 * Returns the scope-tier identifier value (column value) that pairs with
 * `scopeColumn(scope)`.
 */
export function scopeValue(scope: Scope): string {
  switch (scope.kind) {
    case 'user':
      return scope.userId;
    case 'session':
      return scope.sessionId;
    case 'agent':
      return scope.agentId;
    case 'repo':
      return scope.repoId;
  }
}

/**
 * Returns a kind-namespaced advisory-lock key so e.g. `userId='alice'` and
 * `agentId='alice'` do NOT collide on the same advisory-lock keyspace. The
 * collision would manifest as cross-tier serialization (unrelated evictions
 * blocking each other) — semantically harmless but a debugging surprise.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T3.1 (SEPA iter 4 pre-RED MAJOR)
 */
export function advisoryLockKey(scope: Scope): string {
  return `eviction_${scope.kind}_${scopeValue(scope)}`;
}

/**
 * Returns the SQL `WHERE` predicate (without the leading `WHERE`) and the
 * positional parameter list for the given scope. `paramStart` is the 1-based
 * index of the FIRST placeholder this clause consumes; callers chain further
 * placeholders from `paramStart + 1`.
 *
 * Example:
 *   const { sql, params } = scopeWhereClause(scope, 1);
 *   // sql = 'user_id = $1' (for UserScope), params = ['alice']
 *   const result = await pool.query(`SELECT * FROM memories WHERE ${sql} AND t_invalid IS NULL`, params);
 */
export function scopeWhereClause(
  scope: Scope,
  paramStart = 1,
): { sql: string; params: readonly string[] } {
  return {
    sql: `${scopeColumn(scope)} = $${paramStart}`,
    params: [scopeValue(scope)],
  };
}
