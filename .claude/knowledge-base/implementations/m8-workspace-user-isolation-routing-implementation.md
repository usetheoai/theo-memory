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
