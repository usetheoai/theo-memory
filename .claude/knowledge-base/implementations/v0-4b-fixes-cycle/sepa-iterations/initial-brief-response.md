# SEPA — Initial brief / v0-4b-fixes-cycle / Mode VERBOSE

Date: 2026-05-31
Plan version reviewed: v1.3 (SHIPPABLE_WITH_CAVEATS 84.8)
Agent ID: ad815e351b16850c0
Invocation path: Fallback (general-purpose + SEPA file path in prompt) — per v1.5 SEPA discovery-timing rule (agent file written mid-session)

## Plan recap

- Enable v0-4b-forgetting-pipeline `/review` re-run to flip NEEDS_FIXES → READY_TO_MERGE via 18 atomic commits closing 40 findings (1 BLOCKER + 5 CRITICAL + 13 MAJOR + 8 MINOR + 13 INFO), inspired by the v0.6.1 voyager-skill-library-fixes-v0-6-1 precedent (commit `b6aead6`, 23→14 commits → READY_TO_MERGE).

## Artifact existence

- `.claude/agents/implement-v0-4b-fixes-cycle-2026-05-31/sepa.md` — 161 lines, frontmatter valid (name: `implement-v0-4b-fixes-cycle-sepa`, model: opus, tools: Read/Glob/Grep) — read OK
- `.claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md` — 1099 lines, v1.3 SHIPPABLE_WITH_CAVEATS (84.8) — read OK
- `.claude/knowledge-base/implementations/v0-4b-fixes-cycle-implementation.md` — 164 lines, 18 tasks pending, pre-condition audit complete — read OK
- `.claude/knowledge-base/reviews/v0-4b-fixes-cycle-edge-cases-2026-05-30.md` — 10655 bytes — read OK
- `.claude/knowledge-base/audits/v0-4b-fixes-cycle-deps-audit-2026-05-30.md` — 8354 bytes, PASS verdict — read OK

## Findings

- INFO — **EC-1 (T0.1) correctly absorbed.** Plan § Tasks step 3 (line 208) explicitly requires `DROP DATABASE IF EXISTS themem_journal_sync_tmp;` BEFORE `CREATE DATABASE`; step 6 (line 211) requires `_journal.json` entries-count delta == 2 assertion with abort-on-mismatch. Premise verified: actual `_journal.json` on disk stops at idx=2 (`0002_skill_columns`); `0003_eviction_columns.sql` + `0004_eviction_half_life_trigger.sql` exist but lack snapshots. F-dom-db-1 BLOCKER is real and the fix path is correct.

- INFO — **EC-2 (T1.1) correctly absorbed.** Plan § Deep Dives lines 273-282 declares the `isOptionsObject` type guard with explicit `arg === undefined || isWeightsLike(arg)` branching BEFORE the `in` operator. RED test 4 (line 299) directly asserts `new TriadicScoringPolicy(undefined, undefined, null, null, evictor)` constructs without TypeError. Plan claims "8+ existing test call sites"; actual disk count is **12 positional call sites** (10 in tests, 1 in run.ts, plus 3 NEW-shape weight-object sites in `src/local/eviction/__tests__/scoring-math.test.ts` which are not the same shape). Plan undercount is benign (margin is upward).

- INFO — **EC-3 (T7.1) correctly absorbed.** ADR D7 (plan lines 117-121) explicitly declares forget() PUBLIC API BREAKING. Acceptance row line 620 requires `**BREAKING**:` prefix in CHANGELOG.md. RED test 3 (line 611) asserts raw SELECT post-forget returns 1 row with `t_invalid IS NOT NULL`. Confirmed against disk: `src/local/index.ts:430` currently calls `vectorStore.delete(memoryId)` (hard delete) — the F-dom-3 premise is real.

- INFO — **EC-4 REVERSAL (T11.1a + T11.1b) correctly absorbed.** Plan splits T11.1 into T11.1a (runbook ships FIRST — doc-only) + T11.1b (idempotency + repair-script — KEEPS `IF NOT EXISTS` guards). Plan Files-to-edit line 842 explicitly states `0003_eviction_columns.sql — UNCHANGED on IF NOT EXISTS guards`. Disk verification: `0003_eviction_columns.sql` currently HAS `IF NOT EXISTS` on all 3 `ALTER TABLE ... ADD COLUMN` statements AND on the index `idx_memories_eviction_score`. T11.1b preserves them. ✓

