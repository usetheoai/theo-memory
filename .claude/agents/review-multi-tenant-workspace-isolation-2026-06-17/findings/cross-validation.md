---
agent: review-multi-tenant-workspace-isolation-cross-validation
review_target: 23ce3d1~1..HEAD (HEAD=bd66da1) for plan multi-tenant-workspace-isolation
plan: .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md
date: 2026-06-17
verdict: NEEDS_FIXES (1 HIGH + 4 MEDIUM; no BLOCKER; GOAL TEST + all shipped DoD green)

plan_tasks_summary:
  total_tasks: 7         # T0.1, T0.2, T1.1, T1.2(deferred), T2.1, T3.1, T4.1
  fully_implemented: 5   # T0.1, T0.2, T1.1, T2.1, T3.1
  partial: 1             # T4.1 (default-workspace.test.ts declared but missing; D7 shipped in T2.1)
  deferred: 1            # T1.2 (honest, disclosed)
  missing: 0
  diverged: 0            # no silent divergence; deferral + file-substitutions all disclosed in commit bodies

acceptance_criteria_summary:
  total: 28              # across the 7 tasks' Acceptance Criteria + DoD bullets
  satisfied: 24
  unmet_but_deferred: 3  # T1.2 gaps 8/9/27
  unmet_not_deferred: 1  # T1.1 EC-9 in-memory parity (gap 28)
  false_claims: 0        # no checkbox ticked while criterion unmet (plan leaves boxes unchecked)

adr_compliance:
  total_adrs: 9          # D1, D2, D3, D4, D5, D-LEAF, D6, D7, D8
  respected: 9
  diverged_without_new_adr: 0

plan_drift:
  plan_edited_after_implement: true
  details: >
    The plan file was edited at 11:06 (commit 2b6ef8e, T4.1) — AFTER /implement
    started (T0.1 at 10:06; plan baseline 2593efa at 10:00). The edit added ONLY a
    2-line `>` blockquote marking T1.2 DEFERRED (git show 2b6ef8e --stat: 2 insertions).
    JUDGED HONEST AMENDMENT, NOT A MOVED GOALPOST: it is a disclosure of a scope
    deferral (mirrors the plan's own secondary-path deferral precedents — repo-tier
    cache → v1.5.x, EC-9 skill-scope asOf), recorded in CHANGELOG Known-limitation +
    the commit body. The GOAL TEST, the GoDoD, and the Coverage Matrix verdict line
    were NOT softened to make a failing state pass. The one defect is that the Coverage
    Matrix table itself (still "28/28 100%") was not updated to mark gaps 8/9/27 as
    DEFERRED — see F-xval-1.

governance:
  amendment_present_claude_md: true   # CLAUDE.md:94 "Amendment 2026-06-17 — Multi-tenant workspace isolation RE-CLASSIFIED"
  amendment_present_changelog: true   # CHANGELOG.md:25 P0 scope amendment note
  sign_off_commit: 0cf9104            # chore(governance) project-owner sign-off
  scope_matches_amendment: true       # workspace orthogonal to tiers (D1); AuthVerifier breaking (D2); default-workspace bridge (D7) — all match the amendment text
  inquebravel_rule_10_satisfied: true # P0 freeze respected: feature re-classified in-scope via owner amendment, not snuck in

goal_test:
  file: tests/integration/auth/workspace-isolation.test.ts
  exists: true
  result: 3/3 PASS against real ankane/pgvector:v0.5.1 (re-run this session, 3.17s)
  caveat: >
    The GOAL TEST exercises isolation through the SDK seam Memory.withWorkspace
    (createLocalMemory direct), NOT through the REST handler HTTP stack. The plan's
    T3.1 TDD block specified 4 IDOR cases INCLUDING the body-workspaceId→400 case and
    the admin-per-workspace case; the shipped test covers only 3 (cross-ws recall
    empty, cross-ws forget 404+EC-5, within-ws forget control). See F-xval-3.

