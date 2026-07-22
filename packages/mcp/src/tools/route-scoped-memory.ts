/**
 * `routeScopedMemory` — M8 (F-xval-1) agent-chosen scope routing for the MCP tools.
 *
 * The MCP agent (Claude Code) chooses, per call, whether a fact lives in its durable
 * GLOBAL memory `(workspace, user)` or in an ephemeral SESSION sub-partition
 * `(workspace, user, session)`. The choice is expressed by supplying (session) or
 * omitting (global) a `sessionId` tool argument — exactly mirroring the REST body
 * semantics (a body-named `sessionId` routes to the session tier).
 *
 * ISOLATION INVARIANT: the user identity ALWAYS comes from the auth-trusted
 * `ScopedContext` (`ctx.session.userId`, set by the transport from the resolved
 * Principal) — NEVER from a tool argument. The agent can only pick a session
 * sub-partition of its OWN user space; it can never address another user. This is
 * why `sessionId` is safe to accept as an argument while `userId` is not.
 *
 * The GLOBAL path reuses `memoryFromCtx` unchanged (same auth-trusted userId
 * resolution + 3-state MissingScopeError). The SESSION path validates the same
 * auth-trusted userId (`authUserId`) and binds `(workspace, user, session)` — each
 * path resolves EXACTLY one tier.
 *
 * ADR: this narrows ADR D3 ("agents MUST NOT pass scope") — the agent may now pass a
 * `sessionId` sub-partition, but STILL never a `userId`/`workspaceId` (the isolation
 * anchors stay transport-bound). Recorded as an ADR amendment for M8.
 */
import type { Memory, ScopedContext, ScopedMemory } from '@usetheo/memory/contract';
import { MissingScopeError } from '@usetheo/memory/contract';
import { memoryFromCtx } from '@usetheo/memory/theokit';
import { getScope } from '@usetheo/memory-agent-core';

import { workspaceScopedMemory } from './workspace-scoped-memory.js';

/** The auth-trusted within-workspace user id, or a typed error (session-routing precondition). */
function authUserId(ctx: ScopedContext): string {
  const session = 'session' in ctx ? ctx.session : undefined;
  const userId = session !== null && session !== undefined ? session.userId : undefined;
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new MissingScopeError(
      'routeScopedMemory: an authenticated session userId is required to scope session memory (ADR D3).',
    );
  }
  return userId;
}

export function routeScopedMemory(memory: Memory, sessionId?: string): ScopedMemory {
  const ctx = getScope();
  const ws = workspaceScopedMemory(memory);
  // GLOBAL (workspace, user) — the default; memoryFromCtx is the single source of the
  // auth-trusted userId resolution + the canonical 3-state error.
  if (sessionId === undefined || sessionId.trim() === '') {
    return memoryFromCtx(ctx, ws);
  }
  // SESSION (workspace, user, session) — the agent chose a session sub-partition of its
  // OWN user space; bind the SAME auth-trusted userId (never an agent-supplied one).
  return ws.session(sessionId, authUserId(ctx));
}
