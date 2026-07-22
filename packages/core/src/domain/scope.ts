/**
 * Three-tier scope discriminated union and the internal Filters shape.
 *
 * @see ADR-0002 — three-tier scope (User / Session / Agent) via scoped sub-objects.
 * @see ADR-0001 — upstream-shape architecture (Filters renames the upstream `run_id` field to `session_id` per project vocabulary).
 */

export interface UserScope {
  readonly kind: 'user';
  readonly userId: string;
}

export interface SessionScope {
  readonly kind: 'session';
  readonly sessionId: string;
  /** Optional cross-tier filter: pin the session to a specific user. */
  readonly userId?: string;
}

export interface AgentScope {
  readonly kind: 'agent';
  readonly agentId: string;
  /** Optional cross-tier filter: pin the agent invocation to a specific user. */
  readonly userId?: string;
}

/**
 * v0.6 — code-as-skill repository scope.
 *
 * Issued by `Memory.skills(repoId)`. At the store layer, `repoId` is persisted
 * as the row's `agent_id` column (the cross-user semantic fits a code repo).
 * Disambiguation between regular agent memories and skill memories happens via
 * the `kind='skill'` discriminator on the row — same column, different kind.
 *
 */
export interface RepoScope {
  readonly kind: 'repo';
  readonly repoId: string;
}

export type Scope = UserScope | SessionScope | AgentScope | RepoScope;

/**
 * `ScopedContext` — structural interface consumed by `memoryFromCtx` (v0.2 PR-A)
 * AND by the `@usetheo/memory/agent-tools` AsyncLocalStorage scope binding (v0.3 T3.1).
 *
 * Moved from `src/theokit/types.ts` to `src/core/` at T3.1 so both sibling layers
 * (`src/theokit/` and `src/agent-tools/`) import from a single source per
 * `architecture.md § 3` DIP. The theokit subpath re-exports for backward compat.
 *
 * @see ADR D1 (v0.2) — structural typing over peer-dep on `theokit`
 * @see ADR D4 (v0.2) — 3-state resolver (a userId-present / b session-null / c session-or-userId-absent)
 * @see ADR D6 (v0.2) — `@usetheo/memory/theokit` subpath ships independent of the main barrel
 * @see ADR D3 (v0.3) — AsyncLocalStorage scope binding consumes this shape at request boundary
 *
 * ZERO peer-dependency on `theokit`. Any consumer whose request context exposes
 * `ctx.session.userId` satisfies this via structural typing — verified across
 * 5 TheoKit fixtures in v0.2 blueprint Q5 (sessions-auth, template-saas,
 * auth-providers-with-authjs, auth-providers-diy-github, template-postgres).
 *
 * v0.2 binding only resolves the `userId` tier. `sessionId` and `agentId` are
 * declared for forward compatibility (v0.3+) — consumers needing session-tier
 * or agent-tier scoping call `memory.session(id)` / `memory.agent(id)` directly
 * per `architecture.md § 1`.
 */
export interface ScopedContext {
  /**
   * Per-request workspace (tenant) anchor — the OUTER isolation boundary
   * (`workspace_id == tenant_id`). AUTH-TRUSTED: populated ONLY from a credential
   * resolved by `AuthVerifier.resolvePrincipal` (e.g. the MCP bearer gate attaches
   * it from the per-tenant key), NEVER from a client-supplied header/body — per
   * theo-data invariant 3 ("resolve a Principal, never trust the body") + plan
   * `mcp-workspace-binding-isolation` ADR D2. When absent (single-tenant / no-auth
   * dev) the store collapses to the `default` workspace, which has no cross-tenant
   * IDOR. The `session.userId` below is the WITHIN-workspace user tier — a
   * different (cosmetic) partition, not the security boundary.
   *
   * @see theo-memory#82 — the cross-tenant leak this field closes on the MCP surface.
   */
  workspaceId?: string;
  /**
   * Per-request session payload. Both `undefined` (field absent — e.g.,
   * `template-postgres` fixture with only `{ db }`) AND `null` (session-bearing
   * fixture, unauthenticated request) are valid runtime states the resolver
   * MUST handle distinctly per ADR D4 (v0.2).
   */
  session?: {
    /**
     * Caller-supplied user identifier. The binding TRUSTS this verbatim per
     * v0.2 blueprint Q7 — no normalization, no namespacing. Consumer is responsible
     * for cross-tenant disambiguation (e.g., `"t-${tenantId}-u-${userId}"`).
     */
    userId?: string;
    /** RESERVED for v0.3+ session-tier auto-resolution. Ignored by v0.2 binding. */
    sessionId?: string;
    /** RESERVED for v0.3+ agent-tier auto-resolution. Ignored by v0.2 binding. */
    agentId?: string;
  } | null;
}

/**
 * Internal filter shape passed to the VectorStore + HistoryManager DIPs.
 * Maps 1:1 onto the upstream `SearchFilters` shape (snake_case keys);
 * `session_id` is the only rename (the upstream uses `run_id`).
 *
 * v0.6 adds two skill-aware filter fields (kind + excludeSuperseded) per
 * stores' composeFilters / matchesFilters via dedicated branches (not the
 * generic equality loop); the pipeline layer derives them from
 * `RecallOptions.onlySkills` / `RecallOptions.includeSuperseded` before
 * calling into the store.
 */
