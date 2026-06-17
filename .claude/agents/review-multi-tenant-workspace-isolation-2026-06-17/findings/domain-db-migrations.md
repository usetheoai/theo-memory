agent: review-multi-tenant-workspace-isolation-domain-db-migrations
review_target: 23ce3d1~1..HEAD for plan multi-tenant-workspace-isolation
domain: db-migrations
domain_specific_patterns_checked:
  - "EC-3 non-destructive single->multi-tenant migration (add-column / backfill / NOT NULL ordering + atomicity)"
  - "EC-6/EC-7 stable 'default' workspace id + idempotent ON CONFLICT seed"
  - "Seed-before-FK ordering (existing keys backfilled to 'default' have a valid parent)"
  - "EC-12 dedup unique index recreated with workspace_id LEADING == ON CONFLICT target (column order + COALESCE)"
  - "Drizzle parity: 17 SQL = 17 snapshots = 17 journal entries; schema.ts <-> meta/0016_snapshot.json"
  - "Migration idempotency (IF NOT EXISTS / ON CONFLICT DO NOTHING / DO-block-FK guard)"
  - "(workspace_id, scope) hot-path indexes match composeFilters workspace_id-first composition"
  - "Hand-edited-vs-generated snapshot fidelity (does index/column drift bite drizzle-kit generate/push)"

