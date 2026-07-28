/**
 * Admin REST handlers for the theo_api_keys lifecycle (Camada 2).
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.1 + ADRs D2 + D6 + D7.
 *
 * Ports the Stripe-shape impl from
 * `theo-cloud/cloud/internal/routes/api_keys.go` to TypeScript + Hono.
 * Five handlers under `/v1/admin/keys/*`:
 *   - POST   /v1/admin/keys              (createKeyHandler)
 *   - GET    /v1/admin/keys/list         (listKeysHandler)
 *   - DELETE /v1/admin/keys/{id}         (revokeKeyHandler)
 *   - POST   /v1/admin/keys/{id}/rotate  (rotateKeyHandler)
 *   - GET    /v1/admin/keys/{id}/lineage (lineageKeyHandler)
 *
 * Single-tenant OSS variant (D6): `tenant_id = 'self'` constant in every
 * INSERT/SELECT. The bootstrap admin token (D7) is wired by the
 * scope-verifier middleware in T2.2; this module assumes the `subject`
 * arg is already authenticated by upstream middleware.
 *
 * EC absorptions inline:
 *   - EC-6 (UNIQUE id collision)  → mapped to 500 INTERNAL
 *   - EC-7 (scopes dedupe)        → Set conversion before INSERT
 *   - EC-2 (lineage cycle)        → UNION (not UNION ALL) + LIMIT 100
 *
 */
import { createHash, randomBytes } from 'node:crypto';

import { roleSatisfies, type WorkspaceRole } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import type { AuthPool } from '../auth/api-key-verifier.js';
import { isBootstrapAllowed, markBootstrapConsumedTx } from '../auth/bootstrap-token.js';
import { scopeSatisfies } from '../auth/scope-hierarchy.js';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

// ============================================================================
// Constants (mirror cloud-repo api_keys.go:63-93 verbatim)
// ============================================================================

const SECRET_PREFIX = 'theo_live_';
const SECRET_RANDOM_BYTES = 32;
const ROW_ID_PREFIX = 'apk-';
const LIST_LIMIT = 100;
const KEY_NAME_MAX_LENGTH = 64;
const VALID_SCOPES = new Set<string>([
  'memory:read',
  'memory:write',
  'memory:delete',
  'memory:admin',
  // Model B (ADR D1): platform-level scope — the ONLY scope allowed to mint a
  // key bound to an arbitrary target workspace_id. Strict superset of
  // memory:admin (see scope-hierarchy.ts). Carried only by the theo-cloud
  // gateway's provisioning credential.
  'memory:platform-admin',
]);
const RESERVED_SCOPES = new Set<string>([
  'rag:read', 'rag:write', 'traces:read',
  'agents:read', 'agents:invoke', 'deploys:read', 'deploys:write',
]);
const DEFAULT_GRACE_WINDOW_HOURS = 24;
const MIN_GRACE_WINDOW_HOURS = 1;
const MAX_GRACE_WINDOW_HOURS = 168;
const ROW_ID_REGEX = /^apk-[0-9a-f]{16}$/;
// Model B (EC-1): a target workspace_id is a tenant identifier; bound to the
// cloud `tn-...` shape family — alnum + dash/underscore, 1..64 chars. Rejects
// unbounded/garbage rows before they become permanent FK parents.
const WORKSPACE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
// Model B (/review BLOCKER): scopes that are an escalation if minted by a caller
// that does not already hold them. A `memory:admin` caller reaches the mint route
// (requireScope) but MUST NOT be able to mint `memory:platform-admin` (the
// arbitrary-workspace-targeting power). Base scopes are not here — an admin
// provisioning read/write/delete keys is the normal lifecycle.
const PRIVILEGED_MINT_SCOPES = new Set<string>(['memory:platform-admin']);
const TENANT_SELF = 'self';

// ============================================================================
// Helpers
// ============================================================================

function generateRowId(): string {
  return ROW_ID_PREFIX + randomBytes(8).toString('hex');
}

function generateSecret(): { raw: string; hash: string; prefix12: string } {
  const raw = SECRET_PREFIX + randomBytes(SECRET_RANDOM_BYTES).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix12: raw.slice(0, 12) };
}

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('duplicate key value') || (err as { code?: string })?.code === '23505';
}

