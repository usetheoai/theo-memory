# SEPA — Iteration 5 / Task T2.2 / Phase 2 (tools/list response emitter)

## Plan recap
- T2.2 delivers `buildToolsListResponse()` + SDK `ListToolsRequestSchema` handler registration; emits the spec-compliant `{tools: [4 entries]}` payload via the new `emitToolSchema()` helper in `schema-emit.ts` (ADR D9 dialect-lock single point of control). Wires `server.setRequestHandler` in `McpServer` constructor without breaking T1.1's 3 existing unit tests.

## Findings

### Plan / TDD shape verification
- INFO — TDD shape: plan declares 4 RED tests (lines 539-542). Your proposed list matches verbatim. Recommend adding a **5th explicit RED test** for `test_reflect_schema_emits_additionalProperties_false` (F-T2.1-3 absorption); folding into an existing test risks the assertion getting lost on REFACTOR. The blueprint's F-zod-schema-fixture-test pattern justifies the standalone test.
- INFO — Test names match plan verbatim. RED phase MUST confirm failure BEFORE GREEN (Inquebrável Rule 5).

### ADR D9 absorption (EC-3)
- MAJOR — `schema-emit.ts` is a NEW file per plan line 502 + Deep Dive line 513. The constant MUST be `export const ZOD_TO_JSON_SCHEMA_TARGET = 'jsonSchema7' as const` — literal-typed (`as const`) so TypeScript narrows it to the `Targets` union member, NOT the broader `string` type. If you write `: string` annotation, you lose the lock.
- INFO — Verified upstream: `node_modules/zod-to-json-schema/dist/types/Options.d.ts:4` exports `Targets = "jsonSchema7" | "jsonSchema2019-09" | "openApi3" | "openAi"` — `'jsonSchema7'` literal is valid. The generic `Options<Target>` defaults to `"jsonSchema7"` so omitting `target` would also work, but plan ADR D9 mandates EXPLICIT pin for audit clarity. Do not rely on default.
- MAJOR — Return type of `emitToolSchema()` per plan: signature `emitToolSchema(zodSchema): JSONSchema7`. Verify the import path — `JSONSchema7` comes from the `@types/json-schema` package or from `zod-to-json-schema`'s own type re-export (`import type { JsonSchema7Type } from 'zod-to-json-schema'`). Inspect at GREEN; if neither is available cleanly, fall back to a project-local type alias rather than `any` (architecture.md § no-any rule).

### F-T2.1-3 forward followup (critical absorption)
- [CRITICAL] — F-T2.1-3 from T2.1 SEPA: **reflect's `.strict()`** in `reflect-schema.ts` only translates to `additionalProperties: false` in emitted JSON Schema when `zodToJsonSchema` runs with `target: 'jsonSchema7'`. The 5th test MUST assert `emittedReflectSchema.additionalProperties === false`. Without this, T2.1's strict() is structurally dead — a follow-up gap that survives into Phase 4 dispatch.
- INFO — Cross-check: zod-to-json-schema's `removeAdditionalStrategy` option (Options.d.ts:18) defaults to `'passthrough'`; combined with `.strict()` on the zod side it should emit `additionalProperties: false`. The test is the proof. If the assertion fails at RED→GREEN boundary, the bug is in zod-to-json-schema's interaction with reflect's empty-object schema — surface to halt-loop immediately, do NOT silently relax the assertion.

### SDK wiring (T1.1 backward compat)
- MAJOR — T1.1 shipped 3 unit tests on `McpServer` constructor. The new `server.setRequestHandler(ListToolsRequestSchema, buildToolsListResponse)` call MUST go in the constructor (or a `registerHandlers()` private method invoked from constructor) so existing tests continue to pass without re-instantiation pattern change. If you find yourself changing T1.1's test API to accommodate the new handler, [CRITICAL] — flag scope creep / contract drift; consult main session before editing T1.1 tests.
- INFO — Verified SDK shape: `ListToolsRequestSchema` (types.d.ts:2423) accepts no params required; `ListToolsResultSchema` (types.d.ts:2444) expects `tools[]` array with `{description?, inputSchema: {type:'object', properties?, required?}, outputSchema?, annotations?, execution?, _meta?, icons?}`. Per-tool entry shape per plan Deep Dive (line 514-522) maps directly — your handler returns plain object; SDK validates against `ListToolsResultSchema` on response. Do not add `nextCursor` (plan line 524: no pagination at v0.3).