commits_verified:
  - 23ce3d1  T0.1  Principal + Workspace + AuthVerifier.resolvePrincipal
  - 2e62265  T0.2  0016 migration + schema parity
  - 7eeb695  T1.1  thread workspace_id through PgvectorStore (+ EC-12 dedup index, disclosed)
  - db50915  T2.1  resolvePrincipal + middleware injects Principal
  - 0a63b48  ---   exports-contract baseline 41->43 + per-export JSDoc (sentinel)
  - ea9f2dc  T3.1  derive workspace from Principal end-to-end + GOAL TEST
  - 2b6ef8e  T4.1  README + breaking note + T1.2 deferral note (plan edit)
  - bd66da1  ---   full-public-surface baseline 41->43 (2nd sentinel) [NOT in review brief — extra HEAD commit]
  - 0cf9104  gov   P0 re-classification sign-off

findings:
  - id: F-xval-1
    severity: HIGH
    file: .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md:562-595
    plan_ref: Coverage Matrix gaps 8, 9, 27 (and 21 partial) → T1.2 (DEFERRED)
    summary: >
      Coverage Matrix still asserts "Coverage: 28/28 gaps covered (100%)" while T1.2
      — which is the sole/partial owner of gaps 8 (skill+cache+eviction threaded),
      9 (recall-cache no cross-ws hit), 27 (EC-8 cache no cross-ws hit), and the
      runtime-filter half of 21 (EC-1 no join-inherit leak) — was DEFERRED during
      /implement. The deferral is honestly disclosed in the T1.2 blockquote + CHANGELOG
      Known-limitation, but the matrix verdict line was NOT reconciled, so the plan's
      own headline claim (100%) now overstates delivered coverage. This is the
      single most important cross-validation defect: a matrix that contradicts the
      deferral it sits beside.
    evidence: |
      git show 2b6ef8e --stat → plan +2 lines (the deferral blockquote only).
      sed -n '562,596p' plan → row 8/9/27 map to T1.2; row 21 maps to "T1.1 + T1.2";
      footer still reads "Coverage: 28/28 gaps covered (100%)".
      The column denormalization half of gap 21 IS met (0016 adds workspace_id to all
      6 tables incl. entities + recall_cache), but the WHERE-clause filter on the
      cache/entities read paths belongs to T1.2 and is deferred.
    recommended_action: >
      Update the Coverage Matrix to mark gaps 8/9/27 (and the filter-half of 21) as
      DEFERRED→follow-up `multi-tenant-workspace-isolation-secondary-stores`, and
      restate the footer as e.g. "24/28 shipped + 4 deferred (disclosed)". Honest
      disclosure (Inquebravel Rule 3) requires the matrix and the deferral to agree.

  - id: F-xval-2
    severity: MEDIUM
    file: packages/core/src/infrastructure/db/in-memory-store.ts
    plan_ref: T1.1 Acceptance Criteria item 4 (EC-9) + Coverage Matrix gap 28
    summary: >
      T1.1 AC #4 explicitly requires the in-memory/contract store to apply the SAME
      workspace_id filter "so contract tests cannot pass while integration leaks (EC-9)".
      in-memory-store.ts has ZERO workspace_id awareness (grep 'workspace' → no hits),
      and store-isolation.test.ts does not assert in-memory parity. Gap 28 (EC-9) is
      therefore UNMET and is NOT part of the disclosed T1.2 deferral — it belongs to
      shipped T1.1. The contract-path safety net the plan designed against
      "contract green while integration leaks" is absent.
    evidence: |
      grep -n "workspace" packages/core/src/infrastructure/db/in-memory-store.ts → empty.
      grep -ni "in.memory|InMemory|EC-9" tests/integration/workspace/store-isolation.test.ts → empty.
      Plan T1.1 AC: "- [ ] in-memory-store.ts ... applies the SAME workspace_id filter ... (EC-9)".
    recommended_action: >
      Either (a) thread workspace_id into in-memory-store.ts + add the EC-9 parity
      assertion (closes gap 28 as the plan specified), or (b) if EC-9 is consciously
      folded into the T1.2 secondary-store deferral, say so explicitly in the matrix
      (currently gap 28 maps to T1.1, which is marked shipped).

  - id: F-xval-3
    severity: MEDIUM
    file: tests/integration/auth/workspace-isolation.test.ts:65-124
    plan_ref: T3.1 TDD block (4 declared IDOR cases) + gaps 14, 16, 24
    summary: >
      The GOAL TEST as shipped covers 3 of the 4 cases the plan's T3.1 TDD block
      enumerated. MISSING: (a) "a body workspaceId field → 400 unrecognized_keys via
      .strict() (EC-4), proving the field is REJECTED (explicit), not silently dropped"
      (gap 14/24); (b) "ws-B admin cannot list ws-A keys (admin scoped to principal
      workspace)" (gap 16). The .strict() schema that backs (a) pre-exists and DOES
      reject unknown keys, so the property likely holds — but it is asserted by NO test
      in this slug, so gaps 14/24 are claimed-met-without-coverage. The GOAL TEST also
      runs through the SDK seam (createLocalMemory + Memory.withWorkspace), not the
      REST HTTP stack, so the IDOR matrix is proven at the store/contract layer rather
      than at the handler+auth-middleware layer the plan's IDOR matrix targeted.
    evidence: |
      grep -n "strict|400|admin|unrecognized|workspaceId" goal-test → empty (no such assertion).
      git show ea9f2dc --name-only → schemas.ts NOT edited; the .strict() is pre-existing.
    recommended_action: >
      Add a REST-path test (or extend the GOAL TEST via createApp) asserting
      POST with body workspaceId → 400 and ws-B admin cannot enumerate ws-A keys, to
      cover gaps 14/16/24 with real assertions rather than implicit pre-existing schema.

  - id: F-xval-4
    severity: MEDIUM
    file: tests/integration/auth/default-workspace.test.ts (DECLARED, MISSING)
    plan_ref: T4.1 Files-to-edit + TDD + DoD ("default-workspace.test.ts exits 0")
    summary: >
      T4.1 declares a NEW integration test tests/integration/auth/default-workspace.test.ts
      with a RED/GREEN/VERIFY block and a DoD line requiring it to exit 0. The file does
      not exist (commit 2b6ef8e only touched plan/CHANGELOG/README). The D7 behavior it
      would prove (no-credential → default workspace; legacy THEMEMORY_API_KEY → default)
      DID ship in T2.1 (middleware + BearerAuthVerifier.resolvePrincipal, covered by
      principal-resolution.test.ts's "env→default" case), so the BEHAVIOR is tested —
      but the specific T4.1 DoD artifact is absent. T4.1 is therefore PARTIAL: docs
      shipped, the declared test did not.
    evidence: |
      ls tests/integration/auth/default-workspace.test.ts → MISSING.
      git show 2b6ef8e --name-only → plan.md, CHANGELOG.md, README.md only.
      principal-resolution.test.ts DOES cover env→default (5/5 pass), partially substituting.
    recommended_action: >
      Either add default-workspace.test.ts per the T4.1 TDD block, or amend T4.1 to
      record that its D7 assertion is satisfied by principal-resolution.test.ts's
      env→default case (avoid a phantom-declared test in a shipped task).

  - id: F-xval-5
    severity: LOW
    file: packages/api/src/server/handlers/_body-parsing.ts:32
    plan_ref: D3 / D4 (workspace from Principal; compile-required no-silent-leak)
    summary: >
      workspaceBoundMemory falls back to the unbound `memory` when
      `memory.withWorkspace === undefined`. This is the documented escape for bare test
      harnesses, and the production createLocalMemory always provides withWorkspace, so
      no real leak — but it is a runtime pass-through that softens D4's "forgetting the
      workspace is a compile error" guarantee at this seam (the type is Memory, whose
      withWorkspace is optional). Defensive, not a defect, but worth a note: the
      compile-time guarantee lives in ScopedFilters at the store layer, not at this
      handler seam.
    evidence: |
      _body-parsing.ts:32 `return memory.withWorkspace !== undefined ? memory.withWorkspace(workspaceId) : memory;`
    recommended_action: >
      Optional: make withWorkspace required on the Memory contract once T4.1's breaking
      removal lands, eliminating the optional-chaining pass-through. No action required
      this slice (D2 additive-then-breaking window justifies the optionality).

  - id: F-xval-6
    severity: INFO
    file: tests/integration/p0-audit/full-public-surface.test.ts
    plan_ref: review brief commit list (8th commit not enumerated)
    summary: >
      HEAD is bd66da1 ("full-public-surface export baseline 41->43, 2nd sentinel"),
      a commit NOT listed in the review brief (brief stopped at 2b6ef8e). It is a
      legitimate sentinel-baseline bump mirroring 0a63b48 for the 2 new barrel exports
      (Principal/Workspace + DEFAULT_WORKSPACE_ID/makeVerifyShim). No scope concern;
      logged for completeness so the review audits the true HEAD.
    evidence: |
      git log -1 → bd66da1; git show bd66da1 --stat → full-public-surface.test.ts +5/-2.
    recommended_action: None — informational reconciliation of the commit range.