interface ApiKeyView {
  id: string;
  name: string;
  key_prefix: string;
  scopes: readonly string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

function rowToView(row: {
  id: string;
  key_name: string;
  key_prefix: string;
  scopes: unknown;
  created_at: Date | string;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
}): ApiKeyView {
  let scopes: readonly string[] = [];
  try {
    const raw = typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes;
    if (Array.isArray(raw)) scopes = raw as string[];
  } catch {
    // EC-7 spirit (cloud): degraded view OK for list endpoint
    scopes = [];
  }
  return {
    id: row.id,
    name: row.key_name,
    key_prefix: row.key_prefix,
    scopes,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    last_used_at:
      row.last_used_at === null
        ? null
        : row.last_used_at instanceof Date
          ? row.last_used_at.toISOString()
          : row.last_used_at,
    expires_at:
      row.expires_at === null
        ? null
        : row.expires_at instanceof Date
          ? row.expires_at.toISOString()
          : row.expires_at,
  };
}

// ============================================================================
// POST /v1/admin/keys — createKeyHandler
// ============================================================================

/**
 * Optional context flag set by upstream middleware (requireScope T2.2 with
 * bootstrap bypass) to signal "this request authenticated via the bootstrap
 * token". When TRUE and the new key carries memory:admin scope, T2.2.1
 * wiring flips admin_config.bootstrap_consumed atomically — EC-3 absorption.
 *
 * Tests call createKeyHandler directly without this flag (= false), so
 * existing T2.1 tests stay backward-compatible.
 */
export interface CreateKeyHandlerOptions {
  readonly viaBootstrapToken?: boolean;
  /**
   * multi-tenant-rbac-and-slice1-completion (ADR D4): the canonical target-role
   * resolver from the `MembersRepository` DIP. When wired (production), the
   * anti-escalation guard consults this instead of an inline SQL query — keeping
   * the role-lookup knowledge in one place. When omitted (unit tests with a stub
   * pool), the guard falls back to an inline `workspace_users` SELECT.
   */
  readonly getMemberRole?: (workspaceId: string, userId: string) => Promise<WorkspaceRole | null>;
}

export async function createKeyHandler(
  c: Context,
  pool: AuthPool,
  subject: string,
  opts: CreateKeyHandlerOptions = {},
): Promise<Response> {
  let body: { name?: unknown; scopes?: unknown; expires_at?: unknown; user_id?: unknown; workspace_id?: unknown };
  try {
    body = (await c.req.json());
  } catch {
    return c.json({ code: 'INVALID_REQUEST', message: 'Invalid JSON body.' }, 400);
  }

  const trimmed = typeof body.name === 'string' ? body.name.trim() : '';
  if (trimmed === '') {
    return c.json({ code: 'EMPTY_NAME', message: 'API key name is required.' }, 400);
  }
  if (typeof body.name === 'string' && body.name.length > KEY_NAME_MAX_LENGTH) {
    return c.json(
      { code: 'NAME_TOO_LONG', message: `API key name must be ${KEY_NAME_MAX_LENGTH} characters or fewer.` },
      400,
    );
  }
  if (body.expires_at !== undefined && body.expires_at !== null) {
    if (typeof body.expires_at !== 'string') {
      return c.json({ code: 'INVALID_EXPIRES_AT', message: 'expires_at must be an ISO string.' }, 400);
    }
    const exp = new Date(body.expires_at);
    if (isNaN(exp.getTime()) || exp.getTime() <= Date.now()) {
      return c.json({ code: 'EXPIRES_IN_PAST', message: 'expires_at must be in the future.' }, 400);
    }
  }
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return c.json({ code: 'EMPTY_SCOPES', message: 'At least one scope is required.' }, 400);
  }
  for (const s of body.scopes) {
    if (typeof s !== 'string') {
      return c.json({ code: 'UNKNOWN_SCOPE', message: 'scope entries must be strings.' }, 400);
    }
    if (RESERVED_SCOPES.has(s)) {
      return c.json(
        { code: 'scope_not_yet_active', message: `Scope "${s}" is reserved for a future product surface.` },
        503,
      );
    }
    if (!VALID_SCOPES.has(s)) {
      return c.json({ code: 'UNKNOWN_SCOPE', message: `Scope "${s}" is not a known scope.` }, 400);
    }
  }

