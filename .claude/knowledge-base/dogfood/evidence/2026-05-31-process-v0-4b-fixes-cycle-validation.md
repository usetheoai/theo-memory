---
scenario: process-dogfood
date: 2026-05-31
pr: 24
merge_commit: 9a8bca3
goal_test_recall_at_10: 1.000
test_chat_with_memory_verdict: PARTIAL (Group H 3/3 PASS via API+SQL; UI scenarios deferred — Chrome MCP browser locked)
test_chat_with_memory_report: .claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-31-rerun.md
plan_executed: examples-chat-with-memory-v0-4b-expansion v1.2 (SHIPPABLE 94.8)
unlocks_production_ready_claim: false
counts_toward_s1: false
---

# Process dogfood — v0.4b-fixes-cycle verification (2026-05-31)

This evidence file documents the **process dogfood** loop that validated PR #24 (v0.4b-fixes-cycle + voyager-skill-library + earlier cycles merged 2026-05-31 at `9a8bca3`) and the follow-on `examples-chat-with-memory-v0-4b-expansion` cycle.

It is **explicitly NOT counted toward S1 advancement** (`scenario: process-dogfood` in the frontmatter, NOT `claude-code-auto-memory`). Per `dogfood-golden-rule.md` § "The Rule" rule 2, anchor scenario S1 must be `running` to unlock `EVIDENCE_SUFFICIENT`; S1 status remains `planned` because the wiring (v0.2 TheoKit binding for Claude Code OR a dedicated Claude Code adapter) has not shipped. Adding evidence under S1's slug would be silent fabrication; the honest path is a SEPARATE `process-dogfood` slug for process validation, with `unlocks_production_ready_claim: false` set explicitly.

## What was validated

### v0.4b-fixes-cycle empirical gates (frozen at PR #24 merge `9a8bca3`)

- `npm test` (contract suite): 544/546 PASS (2 SKIPPED with documented reason)
- Integration suites: 67/67 PASS against real `ankane/pgvector:v0.5.1`
- `npm run typecheck`: exit 0
- `npm run lint`: 0 warnings
- THE GOAL TEST (v0.4b T7.1 / forgetting pipeline): `recall@10 = 1.000` against the seeded test set (1000 memories × 50 rare-query targets, per plan T7.1 acceptance)
- BREAKING change discipline: `Memory.forget` widened with `options?: ForgetOptions` exposing `hard?: boolean`; CHANGELOG `**BREAKING**:` prefix + conventional-commits `!` marker applied

### examples-chat-with-memory-v0-4b-expansion cycle (this plan, commits 42d209d → 0c6fd10 on develop)

- T0.1 pre-flight: 6/6 PASS
- T1.1 + T1.2 (bundled at `9ef0087`): `createLocalMemory({ eviction })` wired in demo `lib/memory.ts`; `/api/memory/eviction-status` endpoint returns documented shape; EC-5 + EC-6 absorbed
- T1.3 (`9c1c4ea`): `EvictionTab` component renders conditional state; `activeCount` extension to T1.2 endpoint; EC-1 absorbed (userId via prop from MemorySidebar)
- T2.1 (`446051b`): `/api/memory/forget` accepts opt-in `{ hard?: boolean }`; default soft-delete preserved per T7.1 BREAKING; raw SQL verified 3 scenarios (default → t_invalid NOT NULL; `hard:true` → physical delete; invalid `hard` → 400). EC-2 absorbed
- T3.1 (`37a88b4`): `/test-chat-with-memory` skill catalog extended 30 → 33 scenarios with Group H (Eviction tab)
- T4.1 (`0c6fd10`): `/test-chat-with-memory` rerun report PARTIAL — Group H 3/3 PASS at API+SQL; UI scenarios deferred due to Chrome MCP browser lock

## Findings that emerged from the dogfood loop

