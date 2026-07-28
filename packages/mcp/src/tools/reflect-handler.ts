/**
 * `reflect` dispatch handler — T5.1.
 *
 * Synchronously triggers `ScopedMemory.reflect()` (delegates to configured
 * ReflectionPolicy; v0.0 ships ManualReflectionPolicy as default). Returns a
 * count of higher-order memories produced.
 *
 * Async sleep-time policies land at v0.4a per CLAUDE.md Roadmap Item 5 — out
 * of scope for v0.3 (plan recommendation #8: "honest scope").
 *
 * @see ADR D2 — schema + verb separation
 * @see ADR D3 — scope binding
 * @see ADR D4 — reuse memoryFromCtx
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Memory } from '@usetheo/memory/contract';
import { memoryFromCtx } from '@usetheo/memory/theokit';
import { getScope } from '@usetheo/memory-agent-core';

import { INPUT_SCHEMA, TOOL_NAME } from './reflect-schema.js';
import { workspaceScopedMemory } from './workspace-scoped-memory.js';


export { TOOL_NAME };

export async function reflectHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  INPUT_SCHEMA.parse(args); // strict empty object validation (EC-11)
  const scoped = memoryFromCtx(getScope(), workspaceScopedMemory(deps.memoryFactory()));
  const result = await scoped.reflect();
  return {
    content: [
      {
        type: 'text',
        text: `Reflection complete. Produced ${String(result.higherOrderMemories.length)} higher-order memories.`,
      },
    ],
    isError: false,
  };
}
