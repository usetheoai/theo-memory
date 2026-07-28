/**
 * `execute_skill` dispatch handler — agentic-skill-execution-sandbox T2.4.
 *
 * Resolves `memory.skills(repoId)` (Repo tier, repoId from the tool ARGUMENT) and
 * calls `execute(skillId, args, opts)`. The skill-execution typed errors are mapped
 * to clear Tool Execution Errors (isError:true) so the agent learns WHY a call was
 * blocked and can self-correct: guard denial (with reason), not-configured (no
 * executor wired), backend-unavailable (addon not installed), and not-found
 * (absent / cross-scope skill — no existence leak). Other errors bubble to
 * dispatch's classifier.
 *
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Memory, SkillExecutionOptions } from '@usetheo/memory/contract';
import {
  MemoryNotFound,
  SkillExecutionNotConfiguredError,
  SkillExecutorUnavailableError,
  ToolInvocationDeniedError,
} from '@usetheo/memory/contract';

import { INPUT_SCHEMA, TOOL_NAME } from './execute-skill-schema.js';
import { namespacedRepoId } from './namespaced-repo-id.js';
import { workspaceScopedMemory } from './workspace-scoped-memory.js';


export { TOOL_NAME };

function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export async function executeSkillHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  const scoped = workspaceScopedMemory(deps.memoryFactory()).skills(namespacedRepoId(parsed.repoId));

  try {
    const result = await scoped.execute(
      parsed.skillId,
      parsed.args,
      parsed.opts as SkillExecutionOptions | undefined,
    );
    return {
      content: [{ type: 'text', text: JSON.stringify({ output: result.output, truncated: result.truncated, elapsedMs: result.elapsedMs }) }],
      isError: false,
    };
  } catch (err) {
    if (err instanceof ToolInvocationDeniedError) {
      return toolError(`Skill execution denied (${err.reason}): ${err.message}`);
    }
    if (err instanceof MemoryNotFound) {
      return toolError(`Skill not found in repo '${parsed.repoId}'.`);
    }
    if (err instanceof SkillExecutionNotConfiguredError) {
      return toolError(`Skill execution is not configured for this deployment: ${err.message}`);
    }
    if (err instanceof SkillExecutorUnavailableError) {
      return toolError(err.message);
    }
    throw err;
  }
}
