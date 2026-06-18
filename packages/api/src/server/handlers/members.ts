/**
 * `/v1/members` handlers — workspace membership management (RBAC, Slice 2).
 *
 * Every handler derives the workspace from the authenticated Principal
 * (`getPrincipal(c).workspaceId`), NEVER the body/params — so a member op for
 * another workspace resolves to `not_found` → 404 (no existence leak). Mounted
 * under `requireRole('admin')` by the composition root.
 *
 * @see .claude/knowledge-base/plans/multi-tenant-rbac-and-slice1-completion-plan.md § T2.1
 */
import type { Context } from 'hono';

import { getPrincipal } from '../auth/middleware.js';
import { AddMemberBody, SetMemberRoleBody } from '../schemas.js';
import type { MembersRepository } from '../store/members-store.js';

export async function listMembersHandler(c: Context, repo: MembersRepository): Promise<Response> {
  const { workspaceId } = getPrincipal(c);
  const members = await repo.list(workspaceId);
  return c.json({ members }, 200);
}

export async function addMemberHandler(c: Context, repo: MembersRepository): Promise<Response> {
  const { workspaceId } = getPrincipal(c);
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ code: 'BAD_REQUEST', message: 'Malformed JSON body' }, 400);
  }
  const parsed = AddMemberBody.safeParse(json);
  if (!parsed.success) {
    // 422 for schema-valid-JSON-but-invalid-fields — consistent with the 4-verb
    // handlers + the OpenAPI contract (F-dom-api-3). 400 is reserved for
    // unparseable JSON (handled above).
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Body invalid' }, 422);
  }
  // exactOptionalPropertyTypes: omit `name` entirely when absent (never pass undefined).
  const input =
    parsed.data.name !== undefined
      ? { email: parsed.data.email, name: parsed.data.name, role: parsed.data.role }
      : { email: parsed.data.email, role: parsed.data.role };
  const result = await repo.addByEmail(workspaceId, input);
  if (!result.ok) {
    return c.json({ code: 'MEMBER_EXISTS', message: 'User is already a member of this workspace.' }, 409);
  }
  return c.json({ member: result.member }, 201);
}

export async function setMemberRoleHandler(c: Context, repo: MembersRepository): Promise<Response> {
  const { workspaceId } = getPrincipal(c);
  const userId = c.req.param('userId');
  if (userId === undefined || userId === '') {
    return c.json({ code: 'NOT_FOUND', message: 'Member not found' }, 404);
  }
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ code: 'BAD_REQUEST', message: 'Malformed JSON body' }, 400);
  }
  const parsed = SetMemberRoleBody.safeParse(json);
  if (!parsed.success) {
    // 422 for schema-valid-JSON-but-invalid-fields — consistent with the 4-verb
    // handlers + the OpenAPI contract (F-dom-api-3). 400 is reserved for
    // unparseable JSON (handled above).
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Body invalid' }, 422);
  }
  const result = await repo.setRole(workspaceId, userId, parsed.data.role);
  if (!result.ok) {
    if (result.reason === 'last_owner') {
      return c.json(
        { code: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' },
        409,
      );
    }
    // not_found — either no such member OR a member of another workspace (no leak).
    return c.json({ code: 'NOT_FOUND', message: 'Member not found' }, 404);
  }
  return c.json({ member: result.member }, 200);
}

export async function removeMemberHandler(c: Context, repo: MembersRepository): Promise<Response> {
  const { workspaceId } = getPrincipal(c);
  const userId = c.req.param('userId');
  if (userId === undefined || userId === '') {
    return c.json({ code: 'NOT_FOUND', message: 'Member not found' }, 404);
  }
  const result = await repo.remove(workspaceId, userId);
  if (!result.ok) {
    if (result.reason === 'last_owner') {
      return c.json(
        { code: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' },
        409,
      );
    }
    return c.json({ code: 'NOT_FOUND', message: 'Member not found' }, 404);
  }
  return c.body(null, 204);
}
