# T2.1 BLOCKED — MCP stdio transport lacks scope binding

**Date:** 2026-06-04
**Plan:** `dogfood-anchor-scenario-launch` v1.1
**Task:** T2.1 (round-trip integration test against real `themory mcp`)
**Status:** **BLOCKED** — discovered architectural gap that ADR D1 v1.1 did NOT anticipate. Requires plan amendment to v1.2 OR upstream `themory mcp` enhancement before T2.1 can complete.

## What dogfood already surfaced (the cycle working as intended)

Per `dogfood-golden-rule.md` § What counts as sufficient evidence, soft gate 7 requires evidence files to log "DX pains encountered" + "API gaps surfaced". T2.1 attempt surfaced a CONCRETE API gap **before** the dogfood gate even opened. This IS the cycle proving its value — DX pain caught at week 1 of Phase A is 30+× cheaper than caught post-merge.

## The gap

`src/agent-tools/run-mcp-server.ts` (the CLI entrypoint behind `themory mcp`) constructs `McpServer` and connects it via `connectStdio` (T6.1) — BUT does NOT wrap dispatch in `withScope(...)`. Result:

- `tools/call remember` reaches the validation layer (zod parse on `content` field) — VALIDATES OK when bridge sends correct args
- The validated handler then calls `memoryFromCtx(getScope(), ...)` from `src/agent-tools/tools/remember-handler.ts`
- `getScope()` throws `MissingScopeError` because NO enclosing `withScope` was set
- bridge receives McpError → typed as Tool Execution Error per dispatch.ts; consumer sees a SQL-shape error message rather than a clean scope-resolution

Verified via T2.1 integration test attempt: first failure was `path: ['content']` validation (bridge initially sent `text` instead of `content`); fixing the field name would expose the NEXT failure as MissingScopeError.

## Root cause analysis

ADR D1 v1.1 hybrid strategy assumes the MCP stdio path is FULLY consumer-usable. The plan inherited this assumption from `theo-memory-standalone-p0` cycle which shipped Items 16/17/18 (REST server + Docker + CLI) but the stdio scope binding was NOT explicitly tested in that surface.

Looking at the existing handler tests (`src/agent-tools/tools/__tests__/handlers.test.ts`), tests wrap calls in `withScope(ctx, ...)` blocks manually. The MCP server itself never wraps — meaning stdio invocation by a real MCP client (Claude Code, our bridge, anyone) hits MissingScopeError on every `tools/call`.

This is an **inherited gap**, NOT a regression introduced by this cycle. It was previously masked because (a) the standalone-p0 cycle focused on REST + Docker + CLI subcommands and did not exhaustively test `themory mcp` E2E with a real MCP client, and (b) the dogfood cycle is the FIRST consumer that actually attempts to exercise the MCP stdio surface from outside the test suite.

## Options to unblock T2.1

### Option A — add default-scope env var to run-mcp-server.ts (RECOMMENDED)

Add `THEOMEM_MCP_DEFAULT_USER_ID` env var support. When set, `run-mcp-server.ts` wraps the dispatch handler registration in `withScope({ kind: 'user', userId: envValue }, () => ...)` so every `tools/call` runs inside an active scope. When unset, behavior is preserved (MissingScopeError surfaced as before — explicit signal that scope wiring is required).

Cost: ~10 LoC change in `run-mcp-server.ts`. Honors Inquebrável Rule 11 (YAGNI) — minimum viable scope binding for the dogfood use case + future MCP clients. Documented as `0.3.x` (patch) bump because it ADDS configuration; does NOT change existing default behavior.

This change is OUT OF SCOPE for `dogfood-anchor-scenario-launch` cycle per its YAGNI ceiling (ADR D4: cycle is HARDENING of existing surface), but IS in scope for a sibling micro-cycle `mcp-stdio-default-scope-cycle` that ships alongside or BEFORE this one.

### Option B — bridge bypasses MCP; uses in-process `@usetheo/memory` API

Modify the bridge to import `createLocalMemory` directly and call `memory.user(slug).remember(...)` in-process. Loses the "exercise the public MCP API" dogfood signal — but the consumer-visible surface is still the bridge's 4 verbs.

Cost: ~30-50 LoC bridge change + revisit T1.1's tests (they currently mock subprocess; would need to mock the in-process API instead). Loses the per-invocation subprocess overhead measurement (EC-2 budget) — instead the bridge is in-process.

### Option C — change Claude Code's MCP client config to pass scope via metadata

Some MCP clients can pass per-tool-call metadata. The bridge could include `meta: { user_id: slug }` in `tools/call` requests. Requires MCP server to read meta + wrap dispatch in withScope based on it. Same upstream change as Option A but driven from client metadata rather than env var.

Cost: similar to Option A + requires MCP client to honor the metadata convention. Less portable across MCP clients.

## Recommended action

Per Inquebrável Rule 1 (95% confidence): pause T2.1 + escalate to user for direction. Three concrete options below; each ships honestly with different trade-offs.

## Cycle gate decision

T2.1 PARTIAL — bridge implementation + 21 unit tests + hook integration (T1.1, T1.2 complete) but END-TO-END round-trip against real `themory mcp` BLOCKED by stdio scope-binding gap. Cycle remains in develop branch awaiting user direction on remediation.

## What this commit ships

- This audit file documenting the gap + remediation options.
- The bridge code (T1.1) + hook/skill/template (T1.2) remain functional ON THEIR OWN — they will start working once the MCP server gains stdio scope binding.
- The T2.1 integration test (`tests/integration/dogfood/claude-code-bridge-roundtrip.test.ts`) committed in this session is technically a RED test that asserts the future success path; it will turn GREEN automatically when the scope-binding gap is closed.

## Related

- Plan: `.claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md` § T2.1 + ADR D1
- T0.0 verification: `.claude/knowledge-base/audits/dogfood-anchor-precycle-write-tool-verification-2026-06-04.md` (CASE A — Write tool IS canonical; ADR D1 hybrid structurally valid)
- Affected file: `src/agent-tools/run-mcp-server.ts` (needs withScope wrapping per Option A)
- Affected file: `src/agent-tools/tools/remember-handler.ts` (calls `getScope()` which throws when no scope active)
- Affected file: `src/agent-tools/scope.ts` (`withScope` helper exists; just needs to wrap dispatch)
