/**
 * `add_skill` dispatch handler — skills-write-surface T2.3.
 *
 * Resolves `memory.skills(repoId)` (Repo tier, repoId from the tool ARGUMENT —
 * NOT the AsyncLocalStorage scope) and calls `add(draft)`. A dedup-collision
 * (`SkillAlreadyExists`, D1) returns a Tool Execution Error (isError:true) with
 * a clear message; other domain errors (`InvalidSkillError`) bubble to dispatch's
 * classifier. Store-only — the code is never executed.
 *
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Memory } from '@usetheo/memory/contract';
import { SkillAlreadyExists } from '@usetheo/memory/contract';

import { INPUT_SCHEMA, TOOL_NAME } from './add-skill-schema.js';
import { namespacedRepoId } from './namespaced-repo-id.js';
import { workspaceScopedMemory } from './workspace-scoped-memory.js';


export { TOOL_NAME };

export async function addSkillHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  const scoped = workspaceScopedMemory(deps.memoryFactory()).skills(namespacedRepoId(parsed.repoId));

  try {
    const skill = await scoped.add({
      code: parsed.code,
      description: parsed.description,
      codeLanguage: parsed.codeLanguage,
    });
    return {
      content: [{ type: 'text', text: `Skill stored: ${skill.id} (hash ${skill.hash})` }],
      isError: false,
    };
  } catch (err) {
    if (err instanceof SkillAlreadyExists) {
      return {
        content: [
          {
            type: 'text',
            text: `A skill with this description already exists in repo '${parsed.repoId}'. Skills are ADD-only: revise the description or forget the existing skill first.`,
          },
        ],
        isError: true,
      };
    }
    throw err;
  }
}
