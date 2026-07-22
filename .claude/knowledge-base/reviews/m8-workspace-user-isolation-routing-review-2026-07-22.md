# Review: m8-workspace-user-isolation-routing

**Date:** 2026-07-22
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-database, domain-testing
**Findings:** 15 total (BLOCKER: 0, HIGH: 4, MEDIUM: 6, LOW/INFO: 5)
**Verdict:** NEEDS_FIXES — 3 of 4 HIGH closed in-cycle; **1 HIGH open (F-xval-1, routing half of the Goal is unmet)** requires an owner decision (see § Handoff).

## Goal under review

M8 has TWO deliverables: **(1) isolation** — harden `(workspace, user)` into a real boundary, prove cross-user isolation; and **(2) routing** — the agent (Claude Code) chooses global `(workspace,user)` vs session `(workspace,user,session)` per write.

## HIGH findings

### F-arch-1 — user-tier cross-user IDOR at the REST boundary — **CLOSED** (`84f71a7`)
- Found by: architecture (+ cross-validation F-xval-6).
- The REST **user tier** resolved `memory.user()` from the client-supplied body/path id (`resolveScope` used `body.userId`; `pathParamsToScoped` used the path id), so a user-Principal could read/write another user's global memory via `{userId:'victim'}` / `.../user/victim`.
- Fix: bind the user tier to the auth-trusted `Principal.userId` on BOTH paths; a workspace-admin (`Principal.userId` null) keeps the id. `applyHeaderUserScope` overrides a body userId with the edge-injected `X-Theo-User-Id` (defense in depth). Proven at the HTTP boundary by `cross-user-rest-isolation.test.ts` (4 cases, two Principals). RED→GREEN evidenced.

### F-tests-1 — the isolation filter had only env-gated integration coverage — **CLOSED** (`974c00b`)
- Found by: tests (+ domain-testing confirmed the fix at HEAD).
- Fix: `scope-filters.test.ts` — 7 fast contract-suite cases for `filtersFromScope` (the pure function that decides whether `user_id` enters the WHERE clause). 7/7 pass, 170ms, no pgvector.

### F-tests-2 / F-xval-3 — cross-user isolation untested at the REST boundary — **CLOSED** (`84f71a7`)
- Found by: tests, cross-validation.
- Fix: `cross-user-rest-isolation.test.ts` proves the `(workspace,user)` boundary at the HTTP surface (two Principals; a body/path `userId` IDOR is ignored; the admin path keeps the id). Complements the SDK-level `cross-user-isolation.test.ts` (3/3 real pgvector).

### F-xval-1 — the agent-chosen ROUTING half of the Goal is **NOT delivered** — **OPEN**
- Found by: cross-validation.
- Evidence: the MCP `remember` handler binds scope via `memoryFromCtx(getScope(), …)`, which resolves **only the user tier** (theokit binding EC-8 ignores sessionId/agentId). The MCP agent therefore writes **always to global (user)** — it has no way to choose session `(workspace,user,session)`. The plan's T2.1 (`MemoryRoutingPolicy` DIP) + T4.2 (routing event) were dropped as YAGNI during implementation, but the milestone **Goal + Coverage Matrix** still list the routing deliverable, and the project owner stated it explicitly (*"o agente escolhe salvar com memória da sessão ou memória global"*).
- Honest status: claiming "M8 substantive DoD MET" **overstates** it. Isolation is delivered+proven; routing is unmet.
- Resolution: OWNER DECISION (see § Handoff) — this is a design fork (what identifies a "session" at the agent surface; it overrides ADR D3 "agents MUST NOT pass scope"), not a mechanical fix.

## MEDIUM findings

| ID | Finding | Status |
|---|---|---|
| F-dom-db-1 | Missing `0024_snapshot.json` breaks the future `drizzle-kit generate` chain (runtime unaffected — the migrator reads the `.sql`, not the snapshot) | **CLOSED** (`d28d266`) — snapshot chained from 0023 (schema model unchanged; the index is a DB-only object) |
| F-dom-db-2 | The composite index is not mirrored as a `schema.ts` object (`drizzle-kit push` dev-parity) | **DEFERRED w/ rationale** — `schema.ts` (738 LoC) exceeds the 300-LoC quality budget; adding it is blocked until a schema-split refactor (out of M8 scope). Runtime + `runMigrations` unaffected. Documented in CHANGELOG. |
| F-arch-2 / F-xval-2 | Migration creates the index WITHOUT `CONCURRENTLY` | **ACCEPTED w/ rationale** — `runMigrations` wraps each migration in a txn where `CONCURRENTLY` is forbidden; brief first-deploy write-lock accepted; zero-downtime rebuild is an ops runbook step. Documented in CHANGELOG. |
| F-wire-1 | Isolation is caller-discipline-enforced (optional `userId`), not type-enforced | **MITIGATED** — the REST boundary now binds the Principal on every tier (resolveScope + pathParamsToScoped), asserted by the new REST test; a static ast-grep guard is a nice-to-have follow-up |
| F-tests-3 | Agent-tier isolation is unit-covered but not integration-tested at the DB level | Follow-up (LOW-value; the SDK filter test covers the shape) |
| domain-testing F-tests-1 | RED-before-GREEN not evidenced in commit order for the optional-userId change | Process note; the guard test is genuine (removing `user_id` from the branch fails it) |

## LOW / INFO
- Benchmark latency delta (0.582±0.078 vs 0.685±0.097 ms) is within ~1σ; the trustworthy evidence is the plan-node (Index Scan vs Bitmap Heap Scan), which the benchmark reports.
- Extracted helpers (`applySkillFilters`/`rowsToMemoryItems`) lack direct fast unit tests (byte-identical moved code; indirect via the db/ suite) — YAGNI-acceptable.

## Quality gates
- `npm run typecheck`: PASS (0 errors)
- `npm run lint`: PASS (0 warnings)
- Full suite: 28 fail / 1223 pass — the 28 are the pre-existing dogfood/examples baseline (identical on clean HEAD); +7 vs baseline = the new `scope-filters.test.ts`. Zero new failures.
- Isolation hard-gate: 3/3 real `ankane/pgvector:v0.5.1` (SDK) + 4/4 REST boundary (two Principals).
- Composite index: EXPLAIN Index Scan on the composite key.

## Handoff decision — NEEDS_FIXES

The **isolation** deliverable (the security-critical core) is **DELIVERED + PROVEN** and all its review findings are closed. The **routing** deliverable (F-xval-1) is **NOT delivered** and its resolution is an owner-level design fork. M8 cannot honestly be declared complete until routing is either (b) implemented or (a) formally split into a follow-up milestone with an amended Goal/Coverage Matrix. Surfaced to the owner.
