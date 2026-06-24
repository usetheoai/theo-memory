# Review: mcp-episodes-tool (G3-MCP)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, wiring, cross-validation
**Findings:** BLOCKER 0, HIGH 0, MEDIUM 0, LOW 2 (1 FIXED, 1 accepted), INFO ~30
**Verdict:** READY_TO_MERGE

## Scope reviewed

theo-memory commit `4f06ca0` (G3-MCP — native `episodes` MCP tool) + the review-fix commit. Adds `episodes-schema.ts` + `episodes-handler.ts` reusing the SHIPPED `ScopedMemory.episodes()` (v0.14.0); registered in `dispatch.ts` + `list-handler.ts`; 10 handler tests + 3 reconciled sentinels. No core/REST/schema/migration change.

## BLOCKER / HIGH / MEDIUM

None.

## LOW

- **G3MCP-DOC-1 (architecture) — FIXED:** `list-handler.ts` JSDoc still said "the 4 locked tools" / "4 static tools" while the function emits 8. Opportunistic cleanup (file already in the diff): header + two inline comments updated to "registered tools in locked-verb-first order (… episodes … skills)". MCP tests re-run 44/44 green.
- **G3MCP-DESIGN-1 (architecture) — ACCEPTED:** the handler branches `Object.keys(options).length>0 ? episodes(options) : episodes()`. Core treats `episodes()` and `episodes({})` identically (`options ?? {}`), so the branch is a distinction without a behavioral difference. Kept as-is: it is correct, tested (`toHaveBeenCalledWith()` no-arg), and expresses the empty-call symmetry with the SDK contract; rewriting it would be churn for zero behavior change.

## Other LOW/INFO (accepted)

- `before`-cursor lacks a dedicated passthrough test (covered structurally — same code path as `after` line 44 + the mutual-exclusion test). Optional symmetry add; current coverage adequate.
- malformed-cursor has no handler-unit test — the error originates inside the real (mocked-here) `episodes()` and is covered by dispatch `classifyError` + recall precedent (plan Drawback #3). A handler-unit suite cannot exercise it without integration-level real `episodes()`.
- e2e round-trip sentinel is PG-gated (the always-on guard is the unit `list-handler.test`); reconciled honestly 4→8 (it was already stale at 7).

## Architecture (agent 1)

DIP clean — confined to the MCP adapter; pure-delegates to the shipped `ScopedMemory.episodes()` (zero core/REST/schema diff). Mirrors `recall` faithfully (zod INPUT+OUTPUT+TOOL_NAME+DESC; shared SCOPE_SCHEMA; ships outputSchema). Anti-spoof scope binding via `getScope()`/`memoryFromCtx` (no scope arg, byte-identical to recall). Options-building covers all 6 keys 1:1; asOf string→Date correct; no key dropped. Registration order (after reflect, before skills) consistent across dispatch + list + e2e. OpenMemory native-only is the right call (no cursor analogue).

## Tests (agent 2)

All 10 cases NON-VACUOUS + deterministic (fixed date, vitest-mock-extended, no I/O). EC-1 (nextCursor emit + omit) both directions; EC-2 omit-absent is an exact `toHaveBeenCalledWith` deep-equal (note: `queryText:''` is structurally unreachable via schema `.min(1)`, so the test validates the conditional-build mechanism — correct); EC-3 uses `OUTPUT_SCHEMA.safeParse` (strongest check, catches a dropped union variant); missing-scope + after+before exercise both ADR D6 error mechanisms (each asserts `episodes` NOT called). 10 plan T1.1 bullets map 1:1 to 10 tests. Sentinels catch a registration regression. No too-weak assertions.

## Wiring (agent 3)

Real end-to-end: handler registered in dispatch HANDLERS Map; discoverable in `buildToolsListResponse` (with input+output schema); `TOOL_NAME='episodes'` is a single source-of-truth constant across schema/handler/dispatch/list (no typo-divergence possible); handler calls the shipped `scoped.episodes(options)` (sig confirmed at memory-store.ts:110, return shape matches). e2e round-trip lists it over real stdio (PG-gated). No half-wiring (both registration points include episodes; 8 dispatch entries == 8 advertised tools).

## Cross-validation (agent 4)

CONSISTENT. All Coverage Matrix rows delivered; ADRs D1-D4 match the code. Every promised-unchanged invariant byte-unchanged (episode.ts, memory-store.ts, pgvector-store.ts, packages/api REST, migrations/schema, OpenMemory compat — NONE in the commit, verified via `git show --name-only`). CHANGELOG Added accurate. The 2 unrelated session config files correctly EXCLUDED (Rule 3). No fabricated symbol (all contract imports resolve). Goal proven.

## Quality gates

- `npm run typecheck` (covers `packages/mcp/src/**`) PASS; `npx vitest run packages/mcp/src/tools/` 44/44; `/code-quality` PASS (zero caps).
- Honest disclosure: the project `lint` script does not glob `packages/mcp` (pre-existing — recall/skills tools unlinted by it too); the new files are typechecked + mirror the lint-clean recall patterns.

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER / 0 HIGH / 0 MEDIUM. The episodic tier is now first-class across all three consumer surfaces (SDK + REST + MCP). One LOW fixed inline (stale JSDoc), one LOW accepted (harmless tested branch). Pure MCP-adapter addition reusing a shipped capability; no core/REST/schema/migration change.