coverage_table:
  # task → commit → met? / diverged / deferred
  - task: T0.1 (Principal/Workspace types + AuthVerifier.resolvePrincipal + WorkspaceMismatch)
    commit: 23ce3d1 (+ sentinels 0a63b48, bd66da1)
    status: MET
    note: principal.test.ts 4/4; typecheck 0; barrel exports + JSDoc present; gaps 3,4(partial),5(partial)
  - task: T0.2 (0016 migration + schema parity)
    commit: 2e62265
    status: MET
    note: workspace-migration.test.ts 5/5 + schema-snapshot-parity (17=17=17) green; gaps 1,2,18,23,26; column-half of 21
  - task: T1.1 (ScopedFilters + composeFilters + PgvectorStore insert/search/list)
    commit: 7eeb695
    status: MET_WITH_GAP
    note: store-isolation.test.ts green; gaps 6,7 MET; gap 28 (EC-9 in-memory parity) UNMET (F-xval-2)
  - task: T1.2 (skill-store + recall-cache + eviction threading)
    commit: none
    status: DEFERRED (disclosed in plan blockquote + CHANGELOG)
    note: gaps 8,9,27 + filter-half of 21 deferred to follow-up; matrix not reconciled (F-xval-1)
  - task: T2.1 (ApiKeyAuthVerifier.resolvePrincipal + env→default bridge + middleware)
    commit: db50915
    status: MET
    note: principal-resolution.test.ts 5/5 (active/revoked/expired/unknown/env→default); gaps 10,11,12,22
  - task: T3.1 (handlers derive workspace from Principal; by-id 404; GOAL TEST)
    commit: ea9f2dc
    status: MET_WITH_GAP
    note: GOAL TEST 3/3 green; gaps 13,15,19,25 MET; gaps 14,16,24 claimed-without-test (F-xval-3);
          declared schemas.ts + scope-verifier.ts NOT edited (admin-per-workspace untouched)
  - task: T4.1 (remove insecure override → default workspace; README/CHANGELOG breaking note)
    commit: 2b6ef8e
    status: PARTIAL
    note: D7 behavior shipped in T2.1; README+CHANGELOG done (gaps 17,20); declared
          default-workspace.test.ts MISSING (F-xval-4)

coverage_totals:
  gaps_total: 28
  gaps_met: 21          # 1,2,3,5,6,7,10,11,12,13,15,17,18,19,20,22,23,25,26 + column-half of 21 + 4(resolved across T0.1/T2.1/T4.1)
  gaps_partial: 2       # 21 (column yes / filter deferred), 4 (verify-removal final-phase pending by design D2)
  gaps_deferred: 3      # 8, 9, 27 (T1.2, disclosed)
  gaps_unmet_not_deferred: 2  # 28 (EC-9 in-memory, F-xval-2); 14/16/24-as-tested (F-xval-3, schema pre-exists but untested)
  matrix_claims: "28/28 100%"   # OVERSTATED vs delivered — see F-xval-1
