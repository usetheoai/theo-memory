/**
 * `update_memory` dispatch handler (M14 T2.3).
 *
 * ADD-only "update" (ADR-0003): `remember(newText)` THEN `forget(oldId)`. The ORDER is
 * the fix for edge EC-1 — if `remember` fails (empty extraction / provider error), the
 * `forget` NEVER runs, so the old memory stays alive (degrade to no-op, never data loss).
 * The old id's history is preserved (soft-delete). Returns the NEW id (contract diverges
 * from the reference's "overwrite by id" — the agent must re-anchor on the new id).
 *
 * Scope is the Principal via routeScopedMemory / workspaceScopedMemory (ADR-M14-1); the
 * arg carries only id + content, no identity.
 *
 * @see ADR-0003 — ADD-only; @see ADR-M14-1 — Principal scope; edge EC-1 — order matters
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MemoryNotFound } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';
import { getScope } from '@usetheo/memory-agent-core';

import { routeScopedMemory } from './route-scoped-memory.js';
import { INPUT_SCHEMA, TOOL_NAME } from './update-memory-schema.js';

export { TOOL_NAME };

export async function updateMemoryHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  getScope(); // scope gate — the Principal is required

  // STEP 1 — remember FIRST (edge EC-1). A failed remember must not have deleted anything.
  // The factory is resolved INSIDE the binding wrapper on every memory-op line (#82 guard):
  // routeScopedMemory delegates to workspaceScopedMemory, so remember is workspace-bound.
  const scoped = routeScopedMemory(deps.memoryFactory(), undefined);
  const items = await scoped.remember(parsed.content, undefined);
  if (items.length === 0) {
    // Nothing was persisted (empty extraction / provider error). Do NOT forget the old
    // row — the update degrades to a no-op, the old memory stays alive. (EC-1)
    return {
      content: [{
        type: 'text',
        text: `Update aborted: the new text produced no stored memory (extractor returned empty). The existing memory ${parsed.id} was left intact.`,
      }],
      isError: true,
    };
  }

  // STEP 2 — only now retire the old memory. The forget is SUBJECT-SCOPED (the same
  // (workspace, user) `scoped` from STEP 1, ScopedMemory.forget → deleteInScope), NOT the
  // workspace-only Memory.forget — so a foreign id (another user in the same workspace, or
  // another workspace) is NOT in scope and MemoryNotFound is raised, never deleting another
  // subject's row. This closes the cross-user forget IDOR the review found (symmetric to the
  // get_memory cross-user gate; ADR-M14-1 / DoD bullet 6).
  try {
    await scoped.forget(parsed.id);
  } catch (err: unknown) {
    // Old id already gone OR not in this subject scope → the new memory still stands.
    if (!(err instanceof MemoryNotFound)) throw err;
  }

  const newIds = items.map((i) => i.id).join(', ');
  return {
    content: [{
      type: 'text',
      text: `Updated: stored new memory ${newIds} and retired ${parsed.id}. Use the new id to reference this memory.`,
    }],
    isError: false,
  };
}
