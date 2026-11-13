/**
 * `tools/list` response emitter tests — T2.2.
 *
 * Asserts spec-compliant `tools/list` shape per MCP 2025-11-25 § Listing Tools
 * (blueprint Q7 verbatim wire shape). Covers:
 * 1. Exactly 4 tools returned
 * 2. Names match locked verbs in declaration order (CLAUDE.md § Locked names)
 * 3. remember.inputSchema.required includes 'content' (F-zod-schema-fixture-test —
 *    proves the discover-blueprint _ToolWithRequired workaround unneeded per ADR D2 + blueprint Q6)
 * 4. recall.outputSchema is present + has type 'object'
 * 5. reflect.inputSchema has additionalProperties: false (F-T2.1-3 absorption — proves
 *    ADR D9 jsonSchema7 target translates `.strict()` correctly per EC-11)
 *
 * @see ADR D2 — Tool schema codegen via zod + zod-to-json-schema
 * @see ADR D9 — JSON Schema dialect lock (target='jsonSchema7')
 * @see EC-11 + F-T2.1-3 — reflect.strict() → additionalProperties:false
 */
import { describe, expect, test } from 'vitest';

import { buildToolsListResponse } from './list-handler.js';

describe('buildToolsListResponse (T2.2 — tools/list emitter)', () => {
  test('returns exactly 14 tools (9 prior + M14 get_memory/list_entities/update_memory/delete_entities + search_messages; no pagination per ADR D2 listChanged:false)', () => {
    const response = buildToolsListResponse();
    // skills-write-surface (D3) grew 4→6; agentic-skill-execution-sandbox T2.4 → 7; mcp-episodes-tool (G3-MCP) → 8;
    // recall-trace explain_recall → 9; M14 kit-recall-parity adds the 4 read/update/delete tools → 13.
    expect(response.tools).toHaveLength(14);
    // No nextCursor for a static list (plan T2.2 Deep Dives; listChanged:false)
    expect(response).not.toHaveProperty('nextCursor');
  });

  test('tool names match locked verbs in declaration order + skills write/execute tools', () => {
    // CLAUDE.md § Locked names: API verbs `remember/recall/forget/reflect`;
    // skills-write-surface adds add_skill/forget_skill (D3); T2.4 adds execute_skill.
    const response = buildToolsListResponse();
    const names = response.tools.map((t) => t.name);
    expect(names).toEqual([
      'remember',
      'recall',
      'forget',
      'reflect',
      'episodes',
      'search_messages',
      'add_skill',
      'forget_skill',
      'execute_skill',
      'explain_recall',
      'get_memory',
      'list_entities',
      'update_memory',
      'delete_entities',
    ]);
  });

  test("remember.inputSchema.required includes 'content' (F-zod-schema-fixture-test absorption)", () => {
    // Per blueprint Q6 + ADR D2: proves zod-to-json-schema emits `required` array
    // correctly with target='jsonSchema7' — the discover-blueprint `_ToolWithRequired` workaround
    // is unneeded for v0.3.
    const response = buildToolsListResponse();
    const remember = response.tools.find((t) => t.name === 'remember');
    expect(remember).toBeDefined();
    const inputSchema = remember?.inputSchema as { required?: string[] };
    expect(inputSchema).toHaveProperty('required');
    expect(inputSchema.required).toContain('content');
  });

  test('recall has non-empty outputSchema with type:object (structuredContent contract)', () => {
    const response = buildToolsListResponse();
    const recall = response.tools.find((t) => t.name === 'recall');
    expect(recall).toBeDefined();
    expect(recall?.outputSchema).toBeDefined();
    const outputSchema = recall?.outputSchema as { type?: string };
    expect(outputSchema.type).toBe('object');
  });

  test("reflect.inputSchema has additionalProperties:false (F-T2.1-3 absorption — ADR D9 + EC-11)", () => {
    // EC-11 contract: `z.object({}).strict()` MUST translate to additionalProperties:false
    // at JSON Schema wire level. ADR D9 pins target='jsonSchema7' to guarantee this.
    // Without the pinned target, some emitter versions silently drop the constraint.
    const response = buildToolsListResponse();
    const reflect = response.tools.find((t) => t.name === 'reflect');
    expect(reflect).toBeDefined();
    expect(reflect?.inputSchema).toHaveProperty('additionalProperties', false);
  });
});
