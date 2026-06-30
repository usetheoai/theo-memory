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
