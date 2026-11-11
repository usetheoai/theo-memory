/**
 * `tools/list` JSON-RPC response emitter for v0.3 MCP server.
 *
 * Returns the registered tools in locked-verb-first declaration order
 * (remember/recall/forget/reflect, then episodes, then the skills tools) with their
 * JSON Schema 7 inputSchemas + recall's/episodes' outputSchema. Wired into the
 * `McpServer` constructor at T1.1 via `setRequestHandler(ListToolsRequestSchema, ...)`.
 *
 * @see ADR D2 — Tool schema codegen (zod-authored, separate tools, listChanged:false)
 * @see ADR D9 — JSON Schema dialect lock (target='jsonSchema7' via emitToolSchema)
 * @see MCP spec 2025-11-25 § Listing Tools (blueprint Q7 wire shape)
 */
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

import {
  TOOL_NAME as ADD_SKILL_NAME,
  DESCRIPTION as ADD_SKILL_DESC,
  INPUT_SCHEMA as addSkillInput,
} from './add-skill-schema.js';
import {
  TOOL_NAME as DELETE_ENTITIES_NAME,
  DESCRIPTION as DELETE_ENTITIES_DESC,
  INPUT_SCHEMA as deleteEntitiesInput,
} from './delete-entities-schema.js';
import {
  TOOL_NAME as EPISODES_NAME,
  DESCRIPTION as EPISODES_DESC,
  INPUT_SCHEMA as episodesInput,
  OUTPUT_SCHEMA as episodesOutput,
} from './episodes-schema.js';
import {
  TOOL_NAME as EXECUTE_SKILL_NAME,
  DESCRIPTION as EXECUTE_SKILL_DESC,
  INPUT_SCHEMA as executeSkillInput,
} from './execute-skill-schema.js';
import {
  TOOL_NAME as EXPLAIN_RECALL_NAME,
  DESCRIPTION as EXPLAIN_RECALL_DESC,
  INPUT_SCHEMA as explainRecallInput,
} from './explain-recall-schema.js';
import {
  TOOL_NAME as FORGET_NAME,
  DESCRIPTION as FORGET_DESC,
  INPUT_SCHEMA as forgetInput,
} from './forget-schema.js';
import {
  TOOL_NAME as FORGET_SKILL_NAME,
  DESCRIPTION as FORGET_SKILL_DESC,
  INPUT_SCHEMA as forgetSkillInput,
} from './forget-skill-schema.js';
import {
  TOOL_NAME as GET_MEMORY_NAME,
  DESCRIPTION as GET_MEMORY_DESC,
  INPUT_SCHEMA as getMemoryInput,
} from './get-memory-schema.js';
import {
  TOOL_NAME as LIST_ENTITIES_NAME,
  DESCRIPTION as LIST_ENTITIES_DESC,
  INPUT_SCHEMA as listEntitiesInput,
} from './list-entities-schema.js';
import {
  TOOL_NAME as RECALL_NAME,
  DESCRIPTION as RECALL_DESC,
  INPUT_SCHEMA as recallInput,
  OUTPUT_SCHEMA as recallOutput,
} from './recall-schema.js';
import {
  TOOL_NAME as REFLECT_NAME,
  DESCRIPTION as REFLECT_DESC,
  INPUT_SCHEMA as reflectInput,
} from './reflect-schema.js';
import {
  TOOL_NAME as REMEMBER_NAME,
  DESCRIPTION as REMEMBER_DESC,
  INPUT_SCHEMA as rememberInput,
} from './remember-schema.js';
import { emitToolSchema } from './schema-emit.js';
import {
  DESCRIPTION as SEARCH_MESSAGES_DESC,
  INPUT_SCHEMA as searchMessagesInput,
  OUTPUT_SCHEMA as searchMessagesOutput,
  TOOL_NAME as SEARCH_MESSAGES_NAME,
} from './search-messages-schema.js';
import {
  TOOL_NAME as UPDATE_MEMORY_NAME,
  DESCRIPTION as UPDATE_MEMORY_DESC,
  INPUT_SCHEMA as updateMemoryInput,
} from './update-memory-schema.js';

