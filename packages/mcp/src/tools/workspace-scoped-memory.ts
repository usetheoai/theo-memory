/**
 * `workspaceScopedMemory` — the single workspace-binding seam for the MCP tool
 * surface (plan `mcp-workspace-binding-isolation`, ADR D1). Applied at EVERY tool
 * memory-access site so a request only ever touches its own tenant's data.
 *
 * Reads the AUTH-TRUSTED `workspaceId` from the active `ScopedContext` (set by the
 * transport from the resolved Principal, NEVER from a client header — ADR D2) and
 * binds it as the outer tenant anchor via `Memory.withWorkspace`. This is the MCP
 * twin of the REST `workspaceBoundMemory` helper (theo-memory#77) and closes the
 * cross-tenant leak theo-memory#82.
 *
 * Fail-closed contract (ADR D3 / EC-1): when the scope DOES carry a workspaceId but
 * the concrete `Memory` cannot bind it (`withWorkspace` undefined), this THROWS —
 * it NEVER falls back to the unbound (all-workspace) memory the way the REST helper's
 * optional-chaining does (`_body-parsing.ts` serves unbound when withWorkspace is
 * absent). Serving unbound in multi-tenant mode is exactly the #82 leak.
 *
 * Single-tenant / no-auth dev: when the scope has no workspaceId, the memory is
 * returned unchanged → the store collapses to the `default` workspace (no cross-tenant
 * IDOR with a single workspace). On the OAuth (multi-tenant) path a blank workspace
 * can never reach here — the auth gate rejects a token whose `tenant_id` is missing or
 * blank (usetheoai/theo#477) — so the passthrough branch is genuinely single-tenant only.
 *
 * Precondition: must run inside an active `withScope(...)` block (every tool handler
 * already calls `getScope()`); outside one, `getScope()` throws `MissingScopeError`.
 */
import type { Memory } from '@usetheo/memory/contract';
import { getScope } from '@usetheo/memory-agent-core';

export function workspaceScopedMemory(memory: Memory): Memory {
  const workspaceId = getScope().workspaceId;
  // Single-tenant / no-auth dev: no workspace to bind → default workspace at the store.
  if (workspaceId === undefined || workspaceId.trim() === '') return memory;
  // Fail-closed (ADR D3 / EC-1): a workspace is set but this Memory can't bind it.
  if (memory.withWorkspace === undefined) {
    throw new Error(
      'workspaceScopedMemory: scope carries a workspaceId but this Memory exposes no withWorkspace() — ' +
        'refusing to serve unbound (fail-closed; plan ADR D3 / EC-1; theo-memory#82).',
    );
  }
  return memory.withWorkspace(workspaceId);
}
