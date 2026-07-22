/**
 * Pure scope→filter helpers extracted from `scoped-memory.ts` (M8 T0 refactor —
 * split the 602-LoC file so no module exceeds the 300-LoC budget). These are
 * `this`-free, unit-testable functions with no I/O. `scoped-memory.ts` re-exports
 * them for backward compatibility, so existing importers are unaffected.
 */
import { InvalidScope } from '../../domain/errors.js';
import type { Filters, Scope } from '../../domain/scope.js';

/**
 * v0.6 (T2.2): translate skill-aware RecallOptions / GetAllOptions flags into
 * `Filters.kind` + `Filters.excludeSuperseded` before the store call.
 *
 * `includeSuperseded` defaults to `false` (recall returns only tip-of-chain),
 * so when the caller omits the option we still emit `excludeSuperseded=true`
 * — BUT only when `onlySkills` is also set, so v0.4a callers see no change.
 */
export function applySkillFilters(
  baseFilters: Filters,
  options?: {
    onlySkills?: boolean;
    includeSuperseded?: boolean;
    attributedTo?: string;
    asOf?: Date;
    category?: string;
  },
): Filters {
  if (options === undefined) {
    return baseFilters;
  }
  // v1.1 T2.2: route RecallOptions.attributedTo into Filters.attributed_to so
  // composeFilters in pgvector-store appends the WHERE clause.
  // v1.1 T3.1 + ADR-0011: route RecallOptions.asOf into Filters.asOf so the
  // store composes the null-safe bi-temporal predicate.
  let base: Filters = { ...baseFilters };
  if (options.attributedTo !== undefined) {
    base = { ...base, attributed_to: options.attributedTo };
  }
  if (options.asOf !== undefined) {
    base = { ...base, asOf: options.asOf };
  }
  // themory-category-filter-server-side T4.1 / EC-3 — route GetAllOptions.category
  // into Filters.category for server-side filter at the pgvector + in-memory
  // adapters. Empty string normalizes to no-filter at this boundary (defense-
  // in-depth alongside REST zod min(1) validation); direct SDK callers passing
  // {category: ''} get the same result as omitting the option entirely.
  if (options.category !== undefined && options.category !== '') {
    base = { ...base, category: options.category };
  }
  if (options.onlySkills === true) {
    return {
      ...base,
      kind: 'skill',
      // Default for skill recall: exclude superseded unless the caller explicitly opts in.
      excludeSuperseded: options.includeSuperseded === true ? false : true,
    };
  }
  if (options.includeSuperseded === false) {
    return { ...base, excludeSuperseded: true };
  }
  return base;
}

export function filtersFromScope(scope: Scope, workspaceId?: string): Filters {
  // multi-tenant-workspace-isolation T3.1: when the memory is workspace-bound
  // (LocalMemory.withWorkspace), the workspace_id is merged into every scoped
  // query + insert payload. When unbound (SDK/unit callers), it is omitted and
  // the store column default ('default') applies (ADR D7).
  const ws: Pick<Filters, 'workspace_id'> = workspaceId !== undefined ? { workspace_id: workspaceId } : {};
  switch (scope.kind) {
    case 'user':
      // M8 hierarchical recall: the User tier is GLOBAL-ONLY — durable rows with no
      // session/agent sub-partition (scopeHierarchy owns the session_id/agent_id predicate).
      return { ...ws, user_id: scope.userId, scopeHierarchy: 'global' };
    case 'session':
      // M8 hierarchical recall: a user-bound session sees its OWN rows UNION the user's
      // global rows. `session_id` STAYS in the filter — the WRITE path derives the row's
      // session_id column from it — while `scopeHierarchy` drives the RECALL predicate
      // (the matchers skip the plain session_id equality when scopeHierarchy is present).
      // The admin path (no acting user) stays an exact workspace-session filter.
      return scope.userId !== undefined
        ? { ...ws, user_id: scope.userId, session_id: scope.sessionId, scopeHierarchy: { session: scope.sessionId } }
        : { ...ws, session_id: scope.sessionId };
    case 'agent':
      return scope.userId !== undefined
        ? { ...ws, user_id: scope.userId, agent_id: scope.agentId }
        : { ...ws, agent_id: scope.agentId };
    case 'repo':
      // v0.6 (EC-4): RepoScope persists `repoId` in the `agent_id` column. The
      // `kind='skill'` discriminator (added by Skill-specific recall/getAll paths)
      // disambiguates skill rows from regular agent memories under the same id.
      return { ...ws, agent_id: scope.repoId };
  }
}

export function assertScopeIsNonEmpty(scope: Scope): void {
  // Type-safe runtime guard — rejects {} or any malformed input lacking a valid kind.
  const kind = (scope as { kind?: string }).kind;
  if (kind !== 'user' && kind !== 'session' && kind !== 'agent' && kind !== 'repo') {
    throw new InvalidScope('reset requires a Scope with kind user/session/agent/repo (EC-13)');
  }
  if (scope.kind === 'user' && scope.userId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'session' && scope.sessionId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'agent' && scope.agentId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'repo' && scope.repoId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
}

/**
 * semantic-recall-cache-v1-5 T2.2 — EC-10 absorption: derive the scope of a
 * memory row from its persisted payload so `LocalMemory.forget()` can issue
 * a targeted `invalidateScope` instead of an all-scope sweep. The payload
 * carries `user_id` / `session_id` / `agent_id` columns (the same shape
 * `runExtractionPipeline` persisted at write time).
 *
 * Returns `undefined` when payload has no recognizable scope tier;
 * `LocalMemory.forget()` SKIPS cache invalidation in that case (no
 * `invalidateAll()` fallback per ADR D9 of `semantic-recall-cache-v1-5-fixes-cycle-1`).
 * Cache continues serving until TTL — bounded staleness.
 *
 * The `undefined` branch is DEFENSIVE: every v0.1+ row carries a scope column
 * populated by `runExtractionPipeline`. The branch only fires for (a) hypothetical
 * pre-v0.1 rows (none in production) OR (b) consumer-side manual INSERTs bypassing
 * the extraction pipeline.
 *
 * Repo-tier scope is NOT exercised here yet (per ADR D10 of `semantic-recall-cache-v1-5-fixes-cycle-1`):
 * `LocalScopedSkillMemory.recall()` does not consult the cache at v1.5.0, so the
 * derivation function returns the most specific memory-scope tier without checking
 * for a `repo_id` column. Skill-scope cache wiring lands in v1.5.x.
 *
 */
export function deriveScopeFromPayload(payload: Readonly<Record<string, unknown>>): Scope | undefined {
  const userId = payload['user_id'];
  const sessionId = payload['session_id'];
  const agentId = payload['agent_id'];
  // session is the most specific tier; prefer it when present.
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return { kind: 'session', sessionId };
  }
  if (typeof agentId === 'string' && agentId.length > 0) {
    return { kind: 'agent', agentId };
  }
  if (typeof userId === 'string' && userId.length > 0) {
    return { kind: 'user', userId };
  }
  return undefined;
}
