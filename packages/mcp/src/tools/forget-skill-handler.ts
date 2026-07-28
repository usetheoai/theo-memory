/**
 * `forget_skill` dispatch handler — skills-write-surface T2.3 / D4.
 *
 * Resolves `memory.skills(repoId)` and calls `forget(skillId)`. Mirrors the
 * `forget` tool's idempotent semantic: a `MemoryNotFound` (the id is not a skill
 * in this repo's scope) returns success (idempotent curation), NOT an error.
 *
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Memory } from '@usetheo/memory/contract';
import { MemoryNotFound } from '@usetheo/memory/contract';

import { INPUT_SCHEMA, TOOL_NAME } from './forget-skill-schema.js';
import { namespacedRepoId } from './namespaced-repo-id.js';
import { workspaceScopedMemory } from './workspace-scoped-memory.js';


export { TOOL_NAME };

export async function forgetSkillHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  const scoped = workspaceScopedMemory(deps.memoryFactory()).skills(namespacedRepoId(parsed.repoId));

  try {
    await scoped.forget(parsed.skillId);
  } catch (err) {
    if (err instanceof MemoryNotFound) {
      // Idempotent curation (parity with the `forget` tool): a missing/cross-repo
      // id is treated as already-gone rather than an error.
      return {
        content: [{ type: 'text', text: `Skill ${parsed.skillId} is not present in repo '${parsed.repoId}' (already gone).` }],
        isError: false,
      };
    }
    throw err;
  }
  return {
    content: [{ type: 'text', text: `Forgot skill ${parsed.skillId} from repo '${parsed.repoId}'.` }],
    isError: false,
  };
}
