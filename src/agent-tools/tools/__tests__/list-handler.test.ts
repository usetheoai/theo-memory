/**
 * `tools/list` response emitter tests — T2.2.
 *
 * Asserts spec-compliant `tools/list` shape per MCP 2025-11-25 § Listing Tools
 * (blueprint Q7 verbatim wire shape). Covers:
 * 1. Exactly 4 tools returned
 * 2. Names match locked verbs in declaration order (CLAUDE.md § Locked names)
 * 3. remember.inputSchema.required includes 'content' (F-zod-schema-fixture-test —
 *    proves LangMem _ToolWithRequired workaround unneeded per ADR D2 + blueprint Q6)
 * 4. recall.outputSchema is present + has type 'object'
 * 5. reflect.inputSchema has additionalProperties: false (F-T2.1-3 absorption — proves
 *    ADR D9 jsonSchema7 target translates `.strict()` correctly per EC-11)
 *
 * @see ADR D2 — Tool schema codegen via zod + zod-to-json-schema
 * @see ADR D9 — JSON Schema dialect lock (target='jsonSchema7')
 * @see EC-11 + F-T2.1-3 — reflect.strict() → additionalProperties:false
 */
import { describe, expect, test } from 'vitest';

import { buildToolsListResponse } from '../list-handler.js';

describe('buildToolsListResponse (T2.2 — tools/list emitter)', () => {
  test('returns exactly 4 tools (no pagination at v0.3 per ADR D2 listChanged:false)', () => {
    const response = buildToolsListResponse();
    expect(response.tools).toHaveLength(4);
    // No nextCursor for 4 static tools (plan T2.2 Deep Dives)
    expect(response).not.toHaveProperty('nextCursor');
  });

  test('tool names match locked verbs in declaration order', () => {
    // CLAUDE.md § Locked names: API verbs `remember/recall/forget/reflect`.
    // Order matters per declaration (plan T2.2 § Deep Dives).
    const response = buildToolsListResponse();
    const names = response.tools.map((t) => t.name);
    expect(names).toEqual(['remember', 'recall', 'forget', 'reflect']);
  });

  test("remember.inputSchema.required includes 'content' (F-zod-schema-fixture-test absorption)", () => {
    // Per blueprint Q6 + ADR D2: proves zod-to-json-schema emits `required` array
    // correctly with target='jsonSchema7' — LangMem's `_ToolWithRequired` workaround
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
