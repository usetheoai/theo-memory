/**
 * Shared body-parsing utilities consumed by every `/v1/*` POST handler.
 *
 * Extracted from `remember.ts` per fixes-cycle-1 T1.2 (F-rev-12 absorption)
 * — `remember.ts` previously had two reasons to change (the `/v1/remember`
 * semantic AND the shared body-parser surface). SRP discipline per
 * `architecture.md § 7`. The leading underscore prefix (`_body-parsing.ts`)
 * signals "module-internal helper, not a public handler" — Hono routes are
 * mounted explicitly in `app.ts`, so the prefix is informational only.
 *
 * @see Plan theo-memory-standalone-p0-fixes-cycle-1 § T1.2 + ADR D2
 */
import type { Memory, Principal } from '@usetheo/memory/contract';
import { DEFAULT_WORKSPACE_ID, roleSatisfies } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import type { z } from 'zod';

export const EMPTY_BODY = Symbol('empty-body');
export const MALFORMED_BODY = Symbol('malformed-body');

/**
 * multi-tenant-workspace-isolation T3.1 (ADR D3): bind `memory` to the
 * authenticated Principal's workspace (injected by the auth middleware via
 * `c.set('principal')`). When no Principal is present (auth middleware not
 * mounted — e.g. a bare test harness) OR the impl predates `withWorkspace`,
 * falls back to the `default` workspace. The workspace ALWAYS comes from the
 * credential here, never from the request body.
 */
export function workspaceBoundMemory(c: Context, memory: Memory): Memory {
  const principal = c.get('principal') as Principal | undefined;
  const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  return memory.withWorkspace !== undefined ? memory.withWorkspace(workspaceId) : memory;
}

/**
 * M8 (ADR D6): the authenticated Principal's `userId`, threaded into `memory.session`
 * / `memory.agent` so a path-addressed session/agent scope is bound to the acting
 * user — `(workspace, user, session)`. `null` for a workspace-admin credential (no
 * user) → the caller omits the bind and the scope stays workspace-scoped. Returns
 * `undefined` (not `null`) so it maps directly onto the optional `userId?` param.
 */
/**
 * The user id a scoped (member) Principal is CONFINED to — used by every path/body
 * user-tier binding (`memory.user(principalUserId ?? id)`) so a member credential can
 * only address its OWN scope (M8 F-arch-1 IDOR closure).
 *
 * Role-aware (M8 ADR D6 "null (admin) → path id"): an `admin`/`owner` Principal — INCLUDING
 * the single-tenant no-credential `DEFAULT_PRINCIPAL` (role `owner`, userId `DEFAULT_OWNER_USER_ID`)
 * — MANAGES the whole workspace and must address ANY user BY PATH, so it returns `undefined` and the
 * path/body id is honored. Only a `member` returns its own userId (the IDOR override). Without this
 * the DEFAULT_PRINCIPAL's non-null owner userId hijacked every user-tier path (e.g. a plain
 * `DELETE /v1/scopes/user/alice/...` resolved to the owner's scope → 404 on alice's own row).
 */
export function principalUserId(c: Context): string | undefined {
  const principal = c.get('principal') as Principal | undefined;
  if (principal === undefined) return undefined;
  if (roleSatisfies(principal.role, 'admin')) return undefined; // admin/owner → path id honored
  return principal.userId ?? undefined; // member → confined to its own userId
}

/** MCP-parity user-scope header the edge injects (mirrors the streamable-http transport). */
const USER_SCOPE_HEADER = 'X-Theo-User-Id';

/** The edge-injected auth-trusted acting user, or undefined (no edge / SDK / dev). */
export function headerUserId(c: Context): string | undefined {
  const v = c.req.header(USER_SCOPE_HEADER)?.trim();
  return v === undefined || v === '' ? undefined : v;
}

/**
 * The acting user for scope binding (session-separation fix, 2026-07-23):
 * a member Principal's own userId (IDOR confinement — the header can never
 * widen a member) ?? the edge-injected `X-Theo-User-Id` (the gateway's broker
 * keys are workspace-admin, so without this fallback a session/agent scope
 * through the edge carried NO user and session rows landed `user_id NULL` —
 * breaking session enumeration and the SESSION ∪ GLOBAL union). Absent both →
 * undefined (workspace-admin semantics, unchanged for direct callers).
 */
export function actingUserId(c: Context): string | undefined {
  return principalUserId(c) ?? headerUserId(c);
}

/**
 * Resolve the user tier the SAME way the MCP transport does: when the body names
 * no scope tier, fall back to the auth-trusted `X-Theo-User-Id` the edge injects.
 *
 * Why: the REST surface took the tier ONLY from the body, so the Claude Code kit
 * hooks (which post no tier) landed under a project-name id invisible to the
 * dashboard, while the MCP tools landed under the credential's subject. This unifies
 * both onto one user space the dashboard reads. A body SESSION/AGENT tier keeps its
 * id (its user binding is added at resolveScope via principalUserId); for the user
 * tier (or a body with no tier) the auth-trusted header OVERRIDES a body `userId`
 * (M8 F-arch-1 — defense in depth alongside the Principal bind in resolveScope, so a
 * client-supplied userId can never address another user's global memory). An absent
 * identity stays absent so the schema's single-tier refine still fails closed.
 * Returns a NEW object; never mutates the input.
 */
export function applyHeaderUserScope<T extends Record<string, unknown>>(c: Context, body: T): T {
  const headerUser = c.req.header(USER_SCOPE_HEADER)?.trim();
  // No auth-injected identity (SDK/dev/no-auth) → trust the body verbatim.
  if (headerUser === undefined || headerUser === '') return body;
  // M8 review F-arch-1 (cross-user IDOR fix): the edge-injected X-Theo-User-Id is the
  // AUTH-TRUSTED acting user (from the credential, never the client). A session/agent
  // body keeps its tier id; its user binding is added at resolveScope via
  // principalUserId. For the user tier (or a body with no tier), the trusted header
  // identity OVERRIDES any body-supplied `userId` — so a user-Principal can NEVER
  // read/write another user's global memory by putting `{userId:'victim'}` in the body.
  const hasSessionOrAgent =
    (body['sessionId'] !== undefined && body['sessionId'] !== null) ||
    (body['agentId'] !== undefined && body['agentId'] !== null);
  if (hasSessionOrAgent) return body;
  return { ...body, userId: headerUser };
}

export async function safeJson(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) return EMPTY_BODY;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return MALFORMED_BODY;
  }
}

/**
 * Read + JSON-parse the request body, returning the parsed value OR a ready 4xx
 * Response for the malformed (400) / empty (422) cases. Callers:
 * `const json = await readJsonBody(c); if (json instanceof Response) return json;`
 * then `Schema.safeParse(json)`. Shared by the single + batch remember handlers (DRY).
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  const json = await safeJson(c);
  if (json === MALFORMED_BODY) {
    return c.json({ code: 'BAD_REQUEST', message: 'Malformed JSON body' }, 400);
  }
  if (json === EMPTY_BODY) {
    return c.json({ code: 'INVALID_BODY', message: 'Request body required' }, 422);
  }
  return json;
}

export function scopeOrValidationError(err: z.ZodError, c: Context): Response {
  const scopeIssue = err.issues.find(
    (i) => i.message.startsWith('INVALID_SCOPE'),
  );
  if (scopeIssue !== undefined) {
    return c.json(
      { code: 'INVALID_SCOPE', message: scopeIssue.message, field: 'scope' },
      422,
    );
  }
  return c.json(
    { code: 'INVALID_BODY', message: err.issues[0]?.message ?? 'Request body invalid' },
    422,
  );
}
