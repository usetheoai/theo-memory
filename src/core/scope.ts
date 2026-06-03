/**
 * Three-tier scope discriminated union and the internal Filters shape.
 *
 * @see ADR-0002 — three-tier scope (User / Session / Agent) via scoped sub-objects.
 * @see ADR-0001 — vector-based hybrid architecture (Filters renames REDACTED's `run_id` to `session_id`).
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
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T4.1 + ADR D3
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
 * Maps 1:1 onto REDACTED's `SearchFilters` shape (snake_case keys);
 * `session_id` is the only rename (REDACTED uses `run_id`).
 *
 * v0.6 adds two skill-aware filter fields (kind + excludeSuperseded) per
 * skill-library plan ADR D3 / T2.2. These are honored by the local
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
   * @see .claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § T2.2
   */
  readonly attributed_to?: string;
  /**
   * v1.1 T3.1 + ADR-0011: bi-temporal point-in-time filter. When set, recall
   * returns memories that were valid at the given instant — `t_valid <= asOf
   * AND (t_invalid IS NULL OR t_invalid > asOf)`. NULL `t_valid` rows
   * (pre-bi-temporal legacy) are treated as `-Infinity` (always-valid).
   *
   * Routed from `RecallOptions.asOf` at the recall boundary. The store layer
   * composes the SQL WHERE clause; NULL-safe semantics match the REDACTED
   * (Apache-2.0) prior art referenced in ADR-0011.
   *
   * @see .claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § T3.1
   * @see .claude/knowledge-base/adrs/ADR-0011-bi-temporal-local-runtime-gate-lift.md
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
}