findings:

  - id: F-dom-db-1
    severity: HIGH
    file: packages/core/src/infrastructure/db/migrations/meta/0016_snapshot.json
    line: "memories.indexes.memories_hash_scope_unique_idx"
    plan_ref: ADR D5 (drizzle schema.ts + meta snapshots must stay in parity) + EC-12 (dedup index workspace_id-leading)
    domain_anchor: architecture.md § 10.2 (drizzle-kit push vs runMigrations) + schema-snapshot-parity sentinel
    summary: >
      The 0016 meta snapshot DRIFTED from schema.ts on the dedup unique index. schema.ts
      declares memories_hash_scope_unique_idx leading with workspace_id (diff +table.workspaceId),
      and the 0016 SQL recreates the live index leading with workspace_id (verified live: the
      themem_template DB index IS workspace_id-first). But meta/0016_snapshot.json still records
      the OLD 0011 four-column form [hash, COALESCE(user_id,''), COALESCE(session_id,''),
      COALESCE(agent_id,'')] WITHOUT workspace_id. The snapshot is the diff-baseline drizzle-kit
      uses for the NEXT generate, so it is now a stale (wrong) representation of schema.ts.
    evidence: |
      schema.ts (diff): uniqueIndex('memories_hash_scope_unique_idx').on(
        table.workspaceId, table.hash, sql`COALESCE(...userId...)`, ...session..., ...agent...)
      0016 SQL (line 54-55): CREATE UNIQUE INDEX ... ON "memories"
        ("workspace_id","hash", COALESCE("user_id",''), COALESCE("session_id",''), COALESCE("agent_id",''))
      Live themem_template:
        CREATE UNIQUE INDEX memories_hash_scope_unique_idx ON public.memories USING btree
          (workspace_id, hash, COALESCE(user_id,''::text), COALESCE(session_id,''::text), COALESCE(agent_id,''::text))
      0016_snapshot.json (memories.indexes.memories_hash_scope_unique_idx.columns):
        [ {"expression":"hash"}, {"expression":"COALESCE(\"user_id\", '')"},
          {"expression":"COALESCE(\"session_id\", '')"}, {"expression":"COALESCE(\"agent_id\", '')"} ]
        --> workspace_id ABSENT (still the 0011 shape)
      EMPIRICAL BITE PROOF — ran `drizzle-kit generate` against a clone of the real meta/ dir;
      it emitted a SPURIOUS 0017 migration:
        DROP INDEX "memories_hash_scope_unique_idx";--> statement-breakpoint
        CREATE UNIQUE INDEX "memories_hash_scope_unique_idx" ON "memories" USING btree
          ("workspace_id","hash",COALESCE("user_id", ''),COALESCE("session_id", ''),COALESCE("agent_id", ''));
      This confirms the snapshot does not match schema.ts. The next developer running
      `npm run db:generate` gets a phantom migration; a future REAL migration's diff baseline
      is computed from a wrong snapshot. NOTE: production (`runMigrations` -> drizzle `migrate()`)
      reads SQL files + journal, NOT snapshots, so PRODUCTION RUNTIME IS UNAFFECTED. The hazard is
      the dev `drizzle-kit generate`/`push` workflow + snapshot integrity for the next slice.
    recommended_action: >
      Regenerate the 0016 snapshot from schema.ts so the dedup index records workspace_id-leading
      (do NOT hand-stitch columns into the snapshot — let drizzle-kit own the snapshot). One safe
      path: temporarily remove the manual seed/index lines drizzle cannot model, run
      `drizzle-kit generate` to get a faithful 0016 snapshot for the index/column changes, then
      re-apply the hand-edited seed + (workspace_id, scope) indexes to the .sql ONLY. Re-run the
      `drizzle-kit generate` probe and confirm it produces NO spurious migration. The schema-snapshot
      parity sentinel only checks table NAMES (proven below in F-dom-db-2) so it will not catch this.

  - id: F-dom-db-2
    severity: MEDIUM
    file: tests/integration/schema-snapshot-parity.test.ts
    line: "collectSnapshotTables / collectSchemaTables (table-name-only comparison)"
    plan_ref: ADR D5 (schema-snapshot-parity.test.ts as the parity guard) + Drawbacks row "Drizzle schema/meta parity drift"
    domain_anchor: architecture.md § 10.2
    summary: >
      The parity guard the plan relies on to catch snapshot drift only compares the SET of table
      NAMES between schema.ts and the snapshots. It does NOT compare columns or index expressions.
      That is exactly why F-dom-db-1 (index drift) passed undetected with 10/10 green. The plan's
      Drawbacks table claims "schema-snapshot-parity.test.ts + journal-sync.test.ts re-run; meta
      snapshot generated, not hand-edited" mitigates parity drift — but the test cannot detect
      column/index drift and the snapshot WAS effectively hand-edited (columns added, the index
      `on()` change NOT regenerated). The mitigation is weaker than the plan asserts.
    evidence: |
      schema-snapshot-parity.test.ts comment: "verifies every pgTable DECLARED in schema.ts has a
      snapshot and vice-versa" — comparison is `Set<tableName>` only.
      Confirmed: ran the 3 migration/parity tests against real pgvector -> 3 files / 10 tests PASS,
      while drizzle-kit generate simultaneously proves a real index drift exists. The green suite
      gives false confidence on index/column parity.
    recommended_action: >
      Either (a) fix F-dom-db-1 so the snapshot is faithful (then the gap is latent, not active),
      and/or (b) add a column/index-level parity assertion OR a CI step that runs
      `drizzle-kit generate --name __drift_probe__` into a temp dir and fails if any new SQL is
      produced (the deterministic "snapshot == schema.ts" check). The latter would have caught this
      automatically. Track as a follow-up if out of slice scope.

  - id: F-dom-db-3
    severity: LOW
    file: packages/core/src/infrastructure/db/migrations/0016_workspaces.sql
    line: 9-12, 31-37
    plan_ref: ADR D5 (single atomic BEGIN/COMMIT; add-nullable -> backfill -> SET NOT NULL) + EC-3
    domain_anchor: architecture.md § 10 (migration discipline)
    summary: >
      The migration DIVERGES from the plan's literal D5 recipe in two ways, both DEFENSIBLE but
      undocumented as deliberate deviations. (1) D5 specified add-NULLABLE -> UPDATE backfill ->
      SET NOT NULL; the implementation instead uses `ADD COLUMN workspace_id text DEFAULT 'default'
      NOT NULL` directly. This IS safe on existing rows (PG 11+ applies a constant default as a
      metadata-only operation; existing rows read 'default' without a table rewrite) and the
      migration test asserts a no-workspace_id INSERT backfills to 'default' — so the outcome is
      correct. (2) D5/EC-3 specified an explicit `BEGIN/COMMIT` in the SQL; the file has none.
      Atomicity is instead provided by drizzle's `migrate()`, which wraps each migration file's
      statements in a single transaction. The header comment claims EC-3 atomicity "no separate
      backfill UPDATE + no SET NOT NULL race" but does not state that the BEGIN/COMMIT requirement
      is delegated to the runner rather than the SQL.
    evidence: |
      0016 SQL line 31-37: ALTER TABLE "..." ADD COLUMN IF NOT EXISTS "workspace_id" text
        DEFAULT 'default' NOT NULL;  (no nullable->backfill->NOT NULL sequence)
      No BEGIN/COMMIT in the file. drizzle-orm/node-postgres migrator wraps each migration file
      transactionally, so EC-3 atomicity holds at the runner layer.
      Plan ADR D5: "wrapped in a single BEGIN/COMMIT (EC-3 absorption) ... (3) ADD COLUMN
      workspace_id NULLABLE ... (4) backfill unconditionally UPDATE ... (5) ALTER COLUMN SET NOT NULL".
    recommended_action: >
      No functional change needed (outcome is correct + atomic). For honesty/traceability
      (Inquebravel Rule 3), add ONE line to the SQL header noting the deliberate deviation: the
      DEFAULT-NOT-NULL single-statement form supersedes the plan's 3-step add-nullable recipe
      (PG11+ metadata default makes it non-blocking + race-free), and EC-3 transactionality is
      provided by drizzle's per-file migration transaction rather than an in-file BEGIN/COMMIT.
      This prevents a future reviewer flagging it as a missed plan step.

  - id: F-dom-db-4
    severity: LOW
    file: packages/core/src/infrastructure/db/pgvector-store.ts
    line: 171-174
    plan_ref: ADR D4 (compile-time-required workspaceId; composeFilters(undefined) is the silent-leak hole)
    domain_anchor: architecture.md § 8 (fail-fast)
    summary: >
      composeFilters(undefined) STILL returns an empty (workspace-unscoped) WHERE clause. D4's
      defense is the compile-time `ScopedFilters` required-field type on the REST path, which is the
      right primary guard, but the runtime function retains the unscoped branch for any non-typed
      caller (in-memory/unit path, or a future caller that bypasses ScopedFilters). This is a
      latent footgun rather than an active leak (the goal-test IDOR matrix is green), but the
      branch is the exact hole D4 set out to close and it survives at runtime.
    evidence: |
      pgvector-store.ts:171-174
        function composeFilters(filters: Filters | undefined, startParamIndex: number): FilterClause {
          if (filters === undefined) {
            return { sql: '', params: [], nextParamIndex: startParamIndex };  // unscoped
          }
    recommended_action: >
      Primarily a memory-layer/wiring concern (defer to those reviewers). From the migration/index
      angle: the (workspace_id, scope) indexes assume every production query carries the workspace
      clause; a composeFilters(undefined) call would do a full unscoped scan AND leak. Consider a
      runtime assertion on the REST-constructed path (belt-and-suspenders to the compile guard) OR
      document that the undefined branch is unit/in-memory-only and unreachable from any pooled-pg
      query path.

  - id: F-dom-db-5
    severity: INFO
    file: packages/core/src/infrastructure/db/migrations/0016_workspaces.sql
    line: 23-46
    plan_ref: EC-6/EC-7 (stable id + idempotent seed), seed-before-FK ordering
    domain_anchor: architecture.md § 10
    summary: >
      POSITIVE confirmation. The migration's statement ORDER is correct and idempotent: (1) CREATE
      TABLE workspaces IF NOT EXISTS; (2) INSERT 'default' ON CONFLICT (id) DO NOTHING (seeded
      BEFORE the FK, so existing theo_api_keys backfilled to 'default' have a valid parent);
      (3) ADD COLUMN ... DEFAULT 'default' NOT NULL on all 6 data tables + theo_api_keys;
      (4) theo_api_keys -> workspaces FK wrapped in a DO-block catching duplicate_object;
      (5) (workspace_id, scope) indexes + the EC-12 dedup index recreation. Re-running the SQL on
      the live template is a clean no-op (verified: INSERT 0 0, ALTER/DROP/CREATE all guarded).
      The 4 hot-path indexes (memories_workspace_{user,session,agent}_idx,
      recall_cache_workspace_scope_idx) exist live and compose-first matches composeFilters
      ordering (workspace_id leads the WHERE at pgvector-store.ts:182). EC-12 ON CONFLICT target at
      pgvector-store.ts:430 matches the recreated index EXACTLY (workspace_id, hash, COALESCE x3).
    evidence: |
      Live themem_template: workspaces_pkey + memories_workspace_user_idx +
        memories_workspace_session_idx + memories_workspace_agent_idx + recall_cache_workspace_scope_idx present.
      Re-apply test: CREATE TABLE / INSERT 0 0 / ALTER TABLE / DROP INDEX / CREATE INDEX -> "RE-APPLY OK".
      ON CONFLICT (pgvector-store.ts:430) == recreated index (0016 SQL:54-55) == live index def. Exact match.
      17 SQL = 17 snapshots = 17 journal entries; snapshot prevId chain 0015->0016 intact.
    recommended_action: No action. Recorded as positive evidence that EC-3/6/7/12 + ordering + idempotency are correctly implemented at the SQL + runtime layer.

summary_counts:
  HIGH: 1
  MEDIUM: 1
  LOW: 2
  INFO: 1
  total: 5

most_important_finding: >
  F-dom-db-1 (HIGH): meta/0016_snapshot.json drifted from schema.ts on the dedup unique index —
  the snapshot still records the pre-workspace 4-column form while schema.ts + the live DB lead
  with workspace_id. Proven by running drizzle-kit generate, which emits a spurious 0017
  DROP+CREATE of the index. Production runtime (runMigrations->migrate() reads SQL+journal) is
  UNAFFECTED, but the dev db:generate/db:push workflow and the next migration's diff baseline are
  now wrong, and F-dom-db-2 shows the schema-snapshot-parity sentinel cannot catch it (table-name-only).
