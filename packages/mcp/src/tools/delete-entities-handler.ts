/**
 * `delete_entities` dispatch handler (M14 T2.4b).
 *
 * Scoped forget of an entity (node) from the active scope's graph via the new core primitive
 * `MemoryEntityStore.forgetEntity`. The scope is built HERE from the Principal (`getScope()`):
 * `workspace_id` + `user_id` come from the credential-bound context, NEVER from a tool argument
 * (ADR-M14-1). Fail-closed at the surface (#252): without an acting user the call throws
 * `MissingScopeError` and NEVER reaches the store — an under-constrained scope never widens into
 * an open-scope delete. The store also re-checks (defense in depth: `EntityForgetScopeError`).
 *
 * @see ADR-M14-1 — identidade do Principal server-side
 * @see theo-cloud#252 — guarda fail-closed antes de qualquer deleção
 * @see packages/core/src/infrastructure/db/pg-memory-entity-store.ts — forgetEntity impl
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Filters, Memory, MemoryEntityStore } from '@usetheo/memory/contract';
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import { MissingScopeError } from '@usetheo/memory/contract';
import { getScope } from '@usetheo/memory-agent-core';

import { INPUT_SCHEMA, TOOL_NAME } from './delete-entities-schema.js';

export { TOOL_NAME };

export async function deleteEntitiesHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory; memoryEntityStore?: MemoryEntityStore },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);

  if (deps.memoryEntityStore === undefined) {
    return {
      content: [{ type: 'text', text: 'Entity deletion is not available on this server (no entity store configured).' }],
      isError: true,
    };
  }

  // Scope from the Principal — the credential-bound context, never the args (ADR-M14-1).
  const ctx = getScope();
  const userId = ctx.session?.userId;
  if (userId === undefined || userId === '') {
    // Fail-closed surface gate (#252): no acting user → abort BEFORE touching the store.
    throw new MissingScopeError('delete_entities requires an active user scope.');
  }
  const workspaceId = ctx.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const filters: Filters = { workspace_id: workspaceId, user_id: userId };

  const result = await deps.memoryEntityStore.forgetEntity({ name: parsed.name, workspaceId, filters });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          entities_removed: result.entitiesRemoved,
          links_removed: result.linksRemoved,
          edges_removed: result.edgesRemoved,
        }),
      },
    ],
    isError: false,
  };
}