  // EC-7: dedupe scopes via Set before storage
  const dedupedScopes = Array.from(new Set(body.scopes as string[]));

  // ── RBAC anti-escalation guard (multi-tenant-rbac-and-slice1-completion T2.1
  //    / ADR D4) ────────────────────────────────────────────────────────────
  // A key may be bound to a member (`user_id`) so the role-join resolves that
  // member's role for the new key. WITHOUT a guard, an admin could mint a key
  // bound to an OWNER member → the key resolves as owner → self-escalation.
  // Guard: the target must be a member of the caller's workspace (else 422) AND
  // must NOT outrank the caller (else 403). Omitting `user_id` mints an
  // unbound (role=member via default-deny) key, unchanged from Item 20.
  // Resolve the CALLER's workspace + role from the credential ONCE. This is the
  // single source of truth for (a) the workspace the minted key belongs to —
  // every key MUST carry the caller's workspace, NEVER the schema default
  // 'default' (multi-tenant-rbac-and-slice1-completion BLOCKER fix: a non-default
  // admin minting a key previously got a 'default'-workspace credential), and
  // (b) the anti-escalation rank check below.
  //
  // Default-DENY (ADR D5 fail-closed): an unresolvable caller resolves to a
  // 'default'-workspace 'member' — NEVER 'owner' — so a lookup miss can never
  // grant escalation. The bootstrap-token path is the implicit owner
  // bootstrapping the first admin key.
  let callerWorkspace = 'default';
  let callerRole: WorkspaceRole = 'member';
  // Model B (ADR D1): the caller's scopes decide whether a target workspace_id
  // may be honored. Bootstrap is the implicit platform-admin owner (it bootstraps
  // the very first key, which may itself be the gateway's platform credential).
  let callerScopes: readonly string[] = [];
  if (opts.viaBootstrapToken === true) {
    callerRole = 'owner';
    callerScopes = ['memory:platform-admin'];
  } else {
    const header = c.req.header('authorization') ?? c.req.header('Authorization') ?? '';
    const callerToken = header.replace(/^Bearer\s+/i, '');
    const callerHash = createHash('sha256').update(callerToken).digest('hex');
    // EC-2 (Model B): read the caller's `scopes` in the SAME guarded SELECT so a
    // PG failure fails closed (503) and the platform-admin check can never be
    // bypassed by a thrown second query.
    let cr: { workspace_id: string; role: string | null; scopes: unknown } | undefined;
    try {
      const callerRow = await pool.query<{ workspace_id: string; role: string | null; scopes: unknown }>(
        `SELECT k.workspace_id, k.scopes, m.role
           FROM theo_api_keys k
           LEFT JOIN workspace_users m
             ON m.workspace_id = k.workspace_id AND m.user_id = k.user_id
          WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND k.tenant_id = 'self'
          LIMIT 1`,
        [callerHash],
      );
      cr = callerRow.rows[0];
    } catch {
      // Fail closed on auth-backend failure (ADR D5) — never proceed with a
      // privileged default.
      return c.json({ code: 'SERVICE_UNAVAILABLE', message: 'Authentication backend unavailable.' }, 503);
    }
    if (cr !== undefined) {
      callerWorkspace = cr.workspace_id;
      callerRole =
        cr.role === 'owner' || cr.role === 'admin' || cr.role === 'member' ? cr.role : 'member';
      const rawScopes: unknown = typeof cr.scopes === 'string' ? JSON.parse(cr.scopes) : cr.scopes;
      if (Array.isArray(rawScopes)) callerScopes = rawScopes.filter((s): s is string => typeof s === 'string');
    }
  }

  // ── Model B (ADR D1/D3): resolve the TARGET workspace ──────────────────────
  // An explicit `workspace_id` may bind the new key to an arbitrary workspace —
  // but ONLY for a platform-admin caller. Omitted → caller's own workspace
  // (backward-compatible). The workspace is server-authorized (caller scope +
  // explicit target), NEVER inferred from an unauthenticated body.
  let targetWorkspace = callerWorkspace;
  if (body.workspace_id !== undefined && body.workspace_id !== null) {
    if (!scopeSatisfies(callerScopes, 'memory:platform-admin')) {
      return c.json(
        { code: 'INSUFFICIENT_SCOPE_FOR_TARGET', message: 'Targeting a workspace requires the memory:platform-admin scope.' },
        403,
      );
    }
    // EC-1: validate identifier shape/length BEFORE provisioning a row.
    if (typeof body.workspace_id !== 'string' || !WORKSPACE_ID_REGEX.test(body.workspace_id)) {
      return c.json(
        { code: 'INVALID_WORKSPACE_ID', message: 'workspace_id must match [A-Za-z0-9_-]{1,64}.' },
        400,
      );
    }
    targetWorkspace = body.workspace_id;
  }

