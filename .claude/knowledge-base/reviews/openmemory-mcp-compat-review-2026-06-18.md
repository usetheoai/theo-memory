# Review: openmemory-mcp-compat

**Date:** 2026-06-18
**Diff base:** `db077aa` (plan commit) → HEAD — implementation commits `895cd9b` (Phase 0), `0d5a80f` (Phase 1 + GOAL TEST), `5c533e3` (Phase 2 CLI).
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-cli-tooling, domain-database.
**Findings:** 1 BLOCKER, 5 HIGH, 7 MEDIUM, several LOW/INFO (deduped across agents).
**Verdict:** **READY_TO_MERGE** — BLOCKER + all HIGH closed in-cycle; MEDIUMs resolved or documented. Re-validated green.

---

## Scope

11 files, 824 insertions (feature-only diff): `packages/mcp/src/openmemory/tools.ts` (+test), `packages/mcp/src/transports/sse.ts` (+test), `packages/mcp/src/server.ts`, `packages/mcp/src/run-mcp-server.ts`, `packages/mcp/src/openmemory/compat-resolution.test.ts`, `packages/mcp/src/index.ts`, `packages/agent-core/src/types.ts`, `packages/cli/src/cli.ts`, `tests/integration/openmemory/mcp-compat.test.ts`. `src/core` untouched (adapter-only).

## BLOCKER (fixed)

### F-db-1 / F-arch-1 / F-wiring-1 / F-db-2 — Cross-user delete IDOR
Found by **4 agents independently** (domain-database BLOCKER, architecture HIGH, wiring MEDIUM, tests HIGH).
- **Problem:** `deleteMemoriesHandler` resolved the **unscoped** `Memory.forget(id)` while `add`/`search`/`list` went through `memoryFromCtx(getScope(), ...)`. On the multi-user SSE path (`/{client}/sse/{user}`), user B could soft-delete user A's memory by id. The goal test proved read-isolation only, never delete-isolation — which is why the suite was green over a real vulnerability.
- **Fix** (`tools.ts`): `deleteMemoriesHandler` now re-derives the path user id (scope gate, parity with the other handlers) and confirms ownership via `memory.get(id).scope` (`kind==='user' && userId===request`) **before** forgetting. Non-owned/unknown ids are skipped, never deleted.
- **Regression (TDD RED→GREEN):** unit guard "REFUSES to forget another user's memory" + end-to-end "user B cannot DELETE user A memory by id" against real `ankane/pgvector`. Commit (BLOCKER fix).

## HIGH (fixed)

| ID | Agent | Finding | Resolution |
|---|---|---|---|
| F-cli-1 | cli-tooling | Compat SIGTERM/SIGINT lacked the `SHUTDOWN_TIMEOUT_MS` race-guard the native path has → a wedged SSE session could block process exit (k8s SIGKILL). | `compatShutdown` now `Promise.race([handle.close(), timeout])`, mirroring native. |
| F-test-1 | tests | `sse.test.ts` did not assert scope-binding or POST routing (load-bearing D3 wiring exercised only indirectly). | Added an SSE component test: real MCP client over a **mock** Memory (no pg) — proves `tools/list` + a `tools/call` round-trips the SSE POST route AND the path user id reaches `memory.user(<user>)` via `withScope`. |
| F-test-2 | tests | T2.1 compat resolution (→ sse / port 8765) untested; `resolveCompatPort` unexported. | Exported `resolveCompatPort`; added 8765-default / env / flag / out-of-range + flag-over-env precedence tests. |

(F-arch-1 / F-db-2 are the architecture/test facets of the BLOCKER above — closed by the same fix.)

## MEDIUM (resolved or documented)

| ID | Agent(s) | Finding | Resolution |
|---|---|---|---|
| F-arch-2 / F-db-3 / F-xval-2 | arch, db, xval | `client_name` parsed + stored but never surfaced as `mcp_client` metadata (silent divergence from blueprint D3/Q2). | Removed the dead `Session.clientName` field; fixed the JSDoc overclaim; documented the metadata enrichment as an explicit deferral (threading it would widen the core `ScopedContext` contract — out of scope for this cycle). No silent divergence (Rule 3). |
| F-wiring-2 / F-xval-3 | wiring, xval | `/{client}/http/{user}` hand-rolls `StreamableHTTPServerTransport` instead of delegating to `connectStreamableHttp`. | Documented the deliberate choice: `connectStreamableHttp` owns its own server + binds scope from the Authorization header; the compat surface needs URL-path scoping on the shared server. Behavior correct + reachable. |
| F-arch-3 | arch | `openMemoryDispatch` flattens all errors to `"Error: …"`, diverging from native `throw McpError` (ADR D6) without a note. | Added JSDoc documenting the deliberate OpenMemory wire-parity override (blueprint D5), isolated to the compat adapter. |
| F-test-3 | tests | Transport-level concurrency / mid-stream disconnect not unit-tested. | Accepted as caveat — end-to-end per-user isolation (parallel clients) covers the cross-bind invariant; pure-unit transport concurrency deferred. |

## LOW / INFO (accepted)

- F-db-4 (LOW): `list_memories → getAll()` uncapped — bounded to one user; mirrors REST EC-14, deferred.
- F-arch-7 (INFO): `TransportKind` JSDoc said "SSE explicitly skipped" while the type now includes `'sse'` → doc-rot fixed.
- F-db-5 / F-arch-4..6 / F-cli-4/5 (INFO, positive): no SQL injection (params not concatenated), byte caps enforced via zod, DIP boundary clean, `src/core` untouched, no paper names, CLI validation + native passthrough preserved, honest stderr disclosure.

## Cross-validation summary

- Plan tasks: 4 (T0.1, T1.1, T2.1, T3.1). Fully implemented: 4. Missing: 0. Diverged: 1 (T2.1 `delete_memories` vs the announcement's `delete_all_memories` — deliberate per ADR D4, "match the code not the marketing"; documented INFO).
- GOAL verified: `tools/list` = exactly the 4 names, add→search→delete round-trip, per-user isolation (read **and** delete) — all green against real `ankane/pgvector:v0.5.1`.

## Quality gates

- `npm run typecheck` (contract): PASS.
- `npm run lint`: PASS (0 warnings).
- `/code-quality` openmemory-mcp-compat: **PASS (cap 100)** — no dead code, no fabricated symbols.
- mcp package: 90/90. cli: 57/57. core contract: 958 passed / 2 skipped.
- Integration (full suite): 540 passed / 0 failed. GOAL TEST: 4/4 (incl. the new IDOR regression).

## Spawned agents (audit trail)

- `.claude/agents/review-openmemory-mcp-compat-2026-06-18/{architecture,tests,wiring,cross-validation,domain-cli-tooling,domain-database}.md`
- Findings: `…/findings/*.yaml`

## Handoff decision

**READY_TO_MERGE.** The single BLOCKER (cross-user delete IDOR) is closed with TDD regression coverage at both unit and real-pgvector levels; all HIGH findings fixed; MEDIUMs resolved or documented with explicit rationale. The OpenMemory MCP-compat surface is functionally complete and per-user-isolated end-to-end.