### Per-tool entry construction
- MINOR — Plan line 514-522 shows the per-tool entry literal. The 4 tools are imported from T2.1's schema files (`remember-schema.ts` etc.) which export `TOOL_NAME`, `DESCRIPTION`, `INPUT_SCHEMA`, optional `OUTPUT_SCHEMA` constants. Verify those exact export names at GREEN — if T2.1 used different names, either align them or document the mapping at the import site. Do NOT silently rename T2.1's exports.
- INFO — `outputSchema: OUTPUT_SCHEMA ? emitToolSchema(OUTPUT_SCHEMA) : undefined` — the ternary correctly omits the field when absent (only `recall` has output schema per blueprint). Verify: emitted JSON-RPC response MUST NOT include `outputSchema: undefined` literally (some serializers do, JSON.stringify drops it; safe via standard SDK pathway).

### Test depth (testing.md § Pyramid)
- INFO — These are PURE UNIT tests (no SDK transport, no spawn) — runs in ms. Correct tier per plan line 1107 (`testing.md § Pyramid` table). Use Arrange-Act-Assert; one assertion per test where practical; name shape: `test_tools_list_<behavior>` matches plan verbatim.
- MAJOR — Declaration-order assertion (`names === ['remember', 'recall', 'forget', 'reflect']`) is **order-dependent**. The implementation MUST construct the tools array in that exact order — alphabetical sort would break the test. Embed a comment at the array literal: `// Order matches locked API verbs per CLAUDE.md § Locked names`.

### DIP boundary
- INFO — Per plan: `src/agent-tools/tools/list-handler.ts` imports from sibling `src/agent-tools/tools/*-schema.ts` + `schema-emit.ts` (allowed) + `zod-to-json-schema` (external) + `@modelcontextprotocol/sdk` (external). NO import from `src/local/`, `src/cloud/`, `src/core/`. boundary-check.sh will enforce; verify nothing creeps in during REFACTOR.

### Cross-references for JSDoc / commit
- INFO — `buildToolsListResponse()` JSDoc MUST reference: `@see ADR D2` (schema dialect) + `@see ADR D9` (dialect lock) + `@see EC-3` (absorbed via D9) + `@see blueprint Q7` (response shape spec).
- INFO — `emitToolSchema()` JSDoc MUST reference: `@see ADR D9` + the F-T2.1-3 followup rationale (one-line "Pins target so reflect's .strict() emits additionalProperties:false").

## Recommended action
1. Start RED phase with all 5 tests (4 from plan + 1 explicit F-T2.1-3 assertion). Confirm ALL 5 fail before GREEN (Inquebrável Rule 5).
2. Author `schema-emit.ts` FIRST (1 constant + 1 helper, ~15 LoC) — small, easy to lint-clean. Then `list-handler.ts`.
3. At GREEN, verify import names from T2.1 schemas match your imports verbatim. If mismatch, [HALT] and consult main session — do not silently rename T2.1 exports.
4. Before COMMIT: confirm `npm test -- src/agent-tools/__tests__/server.test.ts` (T1.1's 3 tests) still pass. If broken, the handler-registration shape needs adjustment, not the T1.1 tests.
5. CHANGELOG: add entry to `[Unreleased] → Added` clustering with T2.1: "MCP `tools/list` handler emits 4-tool catalog with locked JSON Schema dialect (D9)".
6. Commit message shape: `feat(agent-tools): add tools/list handler with D9 dialect lock` + body references T2.2, EC-3, D9, F-T2.1-3 absorption. NO `Co-Authored-By` trailer (project policy per session memory).
