/**
 * ApiKeyAuthVerifier — Camada 2 OSS multi-user impl of the 12th DIP
 * {@link AuthVerifier}. Coexists with the env-var-based
 * {@link BearerAuthVerifier}; the dual-mode middleware (T3.1) routes
 * `theo_live_*` tokens here and other Bearers to the OIDC verifier.
 *
 * Implements the Stripe-shape pattern verified in blueprint Q1:
 *   1. Token must start with `theo_live_` prefix (length-check before any hash).
 *   2. SHA-256 single-pass hash of the raw token (per ADR D4 of the cloud
 *      plan; 256-bit entropy makes bcrypt unnecessary).
 *   3. SELECT 1 against `theo_api_keys` filtered by `key_hash` + active
 *      (revoked_at NULL + expires_at NULL OR future) + tenant_id 'self'
 *      (D6 single-tenant OSS).
 *   4. Fire-and-forget UPDATE of `last_used_at` post-match (no auth-path
 *      latency impact; observability log on failure).
 *
 * EC-8 absorption: the raw token NEVER appears in the SQL string — only
 * its SHA-256 hash is parameterized. The parameterization is the safety
 * gate; SQL metachars in the token are inert via this path.
 *
 */
import { createHash } from 'node:crypto';

import type { AuthVerifier, Principal, WorkspaceRole } from '@usetheo/memory/contract';

import { withWorkspaceContext } from './workspace-context.js';

/**
 * Minimal Pool surface — DIP-clean. Production wires `pg.Pool` (which
 * satisfies the shape verbatim). Tests pass an in-memory stub.
 *
 * Kept here (NOT in `src/core/dip/`) because Pool is an infrastructure
 * concern; `src/core/` stays free of pg-flavoured types per
 * `architecture.md § 3`.
 */
/** Minimal pool contract for auth operations. T3.1 adds `connect()` for transaction safety. */
export interface AuthPoolClient {
  query<T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

export interface AuthPool {
  query<T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[] }>;
  /** Pin a single connection for transactional operations (T3.1, ADR D1). */
  connect?(): Promise<AuthPoolClient>;
}

const PREFIX = 'theo_live_';

/** SELECT 1 SQL — parameterized + scope-isolated per D6. */
const SELECT_ACTIVE_BY_HASH_SQL = `\
SELECT id FROM theo_api_keys
 WHERE key_hash = $1
   AND revoked_at IS NULL
   AND (expires_at IS NULL OR expires_at > NOW())
   AND tenant_id = 'self'
 LIMIT 1`;

/**
 * multi-tenant-workspace-isolation T2.1: resolve the credential's workspace +
 * scopes. The WHERE predicate is VERBATIM the active-key predicate above
 * (revoked_at IS NULL AND expires_at NULL-or-future) so a revoked / expired key
 * resolves to no row → null Principal → 401 (EC-2). Only the SELECT list grows.
 */
// multi-tenant-rbac-and-slice1-completion T1.1 resolved the member's role with a
// LEFT JOIN to `workspace_users` in this same statement. That table is under FORCE
// ROW LEVEL SECURITY and this lookup runs before any workspace is known, so under
// the application role the JOIN saw no rows and every key resolved to the
// default-deny role (#227). The key row is read alone (`theo_api_keys` carries no
// row-level security), and the role is read second, under the key's own workspace.
// The WHERE predicate is VERBATIM the active-key predicate above so a revoked /
// expired key resolves to no row → null Principal → 401 (EC-2).
const SELECT_PRINCIPAL_BY_HASH_SQL = `\
SELECT k.workspace_id, k.user_id, k.scopes
 FROM theo_api_keys k
 WHERE k.key_hash = $1
   AND k.revoked_at IS NULL
   AND (k.expires_at IS NULL OR k.expires_at > NOW())
   AND k.tenant_id = 'self'
 LIMIT 1`;

/** The member's role, read under the key's workspace context (see above). */
const SELECT_MEMBER_ROLE_SQL = `\
SELECT role FROM workspace_users WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`;

/** UPDATE fire-and-forget for last_used_at observability. */
const UPDATE_LAST_USED_SQL = `UPDATE theo_api_keys SET last_used_at = NOW() WHERE key_hash = $1`;

export class ApiKeyAuthVerifier implements AuthVerifier {
  readonly #pool: AuthPool;

  constructor(pool: AuthPool) {
    this.#pool = pool;
  }

  async verify(token: string): Promise<boolean> {
    // Length-check + prefix-check BEFORE hashing — short-circuit obvious
    // non-matches without paying the SHA cost or hitting the DB.
    if (token.length <= PREFIX.length) return false;
    if (!token.startsWith(PREFIX)) return false;

    const hash = createHash('sha256').update(token).digest('hex');

    const { rows } = await this.#pool.query<{ id: string }>(
      SELECT_ACTIVE_BY_HASH_SQL,
      [hash],
    );

    if (rows.length === 0) return false;

    // Fire-and-forget last_used_at touch — never blocks the auth path.
    // Caller's observability layer logs the catch.
    // T1.6 — surface last_used_at failures instead of silently swallowing.
    void this.#pool.query(UPDATE_LAST_USED_SQL, [hash]).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[themory] last_used_at update failed: ${msg}`);
    });

    return true;
  }

  /**
   * multi-tenant-workspace-isolation T2.1 (ADR D2): resolve "whose key?" —
   * the credential's `workspaceId` + granted `scopes` — or `null` when the key
   * is unknown / revoked / expired (EC-2). The boolean {@link verify} above is
   * retained for the migration window; this is the canonical path.
   */
  async resolvePrincipal(token: string): Promise<Principal | null> {
    if (token.length <= PREFIX.length) return null;
    if (!token.startsWith(PREFIX)) return null;

    const hash = createHash('sha256').update(token).digest('hex');

    const { rows } = await this.#pool.query<{
      workspace_id: string;
      user_id: string | null;
      scopes: unknown;
    }>(SELECT_PRINCIPAL_BY_HASH_SQL, [hash]);
    const row = rows[0];
    if (row === undefined) return null;
    const memberRole = await this.#readMemberRole(row.workspace_id, row.user_id);

    // scopes is a jsonb array; pg may surface it as a parsed array OR a string.
    let scopes: readonly string[] = [];
    const raw: unknown = typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes;
    if (Array.isArray(raw)) scopes = raw.filter((s): s is string => typeof s === 'string');

    // Default-deny: a key with no membership row resolves to the least-privileged
    // role. Only the three enum values are trusted; anything else collapses to
    // 'member' (defense-in-depth against a malformed row).
    const role: WorkspaceRole =
      memberRole === 'owner' || memberRole === 'admin' || memberRole === 'member' ? memberRole : 'member';

    void this.#pool.query(UPDATE_LAST_USED_SQL, [hash]).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[themory] last_used_at update failed: ${msg}`);
    });

    return { workspaceId: row.workspace_id, userId: row.user_id, role, scopes };
  }

  /** `null` for a key bound to no user — nothing to look up, and no connection spent. */
  async #readMemberRole(workspaceId: string, userId: string | null): Promise<string | null> {
    if (userId === null) return null;
    return withWorkspaceContext(this.#pool, workspaceId, async (q) => {
      const { rows } = await q.query<{ role: string }>(SELECT_MEMBER_ROLE_SQL, [workspaceId, userId]);
      return rows[0]?.role ?? null;
    });
  }
}
