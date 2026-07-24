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

const GATEWAY_TRUSTED_KEY = Symbol('themory.request.gatewayTrusted');

/**
 * Mark the request as coming through a TRUSTED gateway (M16 / #121, /review Finding 2).
 *
 * Set by the bearer gate ONLY when a workspace-level credential also carries the
 * `memory:platform-admin` scope — the scope that only the theo-cloud gateway credential
 * holds. It is the explicit, auth-derived signal that authorizes honouring `X-Theo-User-Id`.
 *
 * Without it, a workspace-level key used DIRECTLY (an operator can mint an unbound key) would
 * let the client header pick any user in the workspace — a workspace-wide impersonation
 * primitive. "Workspace-level" is not "trusted gateway"; only this mark is.
 */
export function markGatewayTrusted(req: IncomingMessage): void {
  (req as IncomingMessage & { [GATEWAY_TRUSTED_KEY]?: boolean })[GATEWAY_TRUSTED_KEY] = true;
}

/** True when the bearer gate authorized gateway-injected user headers for this request. */
export function isGatewayTrusted(req: IncomingMessage): boolean {
  return (req as IncomingMessage & { [GATEWAY_TRUSTED_KEY]?: boolean })[GATEWAY_TRUSTED_KEY] === true;
}
