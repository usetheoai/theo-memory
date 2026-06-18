# Test Review — multi-tenant-workspace-isolation

```yaml
agent: review-multi-tenant-workspace-isolation-tests
review_target: 23ce3d1~1..HEAD for plan multi-tenant-workspace-isolation
plan: .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md
test_pyramid:
  unit_added: 1          # packages/core/src/domain/principal.test.ts (4 cases)
  type_d_modified: 2     # auth-verifier.test-d.ts, memory-store.test-d.ts (conscious-surface updates)
  integration_added: 4   # workspace-migration, store-isolation, principal-resolution, workspace-isolation (GOAL)
  e2e_added: 0
  unit_modified: 2       # pgvector-store.test.ts, schema.test.ts (conscious-surface updates)
  total_new: 5
  pyramid_balance: acceptable_for_security_slice  # isolation is a persistence property → integration-heavy is correct
edge_cases_from_plan:
  covered:
    - "EC-1 every-table-denormalized workspace_id NOT NULL (workspace-migration.test.ts, all 6 tables)"
    - "EC-2 revoked key -> null (principal-resolution.test.ts)"
    - "EC-2 expired key -> null (principal-resolution.test.ts)"
    - "EC-3 column-default backfill to 'default' (workspace-migration.test.ts)"
    - "EC-5 cross-workspace forget rejects + ws-A row untouched (workspace-isolation.test.ts, via Memory seam)"
    - "EC-6 stable 'default' id literal (workspace-migration.test.ts + principal.test.ts)"
    - "EC-7 FK + idempotent seed (workspace-migration.test.ts FK assertion; ON CONFLICT in 0016)"
    - "EC-9 in-memory/store parity workspace filter (store-isolation.test.ts at PgvectorStore layer)"
    - "EC-12 same fact two workspaces = two rows, no cross-bump (store-isolation.test.ts)"
  missing:
    - "EC-4 body workspaceId -> 400 unrecognized_keys: NO test asserts this (plan T3.1 TDD explicitly claims it)"
    - "EC-5/D6 404 at the HTTP layer: GOAL TEST stops at Memory.forget() rejecting MemoryNotFound; handler 404 Response untested"
    - "D3 Principal injection end-to-end via HTTP middleware: untested in this slug"
  honestly_deferred:
    - "EC-8 recall-cache cross-workspace MISS (T1.2 deferred; CHANGELOG discloses; no test falsely claims it)"

findings:
  - id: F-tests-1
    severity: HIGH
    file: tests/integration/auth/workspace-isolation.test.ts
    line: 65-124
    plan_ref: T3.1 TDD lines 498-500 ("a body `workspaceId` field -> 400 `unrecognized_keys` via the existing `.strict()` schema (EC-4)")
    summary: >
      EC-4 (body `workspaceId` rejected with 400, not silently dropped) is claimed by the
      GOAL TEST's TDD section AND by the edge-case report's explicit "Add a test asserting
      the 400", but NO test asserts it anywhere. The GOAL TEST exercises the
      `Memory.withWorkspace` seam, which never parses an HTTP body, so the `.strict()`
      protection (schemas.ts:62/74/82/90) is structurally unreachable from this test.
    evidence: |
      grep for a body-workspaceId rejection test across tests/ and packages/api → 0 matches:
        $ grep -rn "workspaceId" tests/ | grep -i "400|strict|unrecognized|reject|body"  → (none)
      Only tests/integration/workspace/principal-resolution.test.ts references `workspaceId`,
      and there it is a Principal property, not a rejected body field.
      The .strict() mechanism exists (schemas.ts:62,74,82,90) but is never asserted.
      Coverage Matrix row 24 ("EC-4 body workspaceId -> 400") is therefore unverified by any test.
    recommended_action: >
      Add an HTTP-level test against createApp that POSTs /v1/remember with a body containing
      `workspaceId` and asserts a 400 (unrecognized_keys). This is the single line the
      edge-case report explicitly asked for and the only assertion that proves the field is
      REJECTED (explicit) rather than silently dropped (the exact failure EC-4 names).

  - id: F-tests-2
    severity: HIGH
    file: tests/integration/auth/workspace-isolation.test.ts
    line: 41-55
    plan_ref: Goal line 15 + T3.1 ("asserts cross-workspace GET/forget/recall return 404/empty"); Coverage Matrix rows 13,15,19
    summary: >
      THE GOAL TEST proves isolation only through the `Memory.withWorkspace(...)` seam (what
      handlers call internally) — it never drives an actual HTTP request through the
      handlers + the Principal-injecting middleware. The plan's Goal is phrased at the REST
      level ("cross-workspace GET/forget/recall return 404/empty"), but the handler 404
      Response (forget.ts:43-45), the middleware Principal injection (middleware.ts:95-103),
      and `workspaceBoundMemory(c, memory)` (_body-parsing.ts) are exercised only by the
      pre-existing auth tests, none of which were extended to assert the workspace path.
    evidence: |
      workspace-isolation.test.ts uses `base.withWorkspace!('ws-a')` directly (line 67) and
      `wsB.forget(wsAId)` rejecting MemoryNotFound (line 104) — never `app.request(...)`.
      Existing HTTP harness tests exist and spin up createApp:
        tests/integration/auth/lifecycle.test.ts, fixes-cycle-1-e2e.test.ts, env-activation.test.ts
      but the slug diff touches NONE of them:
        $ git diff --stat 23ce3d1~1..HEAD -- 'tests/integration/auth/**'  → only workspace-isolation.test.ts (new)
      So the production code that maps the Memory-seam outcome to an HTTP 404/empty/Principal
      is real but has zero new end-to-end coverage. A regression in middleware Principal
      injection or the forget catch-block would NOT be caught by this suite.
    recommended_action: >
      Add (or extend lifecycle.test.ts with) an HTTP-level case: seed two workspaces' keys,
      issue real fetch requests with each Bearer key, assert ws-B recall→200 [], ws-B
      forget(ws-A id)→404, and ws-A row stays alive. This closes the seam-vs-handler gap and
      makes the Goal's REST-level wording actually proven.

  - id: F-tests-3
    severity: LOW
    file: tests/integration/auth/workspace-isolation.test.ts
    line: 25-32, 50-54
    plan_ref: testing.md § Determinism + T3.1 GOAL TEST
    summary: >
      Using DeterministicStubEmbedder + `{ infer: false }` to make recall deterministic is a
      SOUND choice, NOT a weakening. `{ infer: false }` writes the text verbatim (bypassing
      the non-deterministic LLM extraction), and the stub embedder yields a stable vector, so
      the isolation assertion (ws-B sees 0 rows, ws-A sees >=1) is decoupled from
      embedding/LLM noise — exactly what testing.md § Determinism mandates. The isolation
      property under test (workspace filter) is orthogonal to retrieval quality, so removing
      retrieval nondeterminism strengthens the security assertion rather than masking it.
    evidence: |
      emptyJsonLlm returns {"facts": []} (line 31) but is bypassed by { infer: false } (line 71).
      recall uses { threshold: 0 } (line 82,86) so the filter, not the score, decides visibility.
      This is the right call: a real embedder would make "ws-B sees 0" pass for the wrong
      reason (low cosine) instead of the right reason (workspace_id filter).
    recommended_action: >
      No action — documented here so the reviewer panel does not mis-flag the stub as a
      shortcut. (Optional: a one-line comment in the test already explains it at line 24-25.)

  - id: F-tests-4
    severity: INFO
    file: packages/core/src/infrastructure/db/pgvector-store.test.ts
    line: 216-222
    plan_ref: EC-12 + ADR D5; pgvector-store.ts:430
    summary: >
      The ON CONFLICT assertion change (4-key -> 5-key tuple leading with workspace_id) is a
      LEGITIMATE conscious-surface update, not a masking edit. The source actually changed:
      pgvector-store.ts:430 now reads `ON CONFLICT (workspace_id, hash, COALESCE(user_id...))`.
      The test still asserts the DO UPDATE confirmation_count bump + the (xmax = 0) RETURNING
      projection, so behavior coverage is preserved; only the conflict key tuple grew. The
      EC-12 store-isolation integration test independently proves the runtime consequence
      (two workspaces = two rows, intra-workspace re-remember still bumps to 2).
    evidence: |
      Source: grep -n "ON CONFLICT" pgvector-store.ts → :430 ON CONFLICT (workspace_id, hash, ...)
      store-isolation.test.ts:77-118 proves the behavioral consequence end-to-end.
    recommended_action: No action — verified as a real surface change, properly mirrored.

  - id: F-tests-5
    severity: INFO
    file: tests/integration/p0-audit/exports-contract.test.ts
    line: 71-79
    plan_ref: architecture.md § 9 (public surface); T0.1
    summary: >
      The export-count baseline 41 -> 43 update (also in full-public-surface.test.ts and the
      schema.test.ts column list, the test-d Memory 9->10 keys + AuthVerifier verify->verify|
      resolvePrincipal) are all LEGITIMATE conscious-surface-change updates. Each is paired
      with a real source addition (Principal/Workspace/DEFAULT_WORKSPACE_ID/makeVerifyShim
      exports; workspace_id schema column; withWorkspace Memory method; resolvePrincipal DIP
      method) and each baseline edit carries a documenting comment citing the slug. None
      weakens an assertion to pass — the contract tests still enforce JSDoc-per-export and
      exact-key shape, just at the grown surface.
    evidence: |
      exports-contract baseline 41->43 with comment "conscious public-surface growth ... each
      with a JSDoc + @see block"; the JSDoc-per-export sub-test (test 2) is UNCHANGED and
      still runs against the 43.
      memory-store.test-d.ts: 9->10 keys adds 'withWorkspace' which exists at memory-store.ts:109.
      auth-verifier.test-d.ts: verify->{verify,resolvePrincipal} matches the DIP at auth-verifier.ts.
      schema.test.ts: +workspace_id matches schema.ts + migration 0016.
    recommended_action: No action — all five surface-baseline edits verified as honest.

  - id: F-tests-6
    severity: INFO
    file: CHANGELOG.md
    line: "[Unreleased] Known limitation block"
    plan_ref: T1.2 deferral; EC-8; Inquebravel Rule 3
    summary: >
      EC-8 (recall-cache cross-workspace MISS) deferral is HONESTLY reflected. No test claims
      cache isolation works; the pre-existing cache tests (cache-hit-miss, semantic-recall-
      cache, otel-metrics-observed) were untouched and contain zero workspace references, so
      they make no false isolation claim. The CHANGELOG carries an explicit "Known limitation"
      with a "do NOT enable [cache/skill/eviction] in a multi-workspace deployment" warning.
      This is exemplary honest deferral.
    evidence: |
      git diff --stat 23ce3d1~1..HEAD -- 'tests/integration/cache/**' → (empty)
      grep -rln "workspace" tests/integration/cache/ → (none)
      CHANGELOG "Known limitation (workspace isolation follow-up)": opt-in surfaces "carry the
      workspace_id column but their per-workspace cache-key / scope-WHERE threading is DEFERRED".
    recommended_action: No action — deferral is honest and well-disclosed.

  - id: F-tests-7
    severity: LOW
    file: tests/integration/migrations/workspace-migration.test.ts
    line: 50-99
    plan_ref: T0.2 TDD ("pre-seeds NULL-workspace rows ... asserts the migration backfills then enforces")
    summary: >
      The migration test asserts the POST-migration steady state (workspace_id NOT NULL,
      'default' seeded, FK exists, indexes exist, a no-workspace insert defaults to 'default')
      but does NOT reproduce the legacy-DB scenario the plan's Deep Dive + Failure-scenarios
      table call out: a DB PRE-SEEDED with NULL-workspace rows migrated through
      add-nullable -> backfill -> SET NOT NULL. Because the test runs against the already-
      migrated template clone, the ordering-hazard (SET NOT NULL before backfill = failure,
      flagged High in the plan's Drawbacks table) is never actually exercised against pre-
      existing rows — the very failure mode D5 exists to prevent.
    evidence: |
      Test reads information_schema for the end state (lines 58-99); the "backfills to default"
      case (line 70) inserts a NEW row relying on the COLUMN DEFAULT, which proves the default
      clause, NOT the one-time UPDATE backfill of legacy rows. Plan T0.2 line 290 + Failure-
      scenarios row 1 + Drawbacks "Migration 0016 backfill ordering" all describe seeding
      legacy NULL rows FIRST — that scenario is absent.
    recommended_action: >
      Add a case that, before applying 0016, inserts rows with NULL workspace_id into a fresh
      pre-0016 schema (or simulates it), runs the migration, and asserts the backfill+NOT NULL
      succeeds without error. This is the only assertion that proves the ordering hazard is
      handled; the current test proves the schema shape but not the migration's risky step.

  - id: F-tests-8
    severity: INFO
    file: tests/integration/workspace/*.test.ts
    line: env-gate describe.skip
    plan_ref: Unbreakable Rule 7 (no skipped tests)
    summary: >
      All new integration tests use the project-standard `describe.skip` env-gate (skip when
      THEOMEM_PG_URI is unset) with a placeholder. This is the established pattern across the
      repo, NOT a disabled-test smell, and is correctly paired with a real suite that runs
      when the env var is set. No `.only` / `xit` / unconditional `.skip` leaks were found.
    evidence: |
      grep for .only|xit|xtest|it.skip across the new files → 0 matches.
      The describe.skip is gated on PG_URI absence (the CI runner sets THEOMEM_PG_URI).
    recommended_action: No action — env-gate pattern is correct.
```

