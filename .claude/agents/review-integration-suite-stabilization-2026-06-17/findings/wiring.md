---
agent: review-integration-suite-stabilization-wiring
review_target: bef52f7~1..HEAD for plan integration-suite-stabilization
plan: .claude/knowledge-base/plans/integration-suite-stabilization-plan.md
note: >
  Test-infrastructure plan. The classic wiring triad (caller + integration test +
  runtime metric) applies LOOSELY — no new src/** runtime feature. Re-scoped per
  the agent task to: helper-is-used-not-orphan, config setupFiles/globalSetup
  wiring, helper test exercises the symbol (RED->GREEN), and dead/orphan exports.
triad_revalidation:
  total_new_test_helper_symbols: 5   # createIsolatedDb, IsolatedDb, TEMPLATE_DB, siblingUri, sharedDbName (setup pre-existed; signature reshaped)
  pillar_a_caller_honest_pass: 5 / 5  # every new export has >=1 real in-project caller
  pillar_b_helper_test_exercises: 1 / 1 # isolated-db.test.ts genuinely drives createIsolatedDb (clone+late-tables+384-dim+drop), not a stub
  pillar_c_runtime_metric: n/a        # test-infra; "metric" == full-suite 0-failures determinism, verified below
verification_runs:
  - cmd: pnpm vitest run tests/integration/_helpers/isolated-db.test.ts --config vitest.integration.config.ts
    result: 1 file / 3 tests passed
  - cmd: pnpm vitest run distillation/reflect-with-policy + cli-consolidated (the polluter) + schema-v0-4a-constraints
    result: 3 files / 11 tests passed (the original Bucket-A failure cluster now green together)
  - cmd: pnpm vitest run --config vitest.integration.config.ts  (FULL keyless suite)
    result: 89 passed | 8 skipped (97 files); 494 tests passed | 61 skipped; 0 FAILED; 285.84s; exit 0
findings:

  - id: F-wire-1
    severity: MEDIUM
    file: tests/integration/distillation/reflect-with-policy.test.ts
    line: 1
    plan_ref: Phase 1 / T1.1 + Coverage Matrix rows 2-10 ("All ~9 Bucket A files use per-file isolated DBs")
    summary: >
      ADR-D1 / Phase-1 divergence — ZERO of the 9 named Bucket A files were migrated to
      createIsolatedDb. The plan's headline mechanism (per-file isolated DB cloned from a
      template, applied to every Bucket A file) was NOT the mechanism shipped.
    evidence: |
      Plan T1.1 "Files to edit" lists 9 files, each "beforeAll -> createIsolatedDb()".
      Actual: `grep -rn createIsolatedDb tests/integration` shows the 9 Bucket A files
      STILL open the shared THEOMEM_PG_URI pool (all 9 print "shared-DB" in the audit grep).
      createIsolatedDb's only real callers are forgetting/triadic-eviction.test.ts (NOT in
      the plan's Bucket A list) and cli-consolidated.test.ts (the actual polluter).
      Instead of per-file isolation everywhere, the implementer shipped
      tests/integration/_helpers/reset-shared-db.ts (a vitest `setupFiles` hook) that DROP+
      CREATE...TEMPLATE-clones the shared DB before every file, plus isolated only the two
      DB-mutating offenders (triadic-eviction 384-dim/HNSW-sensitive; cli-consolidated
      `themory migrate`/`server` which dropped late tables / migrated dim to 384).
    why_not_blocker: |
      From a WIRING standpoint the divergence is BENIGN and arguably superior: (a) the
      helper is NOT an orphan — it has 2 deep, well-reasoned callers + 3 exercising tests;
      (b) the alternate mechanism is correctly wired (see F-wire-OK-1/2) and (c) achieves
      the plan's GOAL — full suite 0 failures, verified above. cli-consolidated.test.ts:184
      comment even names the true root cause ("This test was the suite's root schema-state
      polluter ... dropped consolidation_history + reflection_counters"), which is why
      isolating the polluter + a per-file reset solved it without rewiring 9 passing files.
      The CHANGELOG is HONEST about it: the T0.1 entry calls the helper a "Foundation for
      migrating the ~9 Bucket A files" (acknowledges they were not all migrated).
      This is a plan-vs-implementation divergence for the CROSS-VALIDATION agent to rule on
      against D2/Inquebravel Rule 3; wiring confirms no orphan and no gaming.
    recommended_action: >
      Cross-validation owns the verdict. Either (a) accept the divergence and amend the plan
      (D1 superseded by the reset-shared-db approach + targeted isolation) with a one-line
      rationale, or (b) confirm the owner accepts that Coverage-Matrix rows 2-10 were met by
      a DIFFERENT mechanism than the row text states. No code change required for wiring.

  - id: F-wire-2
    severity: MEDIUM
    file: packages/core/src/infrastructure/db/schema.ts
    line: 197
    plan_ref: D4 ("No change to runMigrations public contract"; "plan stays test-infra-focused")
    summary: >
      A genuine PRODUCTION bug fix (migration 0015 + schema.ts CHECK-constraint NULL-hole)
      landed inside this test-infra branch — wider scope than the plan declared.
    evidence: |
      git diff bef52f7~1..HEAD -- packages/core/src/infrastructure/db/schema.ts changes the
      `memories_kind_derived_from_check` constraint: adds `derived_from IS NOT NULL` to the
      'derived' branch (NULL-hole: jsonb_array_length(NULL) >= 1 is NULL, CHECK admits the
      row). Shipped with migration 0015_fix_kind_derived_from_check.sql + drizzle meta
      snapshots 0011-0015 + _journal.json. Commit 991efe5
      "fix(db): migration 0015 closes CHECK NULL-hole + restore drizzle meta parity".
      The plan's D4 and Global DoD assert "no src/** public API change ... test-infra-focused
      (plus any Bucket B product fix in its own layer)". This IS a Bucket-B-class
      reorg-regression product fix, so it has a plan-sanctioned home (D2 / Global DoD bullet
      "any Bucket B product fix is ... in its existing layer"), but it is a runtime DDL change
      not enumerated in the Coverage Matrix.
    why_not_blocker: |
      WIRING is correct and complete: schema.ts + migration SQL + 4 meta snapshots +
      _journal.json are all present and consistent (drizzle parity restored per the commit
      msg), and the constraint is exercised by the distillation integration tests that ran
      green. It is a legitimate fix integrated end-to-end, not an orphan. The scope question
      (was a runtime migration in-charter for a "test-infra" plan?) belongs to cross-validation
      / architecture.
    recommended_action: >
      Cross-validation: confirm this product fix is covered by the D2 "Bucket B product fix in
      its existing layer" allowance and that the Coverage Matrix should have enumerated it.
      Wiring: no action — migration + schema + meta are correctly wired.

  - id: F-wire-OK-1
    severity: INFO
    file: vitest.integration.config.ts
    line: 54
    plan_ref: T0.1 — globalSetup builds template; setupFiles resets shared DB
    summary: globalSetup + setupFiles hooks are correctly wired to the new helpers.
    evidence: |
      Line 54: `globalSetup: ['tests/integration/global-setup.ts']` -> setup() builds the
      themem_template DB once (global-setup.ts:80-103) and closes the builder pool before
      returning (CREATE DATABASE...TEMPLATE requires zero open connections — honored).
      Line 58: `setupFiles: ['tests/integration/_helpers/reset-shared-db.ts']` -> the reset
      runs at module top level (load-bearing: documented at reset-shared-db.ts:1-13, a
      beforeAll would kill the file's own live connection). It consumes TEMPLATE_DB +
      sharedDbName + siblingUri from global-setup, all resolved. fileParallelism:false holds,
      so the per-file DROP/CREATE serializes safely.
    recommended_action: none — wiring confirmed honest and deep.

  - id: F-wire-OK-2
    severity: INFO
    file: tests/integration/_helpers/isolated-db.test.ts
    line: 22
    plan_ref: T0.1 Acceptance Criteria (cloned schema completeness, 384-dim atttypmod, dropDb removal)
    summary: The helper test genuinely exercises createIsolatedDb (RED->GREEN), not a stub.
    evidence: |
      3 tests, all run and assert real DB state: (1) clones template and asserts memories +
      entities + consolidation_history + reflection_counters exist via information_schema;
      (2) createIsolatedDb({embeddingDim:384}) re-migrates and asserts pg_attribute.atttypmod
      == 384; (3) dropDb() then asserts the SPECIFIC themem_it_* DB is gone via pg_database
      COUNT (correctly scoped to THIS test's DB, not a global count that other in-flight
      isolated DBs would pollute — a careful, non-gamed assertion). Verified passing: 3/3.
    recommended_action: none — pillar (b) honest pass.

  - id: F-wire-OK-3
    severity: INFO
    file: tests/integration/_helpers/isolated-db.ts
    line: 22
    plan_ref: Dead-export check (every new export re-exported or used internally)
    summary: No orphan / dead exports introduced.
    evidence: |
      New exports and their consumers: createIsolatedDb (triadic-eviction:67,
      cli-consolidated:121,188, isolated-db.test:23,42,57); IsolatedDb interface (return type
      of createIsolatedDb); TEMPLATE_DB (isolated-db.ts:57, reset-shared-db.ts:53); siblingUri
      (isolated-db.ts:55,68, reset-shared-db.ts:34, isolated-db.test:62); sharedDbName
      (reset-shared-db.ts:33); setup (vitest globalSetup hook). Teardown is balanced — dropDb
      called in afterAll of both real callers (triadic-eviction:99, cli-consolidated:154,214).
    recommended_action: none — zero dead test-helper exports.
summary_counts:
  BLOCKER: 0
  HIGH: 0
  MEDIUM: 2
  LOW: 0
  INFO: 3
most_important: >
  F-wire-1 — the plan's headline ADR D1 mechanism (migrate all 9 Bucket A files to
  createIsolatedDb) was NOT shipped; a different, correctly-wired and arguably-better
  mechanism (per-file reset-shared-db setupFile + targeted isolation of the actual polluter)
  achieves the GOAL (full suite 0 failures, verified: 89 passed / 8 skipped / 0 failed).
  Benign from a wiring view (no orphan, no gaming, CHANGELOG honest), but the plan-vs-impl
  divergence on Coverage-Matrix rows 2-10 is for the cross-validation agent to formally rule on.
