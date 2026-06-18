/**
 * Principal + Workspace — the multi-tenant workspace-isolation domain types.
 *
 * A {@link Principal} is what an {@link AuthVerifier} resolves FROM a credential:
 * it answers "whose key is this?" (the tenant + its granted scopes), not merely
 * "is this key valid?". Every authenticated request carries a Principal; every
 * datum belongs to the Principal's {@link Workspace}; every query is scoped by
 * `workspaceId`. Application-level isolation (ADR D8), not per-database.
 *
 * The three memory tiers (User / Session / Agent) are UNCHANGED — they remain
 * within-workspace partitions. `workspaceId` is the orthogonal OUTER tenant
 * anchor (ADR D1). See `architecture.md § 1` (tiers locked) + the CLAUDE.md
 * PRIORITY 0 Amendment 2026-06-17 (strategic review).
 *
 * @see .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md § T0.1
 */

/**
 * The tenant boundary. Every datum belongs to exactly one workspace; a
 * credential resolves to exactly one workspace.
 */
export interface Workspace {
  /** Stable identifier. The seeded fallback uses {@link DEFAULT_WORKSPACE_ID}. */
  readonly id: string;
  /** Human-facing label. */
  readonly name: string;
  /** When the workspace was created. */
  readonly createdAt: Date;
}

/**
 * A user's privilege WITHIN a workspace (the `workspace_users.role` enum).
 * Orthogonal to {@link Principal.scopes} (the key's capability): `role` gates
 * MEMBERSHIP management (who can add/remove members, mint keys), `scopes` gates
 * data CAPABILITY (read/write/delete/admin). Resolved by LEFT JOINing
 * `workspace_users`; a credential with no membership row resolves to the
 * least-privileged `'member'` (default-deny).
 *
 * @see .claude/knowledge-base/plans/multi-tenant-rbac-and-slice1-completion-plan.md § T0.1 + ADR D1
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member';

/**
 * Ordinal privilege ranking — higher is more privileged. Used by
 * {@link roleSatisfies} to answer "is this role at least as privileged as the
 * minimum the route requires?".
 */
const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * True when `role` is at least as privileged as `min`. `owner` satisfies every
 * minimum; `member` satisfies only `member`. The gate that `requireRole(min)`
 * and the key-mint anti-escalation guard both consult.
 */
export function roleSatisfies(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Resolved from a credential by {@link AuthVerifier.resolvePrincipal}. Carries
 * the tenant (`workspaceId`), the member the key acts as (`userId`, null for
 * legacy keys), that member's workspace `role`, and the key's capability set
 * (`scopes`, mirroring the `theo_api_keys.scopes` JSONB shape). `workspaceId`
 * is injected server-side into every scoped query and MUST NOT be taken from
 * the request body (ADR D3).
 */
export interface Principal {
  /** The tenant the credential belongs to. */
  readonly workspaceId: string;
  /** The member the credential acts as; `null` for a legacy key with no member. */
  readonly userId: string | null;
  /** The member's role in this workspace (default-deny resolves to `'member'`). */
  readonly role: WorkspaceRole;
  /** Granted capability scopes (e.g. `memory:read`, `memory:write`, `memory:admin`). */
  readonly scopes: readonly string[];
}

/**
 * Stable id of the workspace every legacy / no-credential request collapses to
 * (ADR D7). A FIXED literal (not a random UUID) so the env-key bridge and the
 * no-credential path resolve it without a lookup race, and the `0016` seed is
 * idempotent across re-runs (EC-6 / EC-7).
 */
export const DEFAULT_WORKSPACE_ID = 'default';

/**
 * Stable id of the seeded user every legacy / no-credential request acts as —
 * the owner of the {@link DEFAULT_WORKSPACE_ID} workspace (seeded by migration
 * `0017`). A FIXED literal so the env-key bridge resolves it without a lookup.
 */
export const DEFAULT_OWNER_USER_ID = 'default-owner';

/**
 * Build the backward-compatible boolean `verify(token)` from a verifier that
 * implements {@link AuthVerifier.resolvePrincipal} (ADR D2 additive-then-breaking):
 * a token is "valid" iff it resolves to a non-null Principal. Lets the ~12
 * existing `AuthVerifier` consumers keep compiling during the migration window.
 */
export function makeVerifyShim(
  verifier: { resolvePrincipal(token: string): Promise<Principal | null> },
): (token: string) => Promise<boolean> {
  return async (token: string): Promise<boolean> =>
    (await verifier.resolvePrincipal(token)) !== null;
}
