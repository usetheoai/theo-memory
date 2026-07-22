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
