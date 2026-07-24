/**
 * Per-request workspace attachment for the node:http MCP transport — plan
 * `mcp-workspace-binding-isolation` (ADR D2). The bearer gate (`withBearerAuth`)
 * resolves the `Principal` from the credential and attaches its `workspaceId`
 * here; the streamable-HTTP transport reads it back into the `ScopedContext`.
 *
 * The workspace is carried on the request object (a fresh `IncomingMessage` per
 * request — no shared mutable state across concurrent requests) behind a module
 * Symbol so it cannot collide with any header/field a client controls. This is
 * the trust boundary: the workspace comes from the AUTHENTICATED key, never from
 * a client-supplied header/body (theo-data invariant 3, theo-memory#82).
 */
import type { IncomingMessage } from 'node:http';

const WORKSPACE_KEY = Symbol('themory.request.workspaceId');

/** Attach the auth-resolved workspace to the request (called by the bearer gate). */
export function attachWorkspace(req: IncomingMessage, workspaceId: string): void {
  (req as IncomingMessage & { [WORKSPACE_KEY]?: string })[WORKSPACE_KEY] = workspaceId;
}

/** Read the auth-attached workspace, or `undefined` when none was resolved (no-auth dev). */
export function workspaceFromRequest(req: IncomingMessage): string | undefined {
  return (req as IncomingMessage & { [WORKSPACE_KEY]?: string })[WORKSPACE_KEY];
}

const USER_KEY = Symbol('themory.request.userId');

/**
 * Attach the auth-resolved user to the request (called by the bearer gate when the resolved
 * Principal carries one).
 *
 * M16 (#121). The workspace was already trusted this way; the USER tier was not — it came
 * from `X-Theo-User-Id`, a header the client controls. With the MCP server exposed directly
 * (`themory mcp --transport streamable-http --auth api-keys`, no gateway in front), the bearer
 * of any key in a workspace could therefore act as any other user in it. The tools were
 * correct throughout — they read `getScope()`; the transport that BUILT that scope was not.
 *
 * Same Symbol discipline as the workspace: a module-private Symbol cannot collide with any
 * header or body field a client can set.
 */
export function attachUser(req: IncomingMessage, userId: string): void {
  (req as IncomingMessage & { [USER_KEY]?: string })[USER_KEY] = userId;
}

/**
 * Read the auth-attached user, or `undefined` when the credential is workspace-level.
 *
 * `undefined` is a legitimate, load-bearing state: a workspace-level credential is exactly the
 * gateway topology (Model B), where the gateway resolves the end user and injects the
 * auth-trusted header. Ignoring the header unconditionally would break it.
 */
export function userFromRequest(req: IncomingMessage): string | undefined {
  return (req as IncomingMessage & { [USER_KEY]?: string })[USER_KEY];
}