  // ── Mint-scope anti-escalation guard (Model B /review BLOCKER fix) ─────────
  // The minted key's scopes MUST NOT exceed the caller's own privilege for any
  // PRIVILEGED scope. Without this, a `memory:admin` caller (which satisfies the
  // requireScope admin gate) could mint itself a `memory:platform-admin` key and
  // then target ARBITRARY workspaces — re-opening the very confused-deputy
  // (CWE-441) Model B exists to close. Base scopes (read/write/delete) stay
  // freely mintable by an admin (existing lifecycle); only platform-admin is
  // gated. Bootstrap + a real platform-admin caller satisfy the implication.
  for (const s of dedupedScopes) {
    if (PRIVILEGED_MINT_SCOPES.has(s) && !scopeSatisfies(callerScopes, s)) {
      return c.json(
        { code: 'INSUFFICIENT_SCOPE_FOR_MINT', message: `Minting scope "${s}" requires the caller to hold it.` },
        403,
      );
    }
  }

  // ── RBAC anti-escalation guard (ADR D4) ────────────────────────────────────
  // A key bound to a member (`user_id`) resolves that member's role for the new
  // key. WITHOUT a guard, an admin could mint a key bound to an OWNER member →
  // the key resolves as owner → self-escalation. Guard: the target must be a
  // member of the caller's workspace (else 422) AND must NOT outrank the caller
  // (else 403). Omitting `user_id` mints an unbound (role=member) key.
  let boundUserId: string | null = null;
  if (body.user_id !== undefined && body.user_id !== null) {
    if (typeof body.user_id !== 'string' || body.user_id.trim() === '') {
      return c.json({ code: 'INVALID_USER_ID', message: 'user_id must be a non-empty string.' }, 400);
    }
    const requestedUserId = body.user_id;
    // Membership is checked against the TARGET workspace (the one the key binds
    // to), which equals callerWorkspace unless a platform-admin targeted another.
    const targetRole = await opts.getMemberRole?.(targetWorkspace, requestedUserId)
      ?? (await (async (): Promise<WorkspaceRole | null> => {
        const targetRow = await pool.query<{ role: string }>(
          `SELECT role FROM workspace_users WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
          [targetWorkspace, requestedUserId],
        );
        const r = targetRow.rows[0]?.role;
        return r === 'owner' || r === 'admin' || r === 'member' ? r : null;
      })());
    if (targetRole === null) {
      return c.json(
        { code: 'USER_NOT_MEMBER', message: `user_id "${requestedUserId}" is not a member of this workspace.` },
        422,
      );
    }
    if (!roleSatisfies(callerRole, targetRole)) {
      return c.json(
        { code: 'INSUFFICIENT_ROLE', message: 'Cannot mint an api key for a member that outranks you.' },
        403,
      );
    }
    boundUserId = requestedUserId;
  }

  // EC-3 (T2.2.1) — if request came via bootstrap token AND the new key
  // carries memory:admin scope, the bootstrap flag MUST be flipped
  // atomically in the SAME tx as the INSERT. Subsequent bootstrap-token
  // uses then return 401 BOOTSTRAP_CONSUMED at the requireScope layer.
  const shouldConsumeBootstrap =
    opts.viaBootstrapToken === true && dedupedScopes.includes('memory:admin');

  const { raw: secret, hash, prefix12 } = generateSecret();
  const id = generateRowId();

  try {
    if (shouldConsumeBootstrap) {
      // T3.1 — Atomic-tx via pool.connect() to pin a single connection (ADR D1, EC-3).
      // pool.query('BEGIN') may use different connections under pg.Pool.
      const client = pool.connect ? await pool.connect() : null;
      const q = client ?? pool;
      try {
        await q.query('BEGIN', []);
        const allowed = await isBootstrapAllowed(q);
        if (!allowed) {
          await q.query('ROLLBACK', []);
          return c.json(
            { code: 'BOOTSTRAP_CONSUMED', message: 'Bootstrap token has already been used. Use the issued admin key.' },
            401,
          );
        }
        // Model B (ADR D3): idempotently provision the target workspace in the
        // SAME tx so the FK is valid. Mirrors the migration-0016 seed pattern.
        await q.query(
          `INSERT INTO workspaces (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`,
          [targetWorkspace],
        );
        await q.query(
          `INSERT INTO theo_api_keys (id, subject, tenant_id, workspace_id, user_id, key_name, key_hash, key_prefix, scopes, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, subject, TENANT_SELF, targetWorkspace, boundUserId, trimmed, hash, prefix12, JSON.stringify(dedupedScopes), body.expires_at ?? null],
        );
        await markBootstrapConsumedTx(q);
        await q.query('COMMIT', []);
      } catch (innerErr) {
        try { await q.query('ROLLBACK', []); } catch { /* swallow double-rollback */ }
        if (isUniqueViolation(innerErr)) {
          return c.json({ code: 'INTERNAL', message: 'Could not create API key. Try again.' }, 500);
        }
        return c.json({ code: 'INTERNAL', message: 'Could not create API key. Try again.' }, 500);
      } finally {
        client?.release();
      }
    } else {
      // Non-bootstrap path. Model B (ADR D3): provision the target workspace
      // (idempotent) before the key INSERT so the FK resolves. Two statements
      // (not a tx) is acceptable: ON CONFLICT DO NOTHING is idempotent under
      // concurrency, and a key INSERT failing after a workspace upsert leaves
      // only an empty workspace row (harmless, reused on retry).
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`,
        [targetWorkspace],
      );
      await pool.query(
        `INSERT INTO theo_api_keys (id, subject, tenant_id, workspace_id, user_id, key_name, key_hash, key_prefix, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, subject, TENANT_SELF, targetWorkspace, boundUserId, trimmed, hash, prefix12, JSON.stringify(dedupedScopes), body.expires_at ?? null],
      );
    }
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      // EC-6: id or hash collision (astronomically unlikely; honest 500)
      return c.json({ code: 'INTERNAL', message: 'Could not create API key. Try again.' }, 500);
    }
    return c.json({ code: 'INTERNAL', message: 'Could not create API key. Try again.' }, 500);
  }

