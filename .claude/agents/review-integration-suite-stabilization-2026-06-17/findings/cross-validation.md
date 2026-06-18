# Cross-Validation Findings — integration-suite-stabilization

```yaml
agent: review-integration-suite-stabilization-cross-validation
review_target: bef52f7~1..HEAD (10b6428) for plan integration-suite-stabilization
plan: .claude/knowledge-base/plans/integration-suite-stabilization-plan.md
slug_commits: [bef52f7, 4cd2e1b, 8d40793, 991efe5, 2b9958c, bd3783b, 10b6428]
# NOTE: 25f3b6d + 58f568c (release commits) + 0050b2a (dogfood rotation) interleave the slug — see F-xval-6

plan_tasks_summary:
  total_tasks: 4            # T0.1, T1.1, T2.1, T3.1
  fully_implemented: 2      # T0.1 (literal), T3.1 (skip-clean)
  partial: 0
  missing: 0
  diverged: 2               # T1.1 (helper NOT used by the 9 files), T2.1 (skip-not-update for 5 files)
  outcome_met: true         # the GOAL (suite 0 failures, deterministic) IS achieved by a different mechanism

acceptance_criteria_summary:
  total: 22                 # across T0.1/T1.1/T2.1/T3.1 + Final Phase + Global DoD
  satisfied: 18
  unverified: 0
  false_claims: 0
  satisfied_by_alternative_mechanism: 4   # T1.1 ACs met via reset-shared-db, not createIsolatedDb

adr_compliance:
  total_adrs: 4             # D1, D2, D3, D4
  respected: 3              # D2 (triage honest), D3 (skipIf), D4 (runMigrations untouched)
  diverged_without_new_adr: 1   # D1 — hybrid reset-shared-db pivot, no ADR-in-implementation/CHANGELOG disclosure

plan_drift:
  plan_edited_after_implement: false
  details: >
    Plan committed once (54c20ea, 2026-06-15 13:24:20). First slug commit bef52f7
    at 13:27:15 (3 min later). Plan was NEVER re-edited after /implement started —
    the plan is a frozen contract. Good. (The divergence is in the implementation,
    not in a mid-flight plan edit.)

findings:
  - id: F-xval-1
    severity: HIGH
    file: tests/integration/_helpers/reset-shared-db.ts; tests/integration/_helpers/isolated-db.ts
    line: reset-shared-db.ts:31-57 (the pivot); vitest.integration.config.ts:58 (setupFiles wiring)
    plan_ref: ADR D1 + T1.1 ("Replace each Bucket A file's new pg.Pool(PG_URI) with createIsolatedDb() in beforeAll")
    summary: >
      D1 PIVOT NOT DISCLOSED VIA ADR. ADR D1 mandates per-file ISOLATED databases
      (createIsolatedDb, unique-named, cloned from template) for the ~9 Bucket A
      files, and EXPLICITLY REJECTED the "reset the shared DB" alternative
      ("Auto-migrate in each beforeAll against the shared DB — rejected: still
      shares one DB"). The implementation did the OPPOSITE: a HYBRID where the
      shared themem DB is DROP+CREATE-cloned-from-template per file via a
      top-level setupFiles hook (reset-shared-db.ts) for MOST files, with
      createIsolatedDb used by only TWO real test files (cli-consolidated,
      forgetting/triadic-eviction). NONE of the 9 declared Bucket A files use
      createIsolatedDb (verified: grep createIsolatedDb on all 9 = 0 hits; all 9
      still read THEOMEM_PG_URI). The pivot is a DEFENSIBLE engineering call (a
      whole-DB clone-per-file is functionally equivalent isolation and avoids
      rewiring 9 files' module-level pools), but per Inquebrável Rule 3 a
      deviation from a REJECTED-alternative-in-the-ADR must be disclosed in an
      implementation ADR or the CHANGELOG. It is disclosed in the commit body of
      4cd2e1b ("Per-file shared-DB reset") and inline in reset-shared-db.ts's
      header comment — but NOT in any ADR and NOT in the user-facing CHANGELOG,
      which still describes the ORIGINAL plan ("migrating the ~9 Bucket A files
      off the shared themem DB" / "each DB-touching test owns its database").
    evidence: |
      grep createIsolatedDb across 9 Bucket A files -> 0 hits each.
      reset-shared-db.ts:52  DROP DATABASE IF EXISTS <shared> WITH (FORCE)
      reset-shared-db.ts:53  CREATE DATABASE <shared> TEMPLATE themem_template
      vitest.integration.config.ts:58  setupFiles: ['.../reset-shared-db.ts']
      ADR D1 Alternatives: "Auto-migrate in each beforeAll against the shared DB — rejected"
      CHANGELOG [0.3.0]: "...so each DB-touching test owns its database" (describes the UNBUILT design)
    recommended_action: >
      Add a short implementation ADR (or a paragraph in an implementation doc) that
      records the D1 pivot: WHY the shared-DB-reset hybrid was chosen over per-file
      isolated DBs (top-level setupFiles ordering avoids killing the running file's
      own connection; whole-DB clone gives equivalent isolation; createIsolatedDb
      retained for the ~2 heaviest schema-polluters). Then CORRECT the CHANGELOG
      [0.3.0] T0.1 entry, which currently claims a design that was not shipped.

  - id: F-xval-2
    severity: MEDIUM
    file: CHANGELOG.md
    line: "[0.3.0] Changed — integration-suite-stabilization T0.1 entry"
    plan_ref: Global DoD ("CHANGELOG.md updated under [Unreleased]") + Inquebrável Rule 6 (write for the consumer)
    summary: >
      CHANGELOG DESCRIBES INTENT, NOT WHAT SHIPPED. The [0.3.0] entry says T0.1 is
      the "Foundation for migrating the ~9 Bucket A files off the shared themem DB"
      and that "each DB-touching test owns its database" — but the 9 files were NEVER
      migrated to owned databases; they stayed on the (now per-file-reset) shared DB.
      A consumer reading the CHANGELOG would believe per-file isolation shipped for
      Bucket A. The actual mechanism (reset-shared-db setupFile) is absent from the
      CHANGELOG entirely. Compounds F-xval-1.
    evidence: |
      CHANGELOG [0.3.0]: "createIsolatedDb({ embeddingDim? }) clones it ... so each
      DB-touching test owns its database ... Foundation for migrating the ~9 Bucket A
      files off the shared themem DB."
      Reality: 9 Bucket A files use the shared DB + reset-shared-db.ts; only 2 files
      use createIsolatedDb.
    recommended_action: >
      Rewrite the T0.1 CHANGELOG entry to describe BOTH shipped mechanisms: the
      per-file shared-DB reset (reset-shared-db.ts setupFile, the primary isolation
      path) AND createIsolatedDb (the secondary path for the 2 schema-polluter
      files). State plainly that the Bucket A files were stabilized by per-file
      shared-DB reset, not by owning isolated databases.

  - id: F-xval-3
    severity: MEDIUM
    file: tests/integration/agent-tools/the-goal.test.ts; tests/integration/reflection/threshold-policy.test.ts; tests/integration/p0-audit-fixes/post-install-bin.test.ts; tests/integration/subpath-isolation.test.ts
    line: "the-goal.test.ts:125,167; threshold-policy.test.ts:43; post-install-bin.test.ts:114; subpath-isolation.test.ts:117"
    plan_ref: ADR D2 ("stale assertion -> update" | "real regression -> fix product") + Coverage Matrix gap 16
    summary: >
      D2 DEFINES A BINARY DISPOSITION (update stale assertion OR fix product). The
      implementation introduced a THIRD disposition for 5 tests — describe.skip /
      test.skip — that the plan did NOT enumerate. Each skip carries an inline
      rationale labeling it stale/obsolete ("Pre-existing stale test ... NOT a
      product regression ... tracked for a follow-up") with cross-coverage cited
      (contract 930 + distillation 9/9). This is HONEST (no assertion was weakened
      to false-green; the skip is explicit and reasoned) and is permitted by the
      plan's Final Phase §2 ("isolate any genuinely new/out-of-scope issue into its
      own follow-up with an honest BLOCKED note; do not green it blindly"). BUT it
      is still a disposition outside the D2 contract: the plan's Coverage Matrix
      row 16 said these would be "triage / isolation" (i.e. resolved), and the
      Global DoD said "every Bucket B resolution carries a stale-vs-regression
      rationale" — a SKIP is neither "stale-assertion update" nor "reorg-regression
      fix." The follow-ups are named informally in comments, not tracked in an
      issue/roadmap entry, so the deferred guard could rot silently.
    evidence: |
      the-goal.test.ts:116-124 "SKIP ... Pre-existing stale test ... NOT a product regression — tracked for an agent-tools-stub modernization follow-up"
      threshold-policy.test.ts:36-42 "Pre-existing stale test ... Tracked for a dedicated reflection-stub modernization follow-up — NOT a product regression"
      post-install-bin.test.ts:108-113 "dist-in-tarball assertions are obsolete; tracked with that publish-topology follow-up"
      subpath-isolation.test.ts:113-116 "obsolete by the complete-workspace-publish-topology decision ... Tracked with that publish-topology follow-up"
    recommended_action: >
      Acceptable as an honest D2-stale disposition, but: (a) document "skip-with-
      rationale" as a recognized third Bucket B disposition in the implementation
      note; (b) convert the 3 informal "tracked for a follow-up" comments into real
      roadmap/issue entries so the disabled guards (agent-tools-stub, reflection-
      stub, publish-topology) are not lost. Per testing.md anti-pattern "@skip
      permanente é dívida técnica invisível" — these need a visible owner + sunset.

  - id: F-xval-4
    severity: LOW
    file: packages/core/src/infrastructure/db/migrations/0015_fix_kind_derived_from_check.sql; packages/core/src/infrastructure/db/schema.ts; README.md
    line: 991efe5 (migration 0015 + schema.ts + drizzle meta); 2b9958c (README P0 sections)
    plan_ref: ADR D2 (real-regression branch) + D4 ("No change to runMigrations public contract")
    summary: >
      Bucket B triage surfaced TWO genuine product regressions and fixed them per
      D2's real-regression branch — this is the plan working AS DESIGNED and is
      honest. (1) Migration 0015 closes a real CHECK NULL-hole (kind='derived' with
      derived_from=NULL wrongly admitted) + restores drizzle journal/snapshot
      parity for hand-authored 0011/0013/0014. (2) README operational P0 sections
      (Agent loops via MCP / CLI verbs / entrypoint) restored after the v2 rewrite
      dropped them. Both are well-disclosed in commit bodies. These are arguably
      WIDER than "test stabilization" but D2 explicitly authorizes product fixes,
      so they are IN-SCOPE. The note: a NEW product migration (0015) shipped inside
      a test-stabilization plan + got RELEASED as part of v0.3.0 BEFORE this review
      validated it (see F-xval-6). D4 is RESPECTED — runMigrations signature/
      behavior unchanged (0015 is a new migration file, not a runner change).
    evidence: |
      991efe5 body: "memories_kind_derived_from_check NULL hole (migration 0015)"
      2b9958c body: "The v2 README rewrite dropped operational content required by PRIORITY 0"
      runMigrations signature unchanged across the slug (no diff to migrations-runner.ts public surface).
    recommended_action: >
      No action on the fixes themselves (correct + disclosed). Optionally note in the
      PR description that a product migration (0015) and a doc-regression fix shipped
      under this plan via D2's real-regression branch, so reviewers of the eventual
      release understand why a "test" plan touched src/ migrations + README.

  - id: F-xval-5
    severity: LOW
    file: scripts/audit/p0-baseline.sh; scripts/audit/public-export-matrix.py; scripts/db-repair-v0-4b-partial-state.mjs; packages/core/tsconfig.build.json; vitest.contract.config.ts
    line: bd3783b, e1ed41d, 36f5a48
    plan_ref: Plan "Files to edit" sections (T0.1/T1.1/T2.1/T3.1) — none declare these files
    summary: >
      SCOPE CREEP (minor, mostly justified). Several non-test files outside the
      plan's declared "Files to edit" were changed: audit scripts (p0-baseline.sh,
      public-export-matrix.py), a db-repair script path, tsconfig.build.json, and
      both vitest configs (dist-alias additions). Most are downstream of the publish/
      reorg fixes that the Bucket B triage legitimately uncovered (e1ed41d/36f5a48
      "ship dist JS / migrations" — a real Node-SSR consumer regression). They are
      coherent with the suite-green goal but were not authorized by the plan's file
      lists. Low severity because each is small + commit-disclosed; flagged for the
      record per the cross-validation anti-pattern "ignoring scope creep."
    evidence: |
      git diff --name-only excluding tests/CHANGELOG/.claude/lockfile shows:
      scripts/audit/p0-baseline.sh, scripts/audit/public-export-matrix.py,
      scripts/db-repair-v0-4b-partial-state.mjs, packages/core/tsconfig.build.json,
      vitest.contract.config.ts, vitest.integration.config.ts.
      None appear in any task's "Files to edit".
    recommended_action: >
      Accept (the changes are coherent with the goal + disclosed in commits). For
      future cycles, when triage uncovers an out-of-plan product/infra fix, note the
      out-of-scope file in the PR description so the file-list divergence is explicit.

  - id: F-xval-6
    severity: HIGH
    file: (process) CHANGELOG.md / git history / .claude/knowledge-base/releases/v0.3.0-release.md
    line: "v0.3.0 tag at 25f3b6d; final fixes 58f568c + 10b6428 AFTER the tag; /review runs only now"
    plan_ref: Global DoD ("Plan archived after /review READY_TO_MERGE + PR merged") + cycle-plan/cycle-review/cycle-release ordering
    summary: >
      CYCLE-ORDERING VIOLATION (process anomaly, honestly surfaced). The canonical
      pipeline is /implement -> /code-quality -> /review (READY_TO_MERGE) ->
      /release. Here the work was IMPLEMENTED and RELEASED as v0.3.0 (tag at 25f3b6d,
      release log 58f568c) BEFORE /review ran. Worse, commit 10b6428 ("close 5
      residual flaky/stale failures") landed AFTER the v0.3.0 release tag — i.e.
      the released v0.3.0 did NOT contain the final stabilization fixes, and the
      suite-green claim is only true at HEAD (10b6428), not at the released tag.
      The plan's own Global DoD ("Plan archived after /review READY_TO_MERGE + PR
      merged") and cycle-review.md ("the gate exists for everything that touches
      production") were inverted. The suite IS green at HEAD (494/61skip/0fail,
      deterministic per the session verification), so no defect shipped silently —
      but the gate ran after the horse left the barn.
    evidence: |
      git rev-list -n1 v0.3.0 -> b3b2dd5 (== 25f3b6d release-bump's parent context)
      git log v0.3.0..HEAD -> 10b6428, 58f568c  (fixes AFTER the tag)
      No .claude/knowledge-base/reviews/integration-suite-stabilization-review-*.md existed before this /review.
    recommended_action: >
      Honest disclosure in the review report + PR: v0.3.0 was cut before this review;
      the final 5-failure fix (10b6428) is post-tag and would land in v0.3.1 (or a
      re-tag). Going forward, do not cut a release before /review returns
      READY_TO_MERGE (cycle-plan.md + cycle-review.md + cycle-release.md). No code
      remediation required if HEAD is green; the action is process-hygiene +
      release-note accuracy.

coverage_table:
  # plan_task -> implementing_commit(s) -> AC_met? -> diverged?
  - { task: T0.1, requirement: "template DB + isolated-db helper", commits: "bef52f7 (+4cd2e1b fresh/embeddingDim opts)", ac_met: true,  diverged: "no — helper exists + tested (isolated-db.test.ts 3/3)" }
  - { task: T1.1, requirement: "9 Bucket A files -> createIsolatedDb", commits: "4cd2e1b (reset-shared-db pivot)", ac_met: "by-alternative", diverged: "YES — ADR D1 pivot to shared-DB reset; 0/9 files use createIsolatedDb; outcome met, mechanism undisclosed (F-xval-1/2)" }
  - { task: T2.1, requirement: "13 Bucket B triage stale-vs-regression", commits: "8d40793, 991efe5, 2b9958c, bd3783b, e1ed41d, 36f5a48, 10b6428", ac_met: "mostly", diverged: "PARTIAL — 5 files SKIPPED (3rd disposition, honest, F-xval-3); 2 real regressions fixed per D2 (F-xval-4)" }
  - { task: T3.1, requirement: "Bucket C LLM-gated skip clean", commits: "8d40793 (dogfood), bd3783b", ac_met: true, diverged: "no — describe.skipIf(KEY==='') per D3 exemplar" }

  # Coverage Matrix 18 gaps
  - { gap: 1,  desc: "template + helper",                          met: true,  via: "T0.1 bef52f7" }
  - { gap: 2,  desc: "forget-hard-survives-audit green",           met: true,  via: "shared-DB reset (NOT isolated per plan)" }
  - { gap: 3,  desc: "reflect-atomic-rollback green",              met: true,  via: "shared-DB reset" }
  - { gap: 4,  desc: "reflect-empty-scope green",                  met: true,  via: "shared-DB reset" }
  - { gap: 5,  desc: "reflect-with-policy green",                  met: true,  via: "shared-DB reset" }
  - { gap: 6,  desc: "skill-isolation green",                      met: true,  via: "shared-DB reset (+ bd3783b tweak)" }
  - { gap: 7,  desc: "the-goal-test green",                        met: true,  via: "shared-DB reset" }
  - { gap: 8,  desc: "examples chat-with-memory-distillation",     met: true,  via: "shared-DB reset" }
  - { gap: 9,  desc: "examples local-openrouter (384 + LLM skip)", met: true,  via: "shared-DB reset + skipIf (NOT isolated 384-dim DB per plan)" }
  - { gap: 10, desc: "schema-v0-4a-constraints green",             met: true,  via: "shared-DB reset" }
  - { gap: 11, desc: "p0-audit/{5 files} resolved",                met: "partial", via: "exports-root/run-server-stub triaged; baseline/matrix/readme via README restore" }
  - { gap: 12, desc: "p0-audit-fixes/post-install-bin resolved",   met: "by-skip", via: "describe.skip obsolete-by-reorg (F-xval-3)" }
  - { gap: 13, desc: "docker-compose-prod + dockerfile-entrypoint",met: true,  via: "8d40793 triage" }
  - { gap: 14, desc: "subpath-isolation + schema-snapshot-parity", met: "partial", via: "schema-snapshot via 991efe5 real fix; subpath-isolation 1 sub-test skipped (F-xval-3)" }
  - { gap: 15, desc: "cli-consolidated + cli/verbs-cli-fixes",     met: true,  via: "cli-consolidated -> createIsolatedDb; 10b6428 relative-budget fix" }
  - { gap: 16, desc: "agent-tools/the-goal + threshold-policy + dogfood-bridge + journal-sync", met: "partial", via: "journal-sync fixed (991efe5); the-goal + threshold-policy SKIPPED stale (F-xval-3); dogfood-bridge triaged (8d40793)" }
  - { gap: 17, desc: "Bucket C LLM skip clean",                    met: true,  via: "T3.1 describe.skipIf" }
  - { gap: 18, desc: "full suite 0 failures deterministic",        met: true,  via: "494 passed | 61 skipped | 0 failed x2 runs (session-verified)" }

verdict_input:
  goal_achieved: true   # suite deterministically green; THE measurable goal is met
  most_important_finding: F-xval-1   # D1 pivot undisclosed via ADR + CHANGELOG describes the unbuilt design
  blockers: 0
  high: 2     # F-xval-1 (D1 disclosure), F-xval-6 (release-before-review)
  medium: 2   # F-xval-2 (CHANGELOG accuracy), F-xval-3 (skip-as-3rd-disposition)
  low: 2      # F-xval-4 (in-scope product fixes), F-xval-5 (minor scope creep)
```

