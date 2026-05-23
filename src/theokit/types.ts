/**
 * `ScopedContext` — structural interface consumed by `memoryFromCtx` (T1.1).
 *
 * @see ADR D1 — structural typing over peer-dep on `theokit`
 * @see ADR D4 — 3-state resolver (a userId-present / b session-null / c session-or-userId-absent)
 * @see ADR D6 — `@usetheo/memory/theokit` subpath ships independent of the main barrel
 *
 * ZERO peer-dependency on `theokit`. Any consumer whose request context exposes
 * `ctx.session.userId` satisfies this via structural typing — verified across
 * 5 TheoKit fixtures in blueprint Q5 (sessions-auth, template-saas,
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
   * MUST handle distinctly per ADR D4.
   */
  session?: {
    /**
     * Caller-supplied user identifier. The binding TRUSTS this verbatim per
     * blueprint Q7 — no normalization, no namespacing. Consumer is responsible
     * for cross-tenant disambiguation (e.g., `"t-${tenantId}-u-${userId}"`).
     */
    userId?: string;
    /** RESERVED for v0.3+ session-tier auto-resolution. Ignored by v0.2 binding. */
    sessionId?: string;
    /** RESERVED for v0.3+ agent-tier auto-resolution. Ignored by v0.2 binding. */
    agentId?: string;
  } | null;
}
