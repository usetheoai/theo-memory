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

export type Scope = UserScope | SessionScope | AgentScope;

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
 */
export interface Filters {
  readonly user_id?: string;
  readonly agent_id?: string;
  readonly session_id?: string;
}
