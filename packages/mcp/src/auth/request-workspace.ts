/**
 * Per-request workspace attachment for the node:http MCP transport — plan
 * `mcp-workspace-binding-isolation` (ADR D2). The OAuth resource-server gate
 * (`withOAuthResourceServer`) validates the access token and attaches its
 * `tenant_id` as the workspace and its `sub` as the user; the streamable-HTTP
 * transport reads them back into the `ScopedContext` and the workspace scope.
 *
 * The workspace is carried on the request object (a fresh `IncomingMessage` per
 * request — no shared mutable state across concurrent requests) behind a module
 * Symbol so it cannot collide with any header/field a client controls. This is
 * the trust boundary: the workspace comes from the VALIDATED token, never from
 * a client-supplied header/body (theo-data invariant 3, theo-memory#82).
 */
import type { IncomingMessage } from 'node:http';

const WORKSPACE_KEY = Symbol('themory.request.workspaceId');

/** Attach the token's tenant as the request's workspace (called by the auth gate). */
export function attachWorkspace(req: IncomingMessage, workspaceId: string): void {
  (req as IncomingMessage & { [WORKSPACE_KEY]?: string })[WORKSPACE_KEY] = workspaceId;
}

/** Read the auth-attached workspace, or `undefined` when none was resolved (no-auth dev). */
export function workspaceFromRequest(req: IncomingMessage): string | undefined {
  return (req as IncomingMessage & { [WORKSPACE_KEY]?: string })[WORKSPACE_KEY];
}

const USER_KEY = Symbol('themory.request.userId');

/**
 * Attach the token's subject as the request's user (called by the auth gate).
 *
 * M16 (#121): the user used to come from `X-Theo-User-Id`, a header the client controls, which
 * let the bearer of any credential in a workspace act as any other user in it. The user now
 * comes from the validated token's `sub`; the header is ignored. Same Symbol discipline as the
 * workspace: a module-private Symbol cannot collide with any header or body field.
 */
export function attachUser(req: IncomingMessage, userId: string): void {
  (req as IncomingMessage & { [USER_KEY]?: string })[USER_KEY] = userId;
}

/** Read the auth-attached user (the access token's `sub`), or `undefined` without auth. */
export function userFromRequest(req: IncomingMessage): string | undefined {
  return (req as IncomingMessage & { [USER_KEY]?: string })[USER_KEY];
}
