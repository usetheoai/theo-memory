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
import type { Scope } from '../../../domain/scope.js';

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
 * v0.4b-fixes T12.1 (F-dom-pg-5 MINOR): Postgres advisory locks live in a
 * shared 64-bit keyspace; `pg_try_advisory_xact_lock(hashtext($1))` further
 * narrows the effective key to the 32-bit `hashtext` output. The collision
 * surface is therefore ~`2^32` distinct keys across the entire cluster —
 * astronomically large in practice (we'd need ~65k distinct scope-keys to
 * hit a 50% birthday-collision probability). False collisions just block
 * for the duration of the other tx's eviction pass, then release; the lock
 * is per-transaction (`_xact_`) so the blast radius is bounded by the
 * holding tx's lifetime. No data-corruption risk.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T3.1 + T12.1 (F-dom-pg-5)
 */
export function advisoryLockKey(scope: Scope, workspaceId?: string): string {
  // multi-tenant-rbac-and-slice1-completion T3.1 (Slice 1 100%): namespace the
  // lock by workspace so an eviction pass in ws-A never serializes against an
  // unrelated ws-B pass on the same tier id. Omitting workspaceId keeps the
  // legacy single-tenant key shape (backward-compatible for unit tests).
  const ws = workspaceId !== undefined ? `ws_${workspaceId}_` : '';
  return `eviction_${ws}${scope.kind}_${scopeValue(scope)}`;
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
  workspaceId?: string,
): { sql: string; params: readonly string[] } {
  // multi-tenant-rbac-and-slice1-completion T3.1 (Slice 1 100%): when a
  // workspace is bound, AND a `workspace_id = $N+1` predicate so an eviction
  // pass only ever sees — and can only ever soft-delete — rows in its own
  // tenant. Omitting workspaceId preserves the legacy single-tenant predicate
  // (the `workspace_id NOT NULL DEFAULT 'default'` column still bounds it to
  // the default workspace at the data layer).
  if (workspaceId === undefined) {
    return {
      sql: `${scopeColumn(scope)} = $${paramStart}`,
      params: [scopeValue(scope)],
    };
  }
  return {
    sql: `${scopeColumn(scope)} = $${paramStart} AND workspace_id = $${paramStart + 1}`,
    params: [scopeValue(scope), workspaceId],
  };
}
