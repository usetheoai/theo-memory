/**
 * `forget` dispatch handler — T5.1.
 *
 * SEPA gotcha #1 absorbed: `forget` is on TOP-LEVEL `Memory`, NOT `ScopedMemory`
 * (per `src/core/memory-store.ts:60`). Handler calls `deps.memoryFactory().forget(id)`
 * directly. STILL gates by `getScope()` to preserve the scope-required invariant
 * (prevents anonymous bulk-delete via stdio).
 *
 * `all: true` → "bulk delete deferred to v0.4" Tool Execution Error
 * (no `Memory.forgetAll` exists; `Memory.reset(scope)` is admin-only and out of
 * scope for v0.3 agent tools per plan T5.1 § Deep Dives).
 *
 * EC-14 absorbed: `Memory.forget(unknownId)` throws `MemoryNotFound` (v0.1 EC-12
 * divergence from the upstream). Handler catches → returns idempotent success per agent
 * REST DELETE semantics.
 *
 * @see ADR D2 — schema + verb separation
 * @see ADR D3 — scope binding (called for invariant; result discarded)
 * @see ADR D6 — Tool Execution Error for deferred + idempotent paths
 * @see EC-14 — forget unknown-id idempotent
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { MemoryNotFound } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';
import { getScope } from '@usetheo/memory/agent-tools';

import { INPUT_SCHEMA, TOOL_NAME } from './forget-schema.js';

export { TOOL_NAME };

export async function forgetHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);

  // Gate on scope even for forget — prevents anonymous bulk-delete via stdio.
  // Throws MissingScopeError → dispatch classifier → Tool Execution Error.
  getScope();

  if (parsed.all === true) {
    return {
      content: [
        {
          type: 'text',
          text: 'Bulk delete (forget all:true) is deferred to v0.4. For v0.3, delete memories individually by id.',
        },
      ],
      isError: true,
    };
  }

  // parsed.id is guaranteed present here by the XOR refine in T2.1 schema
  if (parsed.id === undefined) {
    return {
      content: [{ type: 'text', text: 'Internal: forget refine should have rejected missing id.' }],
      isError: true,
    };
  }

  try {
    await deps.memoryFactory().forget(parsed.id);
    return {
      content: [{ type: 'text', text: `Memory ${parsed.id} forgotten.` }],
      isError: false,
    };
  } catch (err: unknown) {
    if (err instanceof MemoryNotFound) {
      // EC-14: idempotent success per REST DELETE semantics
      return {
        content: [{ type: 'text', text: `No memory found with id ${parsed.id} (already forgotten or never existed).` }],
        isError: false,
      };
    }
    throw err; // unhandled → dispatch classifier
  }
}
