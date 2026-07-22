# Review: m8-workspace-user-isolation-routing

**Date:** 2026-07-22
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-database, domain-testing
**Findings:** 15 total (BLOCKER: 0, HIGH: 4, MEDIUM: 6, LOW/INFO: 5)
**Verdict:** READY_TO_MERGE — all 4 HIGH closed (F-arch-1, F-tests-1, F-tests-2/F-xval-3, F-xval-1); MEDIUM findings fixed or deferred-with-rationale. Re-verified: typecheck 0, lint 0, full suite 1227 pass (28 pre-existing dogfood/examples baseline, zero new), isolation + routing proven on real pgvector.

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

### F-xval-1 — the agent-chosen ROUTING half of the Goal — **RESOLVED** (`156755f` + `8777188`)
- Found by: cross-validation.
- Original evidence: the MCP `remember` handler bound scope via `memoryFromCtx(getScope(), …)`, resolving **only the user tier** (theokit binding EC-8 ignores sessionId), so the agent wrote **always to global** — no way to choose session.
- Resolution (owner-directed, 2 commits):
  1. **Routing dispatch** (`156755f`) — `routeScopedMemory` + a `sessionId` argument on the MCP `remember`/`recall` tools: omit → global `(workspace,user)`; pass → session `(workspace,user,session)`. The user id is ALWAYS the auth-trusted `ScopedContext` user (never a tool arg), so the agent can only pick a session sub-partition of its OWN space. Narrows ADR D3.
  2. **Hierarchical recall** (`8777188`, owner decision on the semantics fork) — `Filters.scopeHierarchy` makes the tiers a hierarchy: global recall = global-only (`session_id IS NULL AND agent_id IS NULL`); session recall = session ∪ global (`agent_id IS NULL AND (session_id = :s OR session_id IS NULL)`). System-wide (one contract for REST/hooks/SDK/MCP), per the owner's explicit model.
- Proof: `tests/integration/mcp/routing.test.ts` (real pgvector — global recall excludes the session fact; session recall includes both) + `route-scoped-memory.test.ts` (3) + `scope-filters.test.ts` (7). Full suite 1227 pass, zero regressions.

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

## Handoff decision — READY_TO_MERGE

Both M8 deliverables are DELIVERED + PROVEN: **(1) cross-user isolation** (SDK 3/3 + REST 4/4 on real pgvector; composite index Index Scan; benchmark) and **(2) agent-chosen routing** with the owner-decided **hierarchical recall** semantics (global-only / session ∪ global, system-wide; proven on real pgvector). All 4 HIGH findings closed; MEDIUM findings fixed or deferred-with-rationale (F-dom-db-2 schema.ts push-parity + F-arch-2 CONCURRENTLY, both documented). Ready for `/release` (develop → main PR, human-approved merge per Unbreakable Rule 4).