  return c.json(
    { id, name: trimmed, key_prefix: prefix12, scopes: dedupedScopes, secret },
    200,
  );
}

// ============================================================================
// GET /v1/admin/keys/list — listKeysHandler
// ============================================================================

export async function listKeysHandler(
  c: Context,
  pool: AuthPool,
  subject: string,
): Promise<Response> {
  const sql = `SELECT id, key_name, key_prefix, scopes, created_at, last_used_at, expires_at
                 FROM theo_api_keys
                WHERE subject = $1 AND tenant_id = $2 AND revoked_at IS NULL
             ORDER BY created_at DESC
                LIMIT ${LIST_LIMIT}`;
  try {
    const { rows } = await pool.query<Parameters<typeof rowToView>[0]>(sql, [subject, TENANT_SELF]);
    return c.json({ keys: rows.map(rowToView) }, 200);
  } catch {
    return c.json({ code: 'INTERNAL', message: 'Could not list API keys. Try again.' }, 500);
  }
}

// ============================================================================
// DELETE /v1/admin/keys/{id} — revokeKeyHandler
// ============================================================================

export async function revokeKeyHandler(
  c: Context,
  pool: AuthPool,
  subject: string,
): Promise<Response> {
  const id = c.req.param('id');
  // EC-2 cloud absorption: validate ID format BEFORE any DB query.
  if (!id || !ROW_ID_REGEX.test(id)) {
    return c.json({ code: 'INVALID_ID', message: 'API key id must match apk-{16hex}.' }, 400);
  }

  try {
    const result = await pool.query<{ id: string }>(
      `UPDATE theo_api_keys SET revoked_at = NOW()
        WHERE id = $1 AND subject = $2 AND tenant_id = $3 AND revoked_at IS NULL
       RETURNING id`,
      [id, subject, TENANT_SELF],
    );
    // D5 existence-leak: "not yours" + "doesn't exist" + "already revoked" all → 404
    if (result.rows.length === 0) {
      return c.json({ code: 'NOT_FOUND', message: 'API key not found.' }, 404);
    }
    return new Response(null, { status: 204 });
  } catch {
    return c.json({ code: 'INTERNAL', message: 'Could not revoke API key. Try again.' }, 500);
  }
}

