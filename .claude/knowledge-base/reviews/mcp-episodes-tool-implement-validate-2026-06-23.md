# Implement-Validate — mcp-episodes-tool (G3-MCP)

**Date:** 2026-06-23
**Branch:** develop
**Commit:** 4f06ca0
**Verdict:** PASS

## Cycle-implement discipline (executed directly — MCP adapter + tests)

| Phase | Result |
|---|---|
| RED | sentinels (list-handler 7→8 + names; schemas name-regex) + 10-case `episodes.test.ts` written against unregistered tool |
| GREEN | `episodes-schema.ts` + `episodes-handler.ts` (reuse shipped `episodes()`); registered in `dispatch.ts` + `list-handler.ts` |
| WIRING | caller = the registered MCP tool (dispatch Map + tools/list) over the live server; integration = the 10 handler dispatch tests via `withScope`; the e2e round-trip sentinel lists it over real stdio; runtime metric = the MCP server's existing per-call tracing (handler rides it, like recall) |
| COMMIT | `4f06ca0` (MCP-only + docs; the 2 unrelated session config files EXCLUDED) |

## Validation gates

| Gate | Result |
|---|---|
| `npm run typecheck` (tsconfig.contract.json — covers `packages/mcp/src/**`) | PASS (0 errors) |
| `npx vitest run packages/mcp/src/tools/` | 44/44 PASS (incl. 10 new episodes + updated sentinels) |
| `npm run lint` (core/api/cli/agent-core) | PASS |
| `/code-quality` | PASS (zero caps) |
| Diff scope (MCP adapter + docs only) | confirmed — NO `packages/core/src/domain`, NO REST, NO schema/migration |

## Honest disclosures (Rule 3)

- **Lint of `packages/mcp`:** the project `lint` script globs core/api/cli/agent-core but NOT `packages/mcp` (pre-existing gap — recall/skills tools live there unlinted by the script too). The new files ARE typechecked (`tsconfig.contract.json` includes `packages/mcp/src/**`, clean) and mirror the lint-clean `recall-handler`/`recall-schema` patterns verbatim. Not introduced by this change.
- **round-trip e2e sentinel was already stale:** `round-trip.test.ts:132` asserted 4 names while the real list was already 7 (skills tools). It is `THEOMEM_PG_URI`-gated (skipped without it). Reconciled to the true 8-name list (incl. episodes) — a false sentinel was fixed, not left.

## Coverage Matrix — 10/10 delivered

| Goal claim | Task | Verified by |
|---|---|---|
| episodes-schema.ts + episodes-handler.ts (reuse episodes()) | T2.1 | files exist; handler calls `scoped.episodes` |
| Registered in dispatch + tools/list (outputSchema) | T2.2 | dispatch Map + list-handler entry; tools/list test |
| Scope via getScope+memoryFromCtx (no scope arg; missing-scope guard) | T2.1 | test: outside-withScope → isError |
| Options passthrough + asOf ISO→Date | T1.1 | passthrough + asOf-Date tests |
| after+before → -32602 | T1.1/D4 | mutual-exclusion test (McpError) |
| Wire items + nextCursor (EC-1) | T2.1 | nextCursor emit + omit tests |
| Absent options omitted (EC-2) | T1.1 | omit-absent test |
| Session-scope union (EC-3) | T1.1 | OUTPUT_SCHEMA.safeParse test |
| tools/list 7→8 + name spec | T1.2 | list-handler + schemas sentinels |
| round-trip e2e reconciled | T3.1 | 4→8 names |
| CHANGELOG Added | T3.1 | `[Unreleased] § Added` |
