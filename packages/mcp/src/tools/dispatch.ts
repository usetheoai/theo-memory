/**
 * Central dispatch for v0.3 MCP `tools/call` JSON-RPC requests — T5.1.
 *
 * Maps tool name → handler; wraps each call in try/catch + routes thrown errors
 * through T4.1 classifier. Protocol Errors are THROWN as `McpError` (SDK serializes
 * to JSON-RPC `error{}`); Tool Execution Errors are RETURNED as `CallToolResult`
 * with `isError: true` (SDK serializes to JSON-RPC `result{}`).
 *
 * @see ADR D6 — TWO error mechanisms (Protocol thrown, Execution returned)
 * @see MCP spec 2025-11-25 § Error Handling
 */
import { McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Memory, MemoryEntityStore, RecallTraceStore } from '@usetheo/memory/contract';
import { classifyError, UnknownToolError } from '@usetheo/memory-agent-core';

import { addSkillHandler, TOOL_NAME as ADD_SKILL } from './add-skill-handler.js';
import { deleteEntitiesHandler, TOOL_NAME as DELETE_ENTITIES } from './delete-entities-handler.js';
import { episodesHandler, TOOL_NAME as EPISODES } from './episodes-handler.js';
import { executeSkillHandler, TOOL_NAME as EXECUTE_SKILL } from './execute-skill-handler.js';
import { explainRecallHandler, TOOL_NAME as EXPLAIN_RECALL } from './explain-recall-handler.js';
import { forgetHandler, TOOL_NAME as FORGET } from './forget-handler.js';
import { forgetSkillHandler, TOOL_NAME as FORGET_SKILL } from './forget-skill-handler.js';
import { getMemoryHandler, TOOL_NAME as GET_MEMORY } from './get-memory-handler.js';
import { listEntitiesHandler, TOOL_NAME as LIST_ENTITIES } from './list-entities-handler.js';
import { recallHandler, TOOL_NAME as RECALL } from './recall-handler.js';
import { reflectHandler, TOOL_NAME as REFLECT } from './reflect-handler.js';
import { rememberHandler, TOOL_NAME as REMEMBER } from './remember-handler.js';
import { updateMemoryHandler, TOOL_NAME as UPDATE_MEMORY } from './update-memory-handler.js';

type HandlerFn = (
  args: unknown,
  deps: { memoryFactory: () => Memory; recallTraceStore?: RecallTraceStore; memoryEntityStore?: MemoryEntityStore },
) => Promise<CallToolResult>;

const HANDLERS = new Map<string, HandlerFn>([
  [REMEMBER, rememberHandler],
  [RECALL, recallHandler],
  [FORGET, forgetHandler],
  [REFLECT, reflectHandler],
  // mcp-episodes-tool (G3-MCP) — temporal episodic read surface over MCP.
  [EPISODES, episodesHandler],
  // skills-write-surface T2.3 (D3) — author + curate skills over MCP.
  [ADD_SKILL, addSkillHandler],
  [FORGET_SKILL, forgetSkillHandler],
  // agentic-skill-execution-sandbox T2.4 — opt-in skill execution over MCP.
  [EXECUTE_SKILL, executeSkillHandler],
  // recall-trace-retention-and-mcp M4 T4.1 — explain why a recall dropped candidates.
  [EXPLAIN_RECALL, explainRecallHandler],
  // M14 T2.1 — get_memory: reuse Memory.get scoped to the Principal.
  [GET_MEMORY, getMemoryHandler],
  // M14 T2.2 — list_entities: reuse the entity read port, scoped to the Principal.
  [LIST_ENTITIES, listEntitiesHandler],
  // M14 T2.3 — update_memory: remember-then-forget (ADD-only, edge EC-1).
  [UPDATE_MEMORY, updateMemoryHandler],
  [DELETE_ENTITIES, deleteEntitiesHandler],
]);

/**
 * Dispatches a `tools/call` request to the correct handler.
 *
 * @throws McpError on Protocol Errors (-32601/-32602/-32603 per ADR D6)
 * @returns CallToolResult with isError:true|false on Tool Execution paths
 */
export async function dispatch(
  toolName: string,
  args: unknown,
  deps: { memoryFactory: () => Memory; recallTraceStore?: RecallTraceStore; memoryEntityStore?: MemoryEntityStore },
): Promise<CallToolResult> {
  try {
    const handler = HANDLERS.get(toolName);
    if (handler === undefined) {
      throw new UnknownToolError(toolName);
    }
    return await handler(args, deps);
  } catch (err: unknown) {
    const classified = classifyError(err);
    if (classified.kind === 'protocol') {
      // SDK convention: throw McpError; SDK serializes to JSON-RPC error{}.
      throw new McpError(classified.payload.code, classified.payload.message, classified.payload.data);
    }
    // Tool Execution Error: return CallToolResult{isError:true}
    // Cast readonly content to mutable for SDK CallToolResult shape compatibility.
    return classified.payload as unknown as CallToolResult;
  }
}