## Summary

8 findings: **2 HIGH, 2 LOW, 4 INFO** (no BLOCKER).

**Most important finding (F-tests-1, HIGH):** EC-4 — the plan's GOAL TEST TDD section AND the edge-case report both explicitly require a test asserting a body `workspaceId` → 400 (`unrecognized_keys`), but **no such test exists anywhere**. The `.strict()` protection is in place but unverified; the GOAL TEST exercises the `Memory.withWorkspace` seam which never parses an HTTP body, so EC-4 is structurally unreachable from any current test. Coverage Matrix row 24 is unproven.

**Second (F-tests-2, HIGH):** the GOAL TEST proves isolation only through the `Memory` seam, never through an actual HTTP request + Principal-injecting middleware. The handler 404 Response, middleware `c.set('principal')`, and `workspaceBoundMemory` are real production code with zero new end-to-end coverage; existing `createApp`-based auth tests (lifecycle/fixes-cycle-1-e2e) were not extended.

**Honesty verdict (clean):** every modified assertion (ON CONFLICT 4→5-key, export baseline 41→43, schema column list, Memory test-d 9→10 keys, AuthVerifier test-d) is a legitimate conscious-surface-change update paired with a real source change — no masking edits. EC-8 cache deferral is honestly disclosed (CHANGELOG "Known limitation" + no false test claim). The `DeterministicStubEmbedder` + `{ infer: false }` choice strengthens, not weakens, the GOAL TEST.

**Minor (F-tests-7, LOW):** the migration test asserts the post-migration steady state but never reproduces the legacy-NULL-rows backfill-ordering hazard that ADR D5 exists to prevent.
