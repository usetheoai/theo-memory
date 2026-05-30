# Implementation Contract: chat-with-memory-e2e-fixes

**Plan:** `.claude/knowledge-base/plans/chat-with-memory-e2e-fixes-plan.md` (v1.1, SHIPPABLE 90.4)
**Branch:** `feat/v0-6-voyager-skill-library`
**Baseline commit:** `95d260a` (post demo expansion 22f148b + audit artifacts 069a257/fc7ed9b + gitignore widen 95d260a)
**Started:** 2026-05-30
**SEPA agent:** `.claude/agents/implement-chat-with-memory-e2e-fixes-2026-05-30/sepa.md`

## Pre-condition audit

- [x] Plan exists at `.claude/knowledge-base/plans/chat-with-memory-e2e-fixes-plan.md`
- [x] Plan-confidence verdict: SHIPPABLE (90.4 ≥ 70 floor)
- [x] Deps-audit verdict: PASS_WITH_CAVEATS (cap 89)
- [x] Edge-case review absorbed: v1.0 → v1.1 (EC-1 CHANGELOG in T2.1; EC-2 `.next/` purge in T3.1)
- [x] Branch: `feat/v0-6-voyager-skill-library` (not `main`)
- [x] Working tree clean (except unrelated user-personal untracked dirs)
- [x] Node: v22.22.2 satisfies `engines.node: >=22.12.0`
- [x] pgvector container up (themem_pgvector, port 5432)
- [x] Port 3000 free

## Ordered task list

| Order | Task ID | Status | File(s) | LoC | Commit-shape | Depends on |
|---|---|---|---|---|---|---|
| 1 | T0.1 | pending | `examples/chat-with-memory/lib/theomemory-plugin.ts` | ~10 | `fix(demo)(chat-with-memory): HMR-safe writeCounts via globalThis (T0.1 / F3)` | — |
| 2 | T1.1+T1.2 atomic | pending | `examples/chat-with-memory/app/api/skills/consolidate/route.ts` + `examples/chat-with-memory/components/memory-tabs/skills-tab.tsx` | ~6 | `fix(demo)(chat-with-memory): consolidate uses 0.6 cluster threshold (T1.1+T1.2 / D4)` | — |
| 3 | T2.1 | pending | `examples/chat-with-memory/README.md` + `CHANGELOG.md` | ~25 | `docs(demo)(chat-with-memory): document clusterThreshold + writeCounts choices (T2.1)` | T0.1, T1.1+T1.2 |
| 4 | T3.1 | pending | (none — invokes `/test-chat-with-memory` skill; produces dated report) | n/a | `docs(audit)(chat-with-memory): /test-chat-with-memory re-run READY (T3.1)` | T0.1, T1.1+T1.2, T2.1 |

Parallelizable: T0.1 + (T1.1+T1.2) (different files, no shared state). T2.1 waits on both. T3.1 waits on T2.1.

## Wiring triad assessment per task

Per ADR D4 of the plan ("Test-of-record is `/test-chat-with-memory`, not vitest"):

- **Pillar (a) Static caller:** N/A — no new public exports declared. `globalThis._themory_demo_writeCounts` is a runtime state slot, not an exported symbol. `clusterThreshold` is forwarded to an existing `ConsolidateOptions` field. Skipping pillar (a) for this plan.
- **Pillar (b) Integration test:** N/A for vitest. The integration test IS `/test-chat-with-memory` re-run (T3.1). Pillar (b) satisfied transitively by T3.1's PASS criteria.
- **Pillar (c) Runtime metric:** the plan does not declare new metrics. N/A.

ADR-style deferral note: all 3 pillars are N/A because the plan is demo-side configuration tuning + state-management refactor that ship as a behavioral PASS through the E2E skill. No new symbols, no new metrics, no new core surface.

## Global DoD checkpoint progression (mirror of plan's Global DoD)

- [ ] T0.1 + T1.1+T1.2 + T2.1 + T3.1 all status=committed
- [ ] `git diff --stat src/ | wc -l == 0` (zero core file touched)
- [ ] `npm test` from repo root: 490 passed unchanged
- [ ] Root `npm run typecheck` + `npm run lint`: zero output
- [ ] Demo `npm run typecheck` + `npm run lint`: zero output
- [ ] `/test-chat-with-memory` re-run verdict: READY
- [ ] CHANGELOG.md [Unreleased] § Changed updated
- [ ] No `production-ready` / `production-grade` token introduced
- [ ] No Co-Authored-By trailer in commits
