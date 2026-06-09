---
slug: themory-temporal-fidelity-full-fix
status: DRAFT — follow-up of dashboard-memories-tab-standardization (cycle shipped 2026-06-09)
created_at: 2026-06-09
goal: Restore temporal fidelity across the 5 remaining getAll-adjacent paths AND empirically validate v1.1 bi-temporal asOf against real Postgres row-temporal-truth
---

# Plan (DRAFT): TheMemory temporal fidelity full fix

> This is a **DRAFT** inherited from `dashboard-memories-tab-standardization-plan.md § ADR D5`. The next `/to-plan` invocation against this slug SHALL build on this Context + Baseline; do NOT start from scratch.

## Inheritance note

This DRAFT exists because the sibling cycle `dashboard-memories-tab-standardization` (shipped 2026-06-09 via commits `a79a7bf` → `cf17aee` → `cea60b9`) explicitly scope-bounded its fix to **the REST list path only** (`PgvectorStore.list` + `InMemoryVectorStore.list` + `LocalScopedMemory.getAll`). Per **ADR D5** of that plan, **5 OTHER** `createdAt: new Date()` instances were DEFERRED to this follow-up cycle, AND the v1.1 bi-temporal `asOf` runtime contract (Roadmap Item 12, declared SHIPPED 2026-06-03) was deferred for empirical validation against real Postgres.

## Context

The dashboard-memories-tab-standardization cycle (shipped 2026-06-09) closed the `createdAt: new Date()` fidelity bug ON THE LIST PATH ONLY. Five OTHER paths still construct `MemoryItem.createdAt` (and adjacent `updatedAt` / `tValid` fields) by synthesizing `new Date()` at consumer-site instead of consuming a store-projected value. These were deferred per ADR D5 to:
1. Avoid scope creep on the list-path cycle (10 tasks → would explode to ~30).
2. Allow empirical validation of v1.1 bi-temporal `asOf` semantics separately (recall path is the asOf-consuming path; touching it without an empirical baseline is risky).

## Deferred work — 5 instances + 1 validation gap

Citation lines current as of 2026-06-09 (post commits `a79a7bf` + `cf17aee` + `cea60b9`):

| # | File:line | Path | Why deferred from list-path cycle |
|---|---|---|---|
| 1 | `src/local/index.ts:644` | LocalScopedMemory.recall — MemoryItem construction | recall path consumes the v1.1 bi-temporal `asOf` parameter; touching it without an empirical baseline risks regressing the `t_valid IS NULL OR t_valid <= asOf` invariant from ADR-0011 |
| 2 | `src/local/index.ts:757` | reflect() — derived MemoryItem construction | reflection consumes createdAt for provenance and feeds `consolidation_history`; cross-cuts v0.7 distillation invariants and needs fixture surgery against the LLM-judged merge pipeline |
| 3 | `src/local/index.ts:980` | history()/retrieval — MemoryItem from VectorStoreResult | parallel to getAll path but different consumer; the consolidation-history table has its own temporal columns and cross-cuts v0.7 distillation FK semantics (`ON DELETE SET NULL` GDPR survival) |
| 4 | `src/local/scoped-skill-memory.ts:104` | LocalScopedSkillMemory.getAll — skill scope | skill scope cache wiring was deferred per Roadmap Item 19 v1.5.x semantic cache; touching skill-scope createdAt without coordinating with that follow-up risks cache invalidation drift |
| 5 | `src/local/skills/payload.ts:78` | Skill payload construction | tied to Voyager-pattern skill identity; touching the payload shape without coordinating with the skill-identity hash invariant risks dedup collision drift |
| 6 | (validation gap) | `recall({ asOf })` empirical | v1.1 declared SHIPPED 2026-06-03 but recall path's createdAt construction makes `asOf` semantics untested against real Postgres row temporal-truth — empirical curl + `asOf` parameter + ground-truth assertion needed BEFORE production claim |

## Why this DRAFT exists (instead of a real plan)

Per `/edge-case-plan` review EC-5 + ADR D5 absorption:

- Without this DRAFT, the deferred work becomes **invisible debt** the moment dashboard-memories-tab-standardization ships.
- The next `/to-plan themory-temporal-fidelity-full-fix` invocation SHALL inherit the Context + Citations + Validation Gap above so it does not rebuild from scratch.
- This DRAFT does NOT yet have a Coverage Matrix, Acceptance Criteria, ADRs, or per-task TDD — those are the next `/to-plan` invocation's job.

## Coverage Matrix (to be filled by next /to-plan)

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| (TBD) | (TBD by next /to-plan) | (TBD) | (TBD) |

## Cross-references

- Parent cycle: `.claude/knowledge-base/plans/dashboard-memories-tab-standardization-plan.md` (shipped 2026-06-09; ADR D5 + sub-goal 7)
- Edge-case review: `.claude/knowledge-base/reviews/dashboard-memories-tab-standardization-edge-cases-2026-06-08.md` § EC-5
- v1.1 bi-temporal supplementary ADR: `.claude/knowledge-base/adrs/ADR-0011-bi-temporal-local-runtime-gate-lift.md`
- Roadmap Item 12 (v1.1 multi-peer + bi-temporal): see project `CLAUDE.md § Roadmap`
- Roadmap Item 19 (v1.5 semantic recall cache; skill-scope wiring deferral): see project `CLAUDE.md § Roadmap`
