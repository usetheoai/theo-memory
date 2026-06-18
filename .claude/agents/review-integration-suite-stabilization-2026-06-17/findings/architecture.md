```yaml
agent: review-integration-suite-stabilization-architecture
review_target: bef52f7~1..HEAD for plan integration-suite-stabilization
plan: .claude/knowledge-base/plans/integration-suite-stabilization-plan.md
scope: tests/integration/**, vitest.integration.config.ts, packages/core/src/infrastructure/db/schema.ts, packages/core/src/infrastructure/db/migrations/**, README.md
findings:
  - id: F-arch-1
    severity: MEDIUM
    file: tests/integration/_helpers/reset-shared-db.ts
    line: 1
    plan_ref: ADR D1 ("per-file isolated DB cloned from a migrated template")
    summary: >
      Implementation diverged from ADR D1 — most files now use a shared-DB
      reset (setupFile) instead of a per-file isolated DB — without a documented
      ADR amendment in the plan. The divergence is SOUND but UNDER-DOCUMENTED.
    evidence: |
      Plan ADR D1 decided: "DB-touching integration tests stop using the shared
      `themem` DB and instead create a per-file database cloned from a migrated
      template ... A shared `_helpers/isolated-db.ts` encapsulates the
      admin-connection clone/drop." It explicitly REJECTED the alternative
      "Auto-migrate in each `beforeAll` against the shared DB ... still shares
      one DB, so a destructive op in file X still corrupts file Y".

      The shipped design instead uses `tests/integration/_helpers/reset-shared-db.ts`
      (vitest `setupFiles`) which DROPs+CREATEs the shared `themem` DB from the
      template BEFORE each file, and reserves `createIsolatedDb` for only 2 heavy
      files (`triadic-eviction.test.ts`, `cli-consolidated.test.ts`) + its own
      helper test. The pivot from "per-file isolated DB for all Bucket A files"
      (plan Phase 1 lists ~9 files) to "shared-DB reset for most + isolated DB
      for a few" is recorded only in code comments + the CHANGELOG T0.1 entry
      (which describes the HELPER, not the strategic change). Grep of the plan:
      `reset-shared-db` / `setupFile` / "reset the shared" → NOT in plan. No
      implementation log exists under
      `.claude/knowledge-base/implementations/integration-suite-*`.

      Why it is nonetheless SOUND (not HIGH): the reset runs BEFORE each file (at
      setup-file top level, which vitest awaits before the test module body — see
      the load-bearing comment at reset-shared-db.ts:1-25), with
      `fileParallelism:false` already held. Resetting BEFORE each file closes the
      exact "file X corrupts file Y" hole that D1's rejected alternative left open
      (that alternative auto-migrated, did not RESET, and shared concurrently).
      Determinism intent of D1 IS preserved: every file starts from a byte-identical
      template clone. The KISS rationale (keeps THEOMEM_PG_URI stable, avoids
      rewiring every file's connection string) is legitimate.
    recommended_action: >
      Add a short ADR amendment (D1-a) to the plan — or an implementation log —
      stating: "D1 implemented via per-file shared-DB RESET (setupFile) for the
      bulk of files + createIsolatedDb for heavy/state-sensitive files; the reset
      runs BEFORE each file so the rejected-alternative's corruption hole does not
      apply." One paragraph closes the Inquebrável-Rule-3 honesty gap between the
      locked ADR and the shipped code. No code change required.

  - id: F-arch-2
    severity: INFO
    file: tests/integration/global-setup.ts
    line: 80
    plan_ref: T0.1 Deep Dives — "Clone connections"
    summary: Template-build correctness — no open connections at clone time — is correctly handled.
    evidence: |
      `setup()` builds the template via `recreateDatabase` then opens a dedicated
      `templatePool` (max:2), applies migrations, and `await templatePool.end()`
      in a `finally` (global-setup.ts:90-95) BEFORE returning. The clone-time
      invariant ("CREATE DATABASE … TEMPLATE fails if the template has open
      connections", Drawbacks table row 1) is satisfied: the builder pool is
      closed before any test runs. reset-shared-db.ts additionally `pg_terminate_backend`s
      stray prior-file connections and uses `DROP ... WITH (FORCE)` to win the
      reconnect race (reset-shared-db.ts:41-52). This is the correct,
      defense-in-depth handling of the documented failure mode.
    recommended_action: None — clean.

  - id: F-arch-3
    severity: INFO
    file: packages/core/src/infrastructure/db/schema.ts
    line: 194
    plan_ref: Bucket B regression fix (migration 0015) / D4 (no runMigrations contract change)
    summary: >
      Product fix (schema CHECK NULL-hole + migration 0015) stays correctly in the
      db-infrastructure layer; no src/** layering/DIP boundary crossed by test-infra.
    evidence: |
      The only product change is the `memories_kind_derived_from_check`
      NULL-hole fix: schema.ts adds the explicit `derived_from IS NOT NULL`
      guard to the `derived` branch (a real bug — `jsonb_array_length(NULL) >= 1`
      is NULL, and Postgres admits a CHECK that evaluates NULL), plus a new
      migration 0015 + drizzle meta parity (3 previously-missing snapshots
      0011/0013/0014 backfilled; _journal.json gains idx 15). This is a genuine
      Bucket B reorg/parity regression fix, lands in its existing layer
      (`packages/core/src/infrastructure/db/`), and does NOT touch the
      `runMigrations` signature (D4 honored). The schema CHECK and the migration
      SQL match byte-for-byte. No `tests/integration/**` symbol is imported by
      any `packages/core/src/**` file (grep hits are comment-only cross-refs).
      migrations/meta snapshot count == journal count == 16.
    recommended_action: None — clean. Layer discipline preserved.

  - id: F-arch-4
    severity: LOW
    file: tests/integration/forgetting/triadic-eviction.test.ts
    line: 73
    plan_ref: Phase 4 / "no assertion weakened merely to pass"
    summary: >
      The v0.4b GOAL TEST now DROPs the HNSW index to measure recall@10 by exact
      cosine scan. Behaviour of a GOAL TEST changed; rationale is sound and
      honest, but it is a test-semantics change worth flagging.
    evidence: |
      `await pool.query('DROP INDEX IF EXISTS memories_embedding_hnsw_idx')` is
      added before the store is constructed, so recall@10 is measured by an EXACT
      sequential cosine scan rather than pgvector's APPROXIMATE HNSW graph walk.
      The 27-line comment (triadic-eviction.test.ts:60-86) justifies it
      precisely: the fixture seeds orthogonal one-hot vectors (a synthetic
      worst-case where HNSW's greedy walk never reaches the isolated rare
      targets, collapsing recall to ~0.02-0.1), the production HNSW path is still
      exercised by the v0.1 + distillation GOAL tests, and test 2 independently
      confirms the eviction SELECTION. This is a legitimate removal of an
      approximation confound, not assertion-weakening (the recall@10 ≥ 0.70 bar
      is unchanged). Honest per Inquebrável Rule 3.
    recommended_action: >
      No change required for this slice. OPTIONAL follow-up: surface this in the
      plan's Phase 4 "If Validation Fails" log or the v0.4b plan as a known
      test-fixture caveat, so a future reader does not mistake the index-drop for
      a hidden product-path regression. The in-code comment already carries the
      full rationale, so this is advisory only.

  - id: F-arch-5
    severity: INFO
    file: vitest.integration.config.ts
    line: 18
    plan_ref: Baseline Context — invariants to preserve (THEOMEM_PG_URI skip-gate; fileParallelism:false; aliases keep resolving)
    summary: Config invariants preserved; new setupFile + src-aliases are consistent with the reset-shared-db design.
    evidence: |
      `fileParallelism:false` (line 68) and the `THEOMEM_PG_URI` skip-gate are
      intact. `setupFiles: ['tests/integration/_helpers/reset-shared-db.ts']`
      (line 58) is added — correctly a setupFile (per-file), not a globalSetup.
      The added `@usetheo/memory/*` → src aliases (lines 40-50, ordered
      subpath-before-base so exact match wins) keep the live-src resolution that
      the publish-topology reorg required, so the suite exercises source not a
      stale dist — architecturally consistent. No `any`, no console.log in the
      test-infra files; ES modules + `node:` prefixes used throughout
      (global-setup.ts:17-19). Naming is kebab-case files / camelCase fns /
      UPPER_SNAKE TEMPLATE_DB constant — conforms to architecture.md §6.
    recommended_action: None — clean.
```
