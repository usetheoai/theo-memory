# Implementation Contract: M8 — (workspace, user) isolation + agent-chosen routing

Plan: `.claude/knowledge-base/plans/m8-workspace-user-isolation-routing-plan.md` (SHIPPABLE 98.4)
Driver: `halt-loop-prompts/implement-m8-workspace-user-isolation-routing.md`

## Ordered tasks (TDD halt-loop — RED→GREEN→REFACTOR→WIRING→COMMIT per task)

| # | Task | Status |
|---|---|---|
| T1.1 | SessionScope/AgentScope userId required + filtersFromScope always includes user_id | pending |
| T1.2 | Public Memory.session/agent API migration + 6 reconstruction sites | pending |
| T2.1 | MemoryRoutingPolicy DIP + DefaultRoutingPolicy + agent-choice wiring | pending |
| T2.2 | attributed_to = user\|agent wired for Claude Code write paths | pending |
| T3.1 | Migration 0024 composite (workspace_id,user_id,session_id) index | pending |
| T4.1 | Cross-user isolation integration test (hard gate, real pgvector) | pending |
| T4.2 | OTel MEMORY_EVENTS routing event | pending |
| T4.3 | Benchmark: composite-index filter latency (mean±stddev, ≥3 runs) | pending |
| T5.1 | Owner sign-off ADR + CLAUDE.md amendment | pending |

## Dependency order
Phase 1 (T1.1→T1.2) → Phase 2 (T2.1,T2.2) + Phase 3 (T3.1) → Phase 4 (T4.1,T4.2,T4.3) → Phase 5 (T5.1) → Integration Validation

## BLOCKER surfaced at implement iteration 1 (2026-07-21) — PREREQUISITE T0

**T1.1 RED confirmed, GREEN blocked.** Making `SessionScope.userId`/`AgentScope.userId`
required (scope.ts) + removing the `filtersFromScope` leak-branch is correct AND the RED
test proved it (TS2578 "Unused @ts-expect-error" → satisfied after the change). BUT:

1. The change is ATOMIC with T1.2 — a required `userId` breaks typecheck on every caller
   that builds a bare session/agent scope (local-memory public API + 6 reconstruction sites).
2. The `check_quality.py` PostToolUse hook BLOCKS every edit to `scoped-memory.ts`
   (602 LoC > 300 limit, pre-existing duplicates at :521-539) — and T1.2's reconstruction
   fixes (`deriveScopeFromPayload:168`) live in that file.

**PREREQUISITE T0 (must run BEFORE T1.1 in a future iteration):** refactor
`packages/core/src/infrastructure/db/scoped-memory.ts` (602 → <300 LoC) by extracting the
pure helpers (`applySkillFilters`, `filtersFromScope`, `assertScopeIsNonEmpty`,
`deriveScopeFromPayload`, and the duplicated row→MemoryItem mapping) into a sibling
`scope-filters.ts` + `row-mapping.ts`, and split the `LocalScopedMemory` class body so no
file exceeds 300 LoC. This is legitimate debt (the file is 2x the guideline with real
duplication) — NOT scope-creep. Once done, T1.1+T1.2 (atomic) proceed on files the hook
allows editing. WIP for T1.1 was reverted (git restore) to keep develop green.

## T0 DONE (2026-07-22, commit ebe986a) — scoped-memory.ts split <300 LoC, VERIFIED

Split into scope-filters.ts + row-mapping.ts + scoped-retrieval.ts. typecheck 0 errors;
db/ suite 353/353 pass (0 failures); 28 full-run failures proven PRE-EXISTING (identical
on clean HEAD — dogfood/examples module resolution). scoped-memory.ts now 252 LoC, editable.

## T1.1+T1.2 blast radius (mapped 2026-07-22) — ATOMIC across 3 packages

Making `SessionScope.userId`/`AgentScope.userId` required (RED already proven: TS2578)
breaks typecheck at ALL these sites — they must ALL change in ONE commit:

**packages/core** — scope construction that must carry userId:
- `scope.ts:14-24` — the type change (userId required)
- `scope-filters.ts:110-116` filtersFromScope — remove leak branch (always user_id); `:138,141` deriveScopeFromPayload — carry `typeof userId==='string'?userId:''` (D4 legacy → '')
- `retrieval/pipeline.ts:94,97` — carry `filters.user_id`
- `extraction/pipeline-helpers.ts:117,120` — carry `filters.user_id`
- `eviction/scope-candidate.ts:55,57` — carry `row.user_id ?? ''`
- `local-memory.ts:108,121` — public API `session(userId, sessionId)` / `agent(userId, agentId)`

**packages/api** — REST scope addressing DESIGN DECISION (NEW — plan gap):
- `handlers/{scopes,entities,scoped-forget,episodes,metrics}.ts` + `schemas.ts:147-148` all call
  `memory.session(id)` / `memory.agent(id)` with the tier id from the URL path/body.
- DECISION: the authenticated **Principal.userId owns** the addressed session/agent scope →
  `memory.session(principal.userId, id)`. REQUIRES confirming Principal.userId is in each
  handler's Hono context + threading it through `pathParamsToScoped`. This is the REST-side
  half of the isolation model — the path `/v1/scopes/session/{id}` implicitly means "THIS
  user's session {id}", never a bare workspace-global session.
- ADR needed in the plan (return-to-plan): "REST session/agent scope is (workspace, Principal.user, id)".

**packages/cli** — `cli-scope.ts:67,68` — thread the resolved userId.

**tests** — 3 test files use `.session('x')`/`.agent('x')` 1-arg → migrate to 2-arg.

Next iteration: make the plan ADR decision (REST addressing) → implement the atomic change →
typecheck+tests green → commit. All grounded; no design question left unresolved.
