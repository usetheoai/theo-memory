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
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T2.1
 * @see <HOME>/Projetos/usetheo/theo-cloud/theo/cloud/internal/routes/api_keys.go
 */
import { createHash, randomBytes } from 'node:crypto';

import type { Context } from 'hono';

import type { AuthPool } from '../auth/api-key-verifier.js';
import { isBootstrapAllowed, markBootstrapConsumedTx } from '../auth/bootstrap-token.js';

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
]);
const RESERVED_SCOPES = new Set<string>([
  'rag:read', 'rag:write', 'traces:read',
  'agents:read', 'agents:invoke', 'deploys:read', 'deploys:write',
]);
const DEFAULT_GRACE_WINDOW_HOURS = 24;
const MIN_GRACE_WINDOW_HOURS = 1;
const MAX_GRACE_WINDOW_HOURS = 168;
const ROW_ID_REGEX = /^apk-[0-9a-f]{16}$/;
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
}

export async function createKeyHandler(
  c: Context,
  pool: AuthPool,
  subject: string,
  opts: CreateKeyHandlerOptions = {},
): Promise<Response> {
  let body: { name?: unknown; scopes?: unknown; expires_at?: unknown };
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
      // Atomic-tx path: BEGIN → INSERT → markBootstrapConsumedTx → COMMIT.
      // Bootstrap MUST still be allowed (not already consumed); rejected upstream
      // by requireScope but checked here defensively as a race-safety guard.
      await pool.query('BEGIN', []);
      try {
        const allowed = await isBootstrapAllowed(pool);
        if (!allowed) {
          await pool.query('ROLLBACK', []);
          return c.json(
            { code: 'BOOTSTRAP_CONSUMED', message: 'Bootstrap token has already been used. Use the issued admin key.' },
            401,
          );
        }
        await pool.query(
          `INSERT INTO theo_api_keys (id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, subject, TENANT_SELF, trimmed, hash, prefix12, JSON.stringify(dedupedScopes), body.expires_at ?? null],
        );
        await markBootstrapConsumedTx(pool);
        await pool.query('COMMIT', []);
      } catch (innerErr) {
        try { await pool.query('ROLLBACK', []); } catch { /* swallow */ }
        if (isUniqueViolation(innerErr)) {
          return c.json({ code: 'INTERNAL', message: 'Could not create API key. Try again.' }, 500);
        }
        return c.json({ code: 'INTERNAL', message: 'Could not create API key. Try again.' }, 500);
      }
    } else {
      // Non-bootstrap path: simple single-statement INSERT (preserves
      // backward compatibility with T2.1 tests).
      await pool.query(
        `INSERT INTO theo_api_keys (id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, subject, TENANT_SELF, trimmed, hash, prefix12, JSON.stringify(dedupedScopes), body.expires_at ?? null],
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

  // Atomic single-tx: BEGIN → SELECT FOR UPDATE → INSERT new → UPDATE old → COMMIT
  try {
    await pool.query('BEGIN', []);
    const sel = await pool.query<{
      key_name: string;
      scopes: unknown;
      revoked_at: Date | null;
      expires_at: Date | null;
    }>(
      `SELECT key_name, scopes, revoked_at, expires_at
         FROM theo_api_keys
        WHERE id = $1 AND subject = $2 AND tenant_id = $3
        FOR UPDATE`,
      [oldId, subject, TENANT_SELF],
    );
    if (sel.rows.length === 0) {
      await pool.query('ROLLBACK', []);
      return c.json({ code: 'NOT_FOUND', message: 'API key not found.' }, 404);
    }
    const old = sel.rows[0]!;
    if (old.revoked_at !== null || (old.expires_at && old.expires_at.getTime() < Date.now())) {
      await pool.query('ROLLBACK', []);
      return c.json({ code: 'NOT_FOUND', message: 'API key not found.' }, 404);
    }

    const { raw: newSecret, hash: newHash, prefix12: newPrefix } = generateSecret();
    const newId = generateRowId();
    const newName = `${old.key_name} (rotated ${new Date().toISOString().slice(0, 10)})`.slice(0, KEY_NAME_MAX_LENGTH);
    // Preserve scopes verbatim from old row
    const scopesRaw = typeof old.scopes === 'string' ? old.scopes : JSON.stringify(old.scopes);

    await pool.query(
      `INSERT INTO theo_api_keys
         (id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId, subject, TENANT_SELF, newName, newHash, newPrefix, scopesRaw, null, oldId],
    );

    const newExpires = new Date(Date.now() + graceMs);
    await pool.query(
      `UPDATE theo_api_keys SET expires_at = $1 WHERE id = $2`,
      [newExpires, oldId],
    );
    await pool.query('COMMIT', []);

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
    try { await pool.query('ROLLBACK', []); } catch { /* ignore double-rollback */ }
    return c.json({ code: 'INTERNAL', message: 'Could not rotate API key. Try again.' }, 500);
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
