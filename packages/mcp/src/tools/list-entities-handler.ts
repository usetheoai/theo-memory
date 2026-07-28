/**
 * `list_entities` dispatch handler (M14 T2.2).
 *
 * Reuses the shipped `MemoryEntityStore.list({ workspaceId, filters })` — the same read
 * port the REST `/entities` handler uses. The scope is built HERE from the Principal
 * (`getScope()`): the `workspace_id` and `user_id` come from the credential-bound context,
 * NEVER from a tool argument (ADR-M14-1). An agent operating over MCP is a user-tier caller
 * (the edge injects the auth-trusted user into the session), so the filter is user-scoped.
 *
 * @see ADR-M14-1 — identidade do Principal server-side
 * @see packages/api/src/server/handlers/entities.ts:88 — REST counterpart (same store call)
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Filters, Memory, MemoryEntityStore } from '@usetheo/memory/contract';
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import { MissingScopeError } from '@usetheo/memory/contract';
import { getScope } from '@usetheo/memory-agent-core';

import { INPUT_SCHEMA, TOOL_NAME } from './list-entities-schema.js';

export { TOOL_NAME };

export async function listEntitiesHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory; memoryEntityStore?: MemoryEntityStore },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);

  if (deps.memoryEntityStore === undefined) {
    return {
      content: [{ type: 'text', text: 'Entity listing is not available on this server (no entity store configured).' }],
      isError: true,
    };
  }

  // Scope from the Principal — the credential-bound context, never the args (ADR-M14-1).
  const ctx = getScope();
  const userId = ctx.session?.userId;
  if (userId === undefined || userId === '') {
    // The scope gate: an agent tool call without an acting user cannot list entities.
    throw new MissingScopeError('list_entities requires an active user scope.');
  }
  const workspaceId = ctx.workspaceId ?? DEFAULT_WORKSPACE_ID;
  // User-tier filter: (workspace, user). No session/agent sub-partition — the agent reads
  // its own accumulated entities. workspace_id + user_id are both auth-trusted.
  const filters: Filters = { workspace_id: workspaceId, user_id: userId };

  const summaries = await deps.memoryEntityStore.list({ workspaceId, filters });
  const limited = parsed.limit !== undefined ? summaries.slice(0, parsed.limit) : summaries;
  const entities = limited.map((s) => ({
    id: s.name,
    type: s.type,
    memory_count: s.memoryCount,
    last_seen_at: s.lastSeenAt,
    // F-api-5: parity with the REST /entities read side — the on-demand relation digest.
    summary: s.summary,
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify({ entities }) }],
    isError: false,
  };
}
