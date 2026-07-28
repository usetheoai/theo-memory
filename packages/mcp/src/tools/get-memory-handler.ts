/**
 * `get_memory` dispatch handler (M14 T2.1).
 *
 * Reuses the shipped `Memory.get(memoryId)` (`memory-store.ts:60`) through
 * `workspaceScopedMemory`, which binds the scope to the Principal `(workspace, user)`
 * resolved from the credential. The tool arg carries only `id` (ADR-M14-1): a memory
 * belonging to another workspace/user is simply not visible in this scope, so `get`
 * returns null — isolation by construction, no argument can widen it.
 *
 * @see ADR-M14-1 — identidade do Principal server-side
 * @see ADR D3 — scope binding via getScope() invariant
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Memory } from '@usetheo/memory/contract';
import { MissingScopeError } from '@usetheo/memory/contract';
import { getScope } from '@usetheo/memory-agent-core';

import { INPUT_SCHEMA, TOOL_NAME } from './get-memory-schema.js';
import { workspaceScopedMemory } from './workspace-scoped-memory.js';

export { TOOL_NAME };

export async function getMemoryHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);

  // Scope from the Principal — identity is the credential-bound context, never the args (ADR-M14-1).
  const ctx = getScope();
  const userId = ctx.session?.userId;
  if (userId === undefined || userId === '') {
    // A user-tier read (the agent reads its own memories) requires an acting user.
    throw new MissingScopeError('get_memory requires an active user scope.');
  }

  const notFound: CallToolResult = {
    content: [{ type: 'text', text: `No memory found with id ${parsed.id} in the active scope.` }],
    isError: false,
  };

  // Cross-TENANT isolation is enforced in the core (workspaceScopedMemory + LocalMemory.get,
  // #82); cross-USER isolation is enforced HERE: a row is visible ONLY when its user_id
  // MATCHES the acting Principal (M14 Phase 5 DoD bullet 6, mirrors list/delete). FAIL-CLOSED
  // (review F-tests-4): any non-match — including a missing/NULL user_id — hides the row,
  // rather than the earlier fail-open `typeof === 'string'` check that leaked null-user rows.
  const item = await workspaceScopedMemory(deps.memoryFactory()).get(parsed.id);
  if (item === null) {
    return notFound;
  }
  if (item.metadata['user_id'] !== userId) {
    return notFound;
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(item) }],
    isError: false,
  };
}
