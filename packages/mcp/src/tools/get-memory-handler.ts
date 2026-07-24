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
import { getScope } from '@usetheo/memory-agent-core';

import { workspaceScopedMemory } from './workspace-scoped-memory.js';
import { INPUT_SCHEMA, TOOL_NAME } from './get-memory-schema.js';

export { TOOL_NAME };

export async function getMemoryHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);

  // Scope gate — the Principal is required; anonymous stdio cannot read arbitrary ids.
  getScope();

  const item = await workspaceScopedMemory(deps.memoryFactory()).get(parsed.id);
  if (item === null) {
    return {
      content: [{ type: 'text', text: `No memory found with id ${parsed.id} in the active scope.` }],
      isError: false,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(item) }],
    isError: false,
  };
}