## Narrative summary

The plan's **measurable GOAL is achieved**: the keyless integration suite is deterministically green (494 passed / 61 skipped / 0 failed across two consecutive runs; contract 930 green; typecheck + lint clean). The plan was **NOT edited after /implement started** (single plan commit 54c20ea, 3 minutes before the first slug commit) — the plan is a frozen contract and the divergence lives entirely in the implementation, not in a mid-flight plan rewrite.

**The headline divergence (F-xval-1, HIGH):** ADR D1 mandated **per-file isolated databases** (`createIsolatedDb`, unique-named, template-cloned) for the ~9 Bucket A files and **explicitly rejected** the "reset the shared DB" alternative. The implementation shipped the **opposite hybrid**: a top-level `setupFiles` hook (`reset-shared-db.ts`) that DROP+CREATEs the shared `themem` DB from the template per file, with `createIsolatedDb` retained for only **2** real test files. **0 of 9** Bucket A files use `createIsolatedDb`. The pivot is a *defensible* engineering call (whole-DB clone-per-file gives equivalent isolation; top-level ordering avoids killing the running file's own connection — a real bug the implementer documented), but it contradicts a REJECTED-alternative-in-the-ADR and was disclosed only in a commit body + an inline comment — **not in an implementation ADR and not in the user-facing CHANGELOG**, which still describes the *unbuilt* "each DB-touching test owns its database" design (F-xval-2, MEDIUM). Per Inquebrável Rule 3 this needs an ADR + CHANGELOG correction.

**Bucket B triage (T2.1) is largely honest**: 2 genuine product regressions were fixed per D2's real-regression branch (migration `0015` NULL-hole + drizzle parity; README P0 operational sections) — the plan working as designed (F-xval-4, LOW). But **5 tests were `describe.skip`/`test.skip`** — a **third disposition** D2 never enumerated. Each skip is honestly labeled stale/obsolete with cross-coverage cited and is permitted by the plan's "If Validation Fails §2," yet the deferred guards are tracked only in code comments, risking silent rot (F-xval-3, MEDIUM; cf. testing.md "@skip permanente é dívida técnica invisível").

**Process anomaly (F-xval-6, HIGH):** the work was **RELEASED as v0.3.0 before this /review ran**, and the final 5-failure fix (`10b6428`) landed **after** the v0.3.0 tag — so the released tag does NOT contain the suite-green fixes. The canonical order (implement → review → release) was inverted. No defect shipped silently (HEAD is green), but the gate ran after release; the review report + PR should disclose this and route the post-tag fix to v0.3.1.

**Counts:** 0 BLOCKER · 2 HIGH · 2 MEDIUM · 2 LOW. Coverage: 18/18 gaps met (mechanism diverges on gaps 2-10 + partial on 11/12/14/16). Most important: **F-xval-1** — disclose the D1 pivot via ADR and fix the CHANGELOG to describe what shipped, not what was planned.