- INFO — **ADR D17 + ADR D12 references are CROSS-PLAN, not in-plan.** Plan body cites `ADR D17 § Consequences` (line 119, 597, 627) + `ADR D12` (lines 53, 153, 668, 673, 694, 992, 1014). These ADRs do NOT exist in this plan's locked set D1-D8. They refer to ADRs in the ORIGINAL v0-4b-forgetting-pipeline plan (now in `plans/completed/`). Plan acknowledges this explicitly: line 627 says "ADR D17 § Consequences in plan v0-4b updated (post-merge)"; line 673 says "plans/completed/v0-4b-forgetting-pipeline-plan.md — POST-MERGE: ADR D12 amended". This is **NOT** a fabricated-ADR-citation defect — the plan is honest about referring to ancestor ADRs in the completed plan, and the T8.1 DoD targets that completed-plan amendment, NOT this plan. INFO not CRITICAL.

- INFO — **All RED test paths are reachable under existing vitest configs.** Plan introduces 15 new test files; all `src/{core,local}/.../__tests__/*.test.ts` paths are caught by `vitest.contract.config.ts` (`src/{core,local,theokit,agent-tools}/**/__tests__/**/*.test.ts`); all `tests/integration/**/*.test.ts` paths are caught by `vitest.integration.config.ts`. v1.5 cycle-implement retrospective gate satisfied — no unreachable-path defect.

- INFO — **Files-to-edit references valid.** No task references a file marked non-`(NEW)` that doesn't exist on disk. T0.1 edits real `_journal.json`; T1.1 edits real `src/local/eviction/triadic-scoring-policy.ts:214`; T7.1 edits real `src/local/index.ts:430`. Cross-spot-check verified.

- INFO — **Deps audit verdict PASS** (0 CVE on declared deps; 4 MODERATE allowlisted dev-only via drizzle-kit chain, sunset 2026-08-23). ADR D8 explicitly defers zod v3→v4 migration. No supply-chain blocker before halt-loop start.

- INFO — **Inquebrável compliance baked into plan.** Plan honors `architecture.md § Module hygiene` (≤500 LoC), `testing.md` (TDD-first on every task), `no-paper-names-in-code.md` (zero new paper-name introductions stated line 40), `dogfood-golden-rule.md` (no production-ready claim), `deps-audit-golden-rule.md` (zero new deps). Implementation contract line 95 explicitly forbids `Co-Authored-By:` trailer.

- INFO — **Task ordering reflects dependency graph correctly.** T0.1 (BLOCKER) → T1.1 (constructor shape unblocks T3.1/T4.1/T8.1) → T2.1 → T3.1 (scope union unblocks T4.1/T7.2) → T4.1 (factory wiring unblocks T7.1) → T5.1-T8.1 → T9.1-T11.2 → T12.1 → T13.1 (THE GATE). Serial execution per ADR D1 atomic-commit-per-task; parallelism is theoretical only.

- INFO — **no deviations from plan detected**. Plan v1.3 is structurally tight; all 4 high-risk surfaces (T0.1 BLOCKER, T1.1 EC-2 disambiguation, T7.1 BREAKING contract, T11.1b EC-4 reversal) have explicit RED tests + Acceptance rows wired. Plan-confidence v1.3 score 84.8 is genuine (not gamed via coverage-row prose fix alone).

## Recommended kick-off

Iteration 1 MUST work on **T0.1 (Drizzle journal sync — BLOCKER F-dom-db-1)** — strictly first per dependency graph. The SINGLE most important gotcha: **EC-1 absorption step 3 (DROP DATABASE before CREATE) AND step 6 (assert entries-count delta == 2 BEFORE proceeding)** — these guard against `drizzle-kit generate` producing byte-wrong snapshots from an unclean baseline, which would ship silent schema corruption to consumers (an own-BLOCKER worse than the F-dom-db-1 it's fixing). The RED tests at `tests/integration/migrations/journal-sync.test.ts` (NEW file) assert `count(meta/*.json)-1 == count(0*.sql)` AND every `.sql` has a matching journal entry — confirm both fail BEFORE running `npm run db:generate`.

## Confidence

HIGH — per Inquebrável Rule 1. The 4 artifacts exist + are coherent; the 4 high-risk EC absorptions (EC-1, EC-2, EC-3, EC-4 reversal) are all explicitly wired into the plan with RED tests + Acceptance rows; disk-state verification confirmed the BLOCKER + CRITICAL premises are real (journal stops at 0002, forget() hard-deletes, 0003.sql has `IF NOT EXISTS` to KEEP); ADR D17/D12 references are cross-plan (to plans/completed/v0-4b-forgetting-pipeline-plan.md) NOT in-plan, and the plan declares this honestly; vitest config reachability satisfies the v1.5 retrospective gate. The halt-loop can start on T0.1 immediately. The plan is ready to drive.
