/**
 * Binds the authenticated workspace to the request's async context, so that
 * every database statement it triggers is confined to that workspace by the
 * database itself.
 *
 * Mounted AFTER `bearerAuth`: the scope must come from the resolved Principal,
 * never from the body, the path or a header the caller controls. That ordering
 * is the whole security property — a scope taken from caller input would let a
 * client name someone else's workspace and have RLS faithfully honour it.
 *
 * @see @usetheo/memory/core — workspace-scope.ts, tenant-scoped-pool.ts
 * @see migrations/0029_rls_fail_closed.sql
 */
import { withWorkspaceScope } from '@usetheo/memory';
import type { MiddlewareHandler } from 'hono';

import { getPrincipal } from '../auth/middleware.js';

/**
 * Runs the remainder of the request inside the Principal's workspace scope.
 *
 * Routes that deliberately span workspaces (platform administration) must not
 * be mounted behind this middleware; they declare themselves through
 * `withCrossWorkspaceScope` instead, which is auditable in a way that "no
 * scope" never is.
 */
export function workspaceScope(): MiddlewareHandler {
  return async (c, next) => {
    const { workspaceId } = getPrincipal(c);
    await withWorkspaceScope(workspaceId, async () => {
      await next();
    });
  };
}