Process dogfood is valuable precisely BECAUSE it surfaces gaps that pre-merge audits missed. This run surfaced 3 followups + 2 pre-existing findings worth logging:

- **F1** (T1.1): `.env.example` update for `THEOMEM_EVICTION_DEMO` was blocked by a project hook that denies `.env*` pattern writes. README documents the var instead. Skill catalog (`/test-chat-with-memory`) exports the var in its dev-server spawn.
- **F2** (T2.1): plan §386 lists `/api/skills/forget` for `{ hard }` extension; `ScopedSkillMemory.forget(skillId: string)` does not accept options (already hard-delete by design at `src/core/skill.ts:161-172`). Skills route stays unchanged; deviation documented honestly.
- **F-T4.1-1**: Chrome DevTools MCP browser locked by stale `SingletonLock` symlink. `/test-chat-with-memory` skill should spawn an isolated `userDataDir` per run to make itself resilient to cross-session conflicts.
- **F-T4.1-2**: post-`POST /api/chat`, extracted facts land in DB rows with `user_id = NULL` (only `session_id` populated). NOT a regression introduced by this cycle (T1.1-T2.1 do not touch the chat → `user.remember` path). The 2026-05-30 `/test-chat-with-memory` READY 30/30 baseline may have validated B1 only at UI level, not at the DB level. Worth a focused investigation in the next cycle.
- **F-T4.1-3**: `EvictionTab` UI rendering and the 5-tab sidebar layout not browser-validated this run. Code pattern matches known-good `UserTab` / `SessionTab`; risk LOW. Re-verify when Chrome MCP unblocks.

## Why this evidence does NOT unlock production-ready claims

Per `dogfood-golden-rule.md` § "The Rule":

> A `production-ready` claim, a promotion to v1.0, or any public copy stating that TheMemory is production-grade is INVALID and CANNOT be made when:
> 1. The anchor scenario is missing from the manifest.
> 2. **The anchor scenario is not `running`.** Status is `planned`, `wired`, `paused`, or `abandoned`. Only `running` counts.
> 3. No evidence file exists for the anchor scenario.
> 4. The latest anchor-scenario evidence file is older than 30 days.

S1 status is `planned`. Rule 2 fires regardless of how many process-dogfood files this directory carries. `/dogfood` audit MUST continue returning `EVIDENCE_INSUFFICIENT` with stable identifier `anchor_not_running` after this file lands.

The frontmatter field `unlocks_production_ready_claim: false` makes this explicit at the data layer; anyone consuming evidence files programmatically can filter on that field.

## What's next for actually unlocking v1.0

The roadmap to `EVIDENCE_SUFFICIENT` requires:

1. **v0.2 TheoKit binding** OR a dedicated `@usetheo/memory/claude-code` adapter — the wiring layer that makes Claude Code's auto-memory consume TheMemory through its public API.
2. **S1 status transition `planned` → `wired`** after the first successful read + write are logged.
3. **S1 status transition `wired` → `running`** after 7 consecutive days of primary-backing-store usage.
4. **At least 1 anchor-scenario evidence file** logged under `scenario: claude-code-auto-memory` (different from this file's `process-dogfood` slug).
5. **The latest anchor evidence ≤ 30 days old** maintained continuously.

None of those conditions are satisfied today; none are advanced by this file. They remain the inquebrável gate for any `production-ready` / `production-grade` / `v1.0 ready` vocabulary anywhere in the project.

## Cross-references

- Golden rule: `.claude/rules/dogfood-golden-rule.md`
- Manifest (anchor S1 declaration): `.claude/knowledge-base/dogfood/manifest.md`
- Plan executed: `.claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md`
- /test-chat-with-memory report: `.claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-31-rerun.md`
- v0.4b-fixes-cycle plan (archived post-merge): `.claude/knowledge-base/plans/completed/v0-4b-fixes-cycle-plan.md`
- PR #24 merge commit: `9a8bca3` (2026-05-31)
