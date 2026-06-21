/**
 * `tools/list` JSON-RPC response emitter for v0.3 MCP server.
 *
 * Returns the 4 locked tools (remember/recall/forget/reflect) in declaration order
 * with their JSON Schema 7 inputSchemas + recall's outputSchema. Wired into the
 * `McpServer` constructor at T1.1 via `setRequestHandler(ListToolsRequestSchema, ...)`.
 *
 * @see ADR D2 — Tool schema codegen (zod-authored, 4 separate tools, listChanged:false)
 * @see ADR D9 — JSON Schema dialect lock (target='jsonSchema7' via emitToolSchema)
 * @see MCP spec 2025-11-25 § Listing Tools (blueprint Q7 wire shape)
 */
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

import {
  TOOL_NAME as FORGET_NAME,
  DESCRIPTION as FORGET_DESC,
  INPUT_SCHEMA as forgetInput,
} from './forget-schema.js';
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
import {
  TOOL_NAME as ADD_SKILL_NAME,
  DESCRIPTION as ADD_SKILL_DESC,
  INPUT_SCHEMA as addSkillInput,
} from './add-skill-schema.js';
import {
  TOOL_NAME as FORGET_SKILL_NAME,
  DESCRIPTION as FORGET_SKILL_DESC,
  INPUT_SCHEMA as forgetSkillInput,
} from './forget-skill-schema.js';
import {
  TOOL_NAME as EXECUTE_SKILL_NAME,
  DESCRIPTION as EXECUTE_SKILL_DESC,
  INPUT_SCHEMA as executeSkillInput,
} from './execute-skill-schema.js';
import { emitToolSchema } from './schema-emit.js';

/** Spec-compliant `tools/list` response shape (no pagination for 4 static tools). */
export type ToolsListResponse = ListToolsResult;

/**
 * Builds the spec-compliant `tools/list` result payload.
 *
 * Order honors CLAUDE.md § Locked names verb order: `remember/recall/forget/reflect`.
 * No `nextCursor` (4 static tools per ADR D2's `listChanged:false` declaration).
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
    ],
  };
}