export interface Filters {
  readonly user_id?: string;
  readonly agent_id?: string;
  readonly session_id?: string;
  /**
   * v1.1 T2.2: multi-peer attribution filter. When set, recall returns ONLY rows
   * where `attributed_to = :attributed_to` (exact match; NULL rows do NOT match
   * any value per EC-7 empty-string semantics).
   *
   * The pipeline boundary in `src/local/index.ts::recall` routes
   * `RecallOptions.attributedTo` into this field before reaching the store.
   *
   */
  readonly attributed_to?: string;
  /**
   * v1.1 T3.1 + ADR-0011: bi-temporal point-in-time filter. When set, recall
   * returns memories that were valid at the given instant — `t_valid <= asOf
   * AND (t_invalid IS NULL OR t_invalid > asOf)`. NULL `t_valid` rows
   * (pre-bi-temporal legacy) are treated as `-Infinity` (always-valid).
   *
   * Routed from `RecallOptions.asOf` at the recall boundary. The store layer
   * composes the SQL WHERE clause; NULL-safe semantics match the
   * Apache-2.0 prior art referenced in ADR-0011 (see knowledge-base coordinates there).
   *
   */
  readonly asOf?: Date;
  /** v0.6: discriminate kind at the SQL/store layer ('extracted' | 'derived' | 'skill'). */
  readonly kind?: 'extracted' | 'derived' | 'skill';
  /**
   * v0.6: when `true`, omit rows whose `superseded_by IS NOT NULL`.
   *
   * Polarity is INVERTED relative to the public `RecallOptions.includeSuperseded`:
   * the pipeline layer translates `includeSuperseded: false` (the consumer-facing
   * default — "don't show supersession noise") into `excludeSuperseded: true`
   * (the store-facing instruction — "filter them out"). The inversion sits at
   * the pipeline boundary so the store layer reasons about ONE direction
   * ("which rows to skip") instead of carrying the consumer's double-negative.
   */
  readonly excludeSuperseded?: boolean;
  /**
   * themory-category-filter-server-side T1.1: server-side category filter.
   * When set (non-empty), list/recall return ONLY rows where `category = :category`
   * (exact byte equality; case-sensitive; NULL rows do NOT match — SQL three-valued
   * logic — per ADR D5 + EC-9).
   *
   * Single-token field name (`category`, NOT snake_case `category_` etc.) — the
   * column itself is already a single token at the SQL level, so no rename is
   * needed at the Filters boundary.
   *
   * **EC-3 normalization invariant**: the pipeline boundary (`LocalScopedMemory.getAll`)
   * AND adapter `composeFilters` BOTH normalize empty string to undefined before
   * composing the predicate, so `filters.category=''` is equivalent to omitting
   * the filter. Defense-in-depth alongside REST zod `min(1)` validation.
   *
   */
  readonly category?: string;
  /**
   * multi-tenant-workspace-isolation T1.1: the OUTER tenant anchor (ADR D1).
   * When set, every store query filters by `workspace_id = :workspace_id` so a
   * Principal only sees its own workspace's rows. Resolved from the credential's
   * Principal (ADR D3), never the request body. The store insert hoists this
   * into the `workspace_id` column (defaulting to `'default'` when omitted, the
   * no-credential collapse target per ADR D7). The REST path carries it as a
   * REQUIRED field via {@link ScopedFilters} (ADR D4 compile-time guard).
   *
   */
  readonly workspace_id?: string;
  /**
   * M8 hierarchical scope recall (owner decision 2026-07-22). Overrides the plain
   * session_id/agent_id equality with the tier's hierarchical predicate, so the
   * three tiers form a hierarchy instead of disjoint partitions:
   *
   * - `'global'` (User tier) → `session_id IS NULL AND agent_id IS NULL`. A global
   *   recall sees ONLY durable user rows — session/agent working memory never leaks in.
   * - `{ session }` (user-bound Session tier) → `agent_id IS NULL AND (session_id =
   *   :session OR session_id IS NULL)`. A session recall sees its own rows UNION the
   *   user's global rows — inside a session the agent recalls both.
   *
   * Set by {@link filtersFromScope} for the User tier and the user-bound Session tier.
   * When present, it OWNS the session_id/agent_id columns — those keys are NOT also
   * emitted as plain equalities. The workspace-admin path (Session/Agent scope with no
   * userId) does NOT use it (no acting user → no hierarchy; exact workspace-tier filter).
   * Agent/Repo tiers are distinct and keep plain equality.
   */
  readonly scopeHierarchy?: 'global' | { readonly session: string };
}

/**
 * multi-tenant-workspace-isolation — FORWARD-LOOKING scoping contract.
 *
 * `Filters` with `workspace_id` PROMOTED TO REQUIRED. The INTENT (ADR D4) is to
 * tighten the VectorStore DIP signatures to consume this type, making "forgot
 * the workspace" a TypeScript COMPILE ERROR. That tightening is NOT YET WIRED
 * (it ripples through every store adapter) — tracked as a follow-up. TODAY,
 * isolation is enforced at RUNTIME via the `Memory.withWorkspace` binding +
 * the `workspace_id NOT NULL DEFAULT 'default'` column, proven by the IDOR
 * goal test. This type is the documented target, NOT yet load-bearing — do
 * not delete it as "unused"; it marks the follow-up's contract.
 *
 */
export type ScopedFilters = Filters & { readonly workspace_id: string };