// ============================================================================
// POST /v1/admin/keys/{id}/rotate — rotateKeyHandler
// ============================================================================

export async function rotateKeyHandler(
  c: Context,
  pool: AuthPool,
  subject: string,
): Promise<Response> {
  const oldId = c.req.param('id');
  if (!oldId || !ROW_ID_REGEX.test(oldId)) {
    return c.json({ code: 'INVALID_ID', message: 'API key id must match apk-{16hex}.' }, 400);
  }

  let body: { grace_window_hours?: unknown } = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    return c.json({ code: 'INVALID_REQUEST', message: 'Invalid JSON body.' }, 400);
  }
  let graceHours = DEFAULT_GRACE_WINDOW_HOURS;
  if (body.grace_window_hours !== undefined) {
    if (typeof body.grace_window_hours !== 'number') {
      return c.json(
        { code: 'INVALID_GRACE_WINDOW', message: `grace_window_hours must be a number between ${MIN_GRACE_WINDOW_HOURS} and ${MAX_GRACE_WINDOW_HOURS}.` },
        400,
      );
    }
    graceHours = body.grace_window_hours;
  }
  if (graceHours < MIN_GRACE_WINDOW_HOURS || graceHours > MAX_GRACE_WINDOW_HOURS) {
    return c.json(
      { code: 'INVALID_GRACE_WINDOW', message: `grace_window_hours must be between ${MIN_GRACE_WINDOW_HOURS} and ${MAX_GRACE_WINDOW_HOURS}.` },
      400,
    );
  }
  const graceMs = graceHours * 3_600_000;

  // T3.1 — Atomic single-tx via pool.connect() to pin a single connection (ADR D1, EC-3).
  const client = pool.connect ? await pool.connect() : null;
  const q = client ?? pool;
  try {
    await q.query('BEGIN', []);
    const sel = await q.query<{
      key_name: string;
      scopes: unknown;
      revoked_at: Date | null;
      expires_at: Date | null;
      workspace_id: string | null;
      user_id: string | null;
    }>(
      // multi-tenant-rbac-and-slice1-completion (F-dom-auth-5): also read
      // workspace_id + user_id so the rotated key PRESERVES the original key's
      // tenant + member binding (otherwise rotation silently downgraded the role
      // to default-deny 'member' and cross-workspace-misplaced the key to 'default').
      `SELECT key_name, scopes, revoked_at, expires_at, workspace_id, user_id
         FROM theo_api_keys
        WHERE id = $1 AND subject = $2 AND tenant_id = $3
        FOR UPDATE`,
      [oldId, subject, TENANT_SELF],
    );
    if (sel.rows.length === 0) {
      await q.query('ROLLBACK', []);
      return c.json({ code: 'NOT_FOUND', message: 'API key not found.' }, 404);
    }
    const old = sel.rows[0]!;
    if (old.revoked_at !== null || (old.expires_at && old.expires_at.getTime() < Date.now())) {
      await q.query('ROLLBACK', []);
      return c.json({ code: 'NOT_FOUND', message: 'API key not found.' }, 404);
    }

    const { raw: newSecret, hash: newHash, prefix12: newPrefix } = generateSecret();
    const newId = generateRowId();
    const newName = `${old.key_name} (rotated ${new Date().toISOString().slice(0, 10)})`.slice(0, KEY_NAME_MAX_LENGTH);
    const scopesRaw = typeof old.scopes === 'string' ? old.scopes : JSON.stringify(old.scopes);

    // Model B (/review MEDIUM): fail CLOSED on a missing workspace binding. The
    // column is NOT NULL, so this is defensive — but defaulting a rotated key to
    // the shared `default` workspace would cross-misplace it (the exact failure
    // the RBAC fix closed). A null here means a corrupt row: refuse, don't downgrade.
    if (old.workspace_id === null || old.workspace_id === '') {
      await q.query('ROLLBACK', []);
      return c.json({ code: 'INTERNAL', message: 'Could not rotate API key. Try again.' }, 500);
    }

    await q.query(
      `INSERT INTO theo_api_keys
         (id, subject, tenant_id, workspace_id, user_id, key_name, key_hash, key_prefix, scopes, expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [newId, subject, TENANT_SELF, old.workspace_id, old.user_id ?? null, newName, newHash, newPrefix, scopesRaw, null, oldId],
    );

    const newExpires = new Date(Date.now() + graceMs);
    await q.query(
      `UPDATE theo_api_keys SET expires_at = $1 WHERE id = $2`,
      [newExpires, oldId],
    );
    await q.query('COMMIT', []);

    return c.json(
      {
        id: newId,
        name: newName,
        key_prefix: newPrefix,
        secret: newSecret,
        old_id: oldId,
        old_expires_at: newExpires.toISOString(),
        grace_window_hours: graceHours,
      },
      200,
    );
  } catch {
    try { await q.query('ROLLBACK', []); } catch { /* ignore double-rollback */ }
    return c.json({ code: 'INTERNAL', message: 'Could not rotate API key. Try again.' }, 500);
  } finally {
    client?.release();
  }
}

// ============================================================================
// GET /v1/admin/keys/{id}/lineage — lineageKeyHandler
// ============================================================================

export async function lineageKeyHandler(
  c: Context,
  pool: AuthPool,
  subject: string,
): Promise<Response> {
  const id = c.req.param('id');
  if (!id || !ROW_ID_REGEX.test(id)) {
    return c.json({ code: 'INVALID_ID', message: 'API key id must match apk-{16hex}.' }, 400);
  }

  // EC-2: UNION (not UNION ALL) dedupes any cyclic FK; LIMIT 100 caps blast radius
  const sql = `
    WITH RECURSIVE
    ancestors AS (
      SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at, rotated_from
        FROM theo_api_keys
       WHERE id = $1 AND subject = $2 AND tenant_id = $3
      UNION
      SELECT k.id, k.key_name, k.key_prefix, k.created_at, k.revoked_at, k.expires_at, k.rotated_from
        FROM theo_api_keys k
        JOIN ancestors a ON a.rotated_from = k.id
       WHERE k.subject = $2 AND k.tenant_id = $3
    ),
    descendants AS (
      SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at, rotated_from
        FROM theo_api_keys
       WHERE id = $1 AND subject = $2 AND tenant_id = $3
      UNION
      SELECT k.id, k.key_name, k.key_prefix, k.created_at, k.revoked_at, k.expires_at, k.rotated_from
        FROM theo_api_keys k
        JOIN descendants d ON k.rotated_from = d.id
       WHERE k.subject = $2 AND k.tenant_id = $3
    ),
    full_chain AS (
      SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at FROM ancestors
      UNION
      SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at FROM descendants
    )
    SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at
      FROM full_chain
     ORDER BY created_at ASC
     LIMIT 100`;
  try {
    const { rows } = await pool.query<{
      id: string;
      key_name: string;
      key_prefix: string;
      created_at: Date | string;
      revoked_at: Date | string | null;
      expires_at: Date | string | null;
    }>(sql, [id, subject, TENANT_SELF]);
    if (rows.length === 0) {
      return c.json({ code: 'NOT_FOUND', message: 'API key not found.' }, 404);
    }
    const now = Date.now();
    const lineage = rows.map((row) => {
      const expiresMs = row.expires_at === null ? null : new Date(row.expires_at).getTime();
      const isCurrent = row.revoked_at === null && (expiresMs === null || expiresMs > now);
      return {
        id: row.id,
        name: row.key_name,
        key_prefix: row.key_prefix,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        revoked_at:
          row.revoked_at === null
            ? null
            : row.revoked_at instanceof Date
              ? row.revoked_at.toISOString()
              : row.revoked_at,
        expires_at:
          row.expires_at === null
            ? null
            : row.expires_at instanceof Date
              ? row.expires_at.toISOString()
              : row.expires_at,
        is_current: isCurrent,
      };
    });
    return c.json({ lineage }, 200);
  } catch {
    return c.json({ code: 'INTERNAL', message: 'Could not load lineage. Try again.' }, 500);
  }
}
