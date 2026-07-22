/**
 * M11 T3.1 — routing-governance REST handlers (ADR D1/D2/D3).
 *
 * - `GET  /v1/routing-policy/:userId`  → the `(workspace, userId)` policy (fail-closed default if none).
 * - `PUT  /v1/routing-policy/:userId`  → upsert the policy (ADMIN-scoped write; 403 for a member).
 * - `GET  /v1/routing-audit/:userId`   → the `(workspace, userId)`-scoped placement-decision audit.
 *
 * Workspace comes from the credential's Principal; the target user from the PATH. Isolation (ADR D3):
 * a MEMBER may only address its OWN `userId` — a cross-user path resolves to 404 (no existence leak),
 * mirroring `scoped-forget.ts`. An admin/owner manages any user in its workspace.
 */
import type { RoutingAuditStore, RoutingPolicyStore } from '@usetheo/memory/contract';
import { InvalidRoutingPolicy, roleSatisfies } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import { getPrincipal } from '../auth/middleware.js';

/** Resolve the target `(workspace, userId)` a caller may address, or `null` when isolation forbids it. */
function resolveTarget(c: Context, targetUserId: string): { workspaceId: string; userId: string } | null {
  // F-arch-2: resolve via getPrincipal so an absent Principal defaults to DEFAULT_PRINCIPAL (owner)
  // and passes the SAME role/isolation branch — no special-case grant.
  const p = getPrincipal(c);
  // A member is confined to its own userId; a cross-user address → 404 (ADR D3). Admin/owner: any user.
  if (!roleSatisfies(p.role, 'admin') && p.userId !== targetUserId) {
    return null;
  }
  return { workspaceId: p.workspaceId, userId: targetUserId };
}

export async function getRoutingPolicyHandler(c: Context, store: RoutingPolicyStore): Promise<Response> {
  const userId = c.req.param('userId');
  if (userId === undefined || userId.length === 0) return c.notFound();
  const target = resolveTarget(c, userId);
  if (target === null) return c.json({ code: 'NOT_FOUND', message: 'Routing policy not found' }, 404);
  const policy = await store.get(target.workspaceId, target.userId);
  return c.json(policy, 200);
}

export async function putRoutingPolicyHandler(c: Context, store: RoutingPolicyStore): Promise<Response> {
  const userId = c.req.param('userId');
  if (userId === undefined || userId.length === 0) return c.notFound();
  // ADMIN-scoped write (ADR D1): a member cannot set a routing policy. getPrincipal so an absent
  // Principal defaults to owner (honored) rather than bypassing the role check (F-arch-3).
  const p = getPrincipal(c);
  if (!roleSatisfies(p.role, 'admin')) {
    return c.json({ code: 'FORBIDDEN', message: 'admin role required to set a routing policy' }, 403);
  }
  const workspaceId = p.workspaceId;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 'INVALID', message: 'body must be JSON' }, 400);
  }
  try {
    const saved = await store.put(workspaceId, userId, body);
    return c.json(saved, 200);
  } catch (err) {
    if (err instanceof InvalidRoutingPolicy) {
      return c.json({ code: 'INVALID', message: err.message }, 400);
    }
    throw err;
  }
}

export async function getRoutingAuditHandler(c: Context, store: RoutingAuditStore): Promise<Response> {
  const userId = c.req.param('userId');
  if (userId === undefined || userId.length === 0) return c.notFound();
  const target = resolveTarget(c, userId);
  if (target === null) return c.json({ code: 'NOT_FOUND', message: 'Routing audit not found' }, 404);
  const rows = await store.list(target.workspaceId, target.userId);
  return c.json({ items: rows }, 200);
}