/** Spec-compliant `tools/list` response shape (no pagination for 4 static tools). */
export type ToolsListResponse = ListToolsResult;

/**
 * Builds the spec-compliant `tools/list` result payload.
 *
 * Order honors CLAUDE.md § Locked names verb order: `remember/recall/forget/reflect`,
 * then the native `episodes` tool, then the skills tools.
 * No `nextCursor` (static tool list per ADR D2's `listChanged:false` declaration).
 *
 * Pure function — no side effects, deterministic. Server constructor calls this
 * once at boot OR memoizes per request; either is safe.
 */
export function buildToolsListResponse(): ToolsListResponse {
  return {
    tools: [
      {
        name: REMEMBER_NAME,
        description: REMEMBER_DESC,
        inputSchema: emitToolSchema(rememberInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      {
        name: RECALL_NAME,
        description: RECALL_DESC,
        inputSchema: emitToolSchema(recallInput) as ToolsListResponse['tools'][number]['inputSchema'],
        outputSchema: emitToolSchema(recallOutput) as ToolsListResponse['tools'][number]['outputSchema'],
      },
      {
        name: FORGET_NAME,
        description: FORGET_DESC,
        inputSchema: emitToolSchema(forgetInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      {
        name: REFLECT_NAME,
        description: REFLECT_DESC,
        inputSchema: emitToolSchema(reflectInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      // mcp-episodes-tool (G3-MCP) — temporal episodic read surface (ships outputSchema, like recall).
      {
        name: EPISODES_NAME,
        description: EPISODES_DESC,
        inputSchema: emitToolSchema(episodesInput) as ToolsListResponse['tools'][number]['inputSchema'],
        outputSchema: emitToolSchema(episodesOutput) as ToolsListResponse['tools'][number]['outputSchema'],
      },
      // ADR-0031 — BM25 search over the raw message log, separate from recall.
      {
        name: SEARCH_MESSAGES_NAME,
        description: SEARCH_MESSAGES_DESC,
        inputSchema: emitToolSchema(searchMessagesInput) as ToolsListResponse['tools'][number]['inputSchema'],
        outputSchema: emitToolSchema(searchMessagesOutput) as ToolsListResponse['tools'][number]['outputSchema'],
      },
      // skills-write-surface T2.3 (D3) — author + curate skills over MCP.
      {
        name: ADD_SKILL_NAME,
        description: ADD_SKILL_DESC,
        inputSchema: emitToolSchema(addSkillInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      {
        name: FORGET_SKILL_NAME,
        description: FORGET_SKILL_DESC,
        inputSchema: emitToolSchema(forgetSkillInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      // agentic-skill-execution-sandbox T2.4 — opt-in skill execution over MCP.
      {
        name: EXECUTE_SKILL_NAME,
        description: EXECUTE_SKILL_DESC,
        inputSchema: emitToolSchema(executeSkillInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      // recall-trace-retention-and-mcp M4 — explain why a recall dropped candidates.
      {
        name: EXPLAIN_RECALL_NAME,
        description: EXPLAIN_RECALL_DESC,
        inputSchema: emitToolSchema(explainRecallInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      // claude-code-kit-recall-parity M14 — read/update/delete parity for the kit.
      {
        name: GET_MEMORY_NAME,
        description: GET_MEMORY_DESC,
        inputSchema: emitToolSchema(getMemoryInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      {
        name: LIST_ENTITIES_NAME,
        description: LIST_ENTITIES_DESC,
        inputSchema: emitToolSchema(listEntitiesInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      {
        name: UPDATE_MEMORY_NAME,
        description: UPDATE_MEMORY_DESC,
        inputSchema: emitToolSchema(updateMemoryInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
      {
        name: DELETE_ENTITIES_NAME,
        description: DELETE_ENTITIES_DESC,
        inputSchema: emitToolSchema(deleteEntitiesInput) as ToolsListResponse['tools'][number]['inputSchema'],
      },
    ],
  };
}
