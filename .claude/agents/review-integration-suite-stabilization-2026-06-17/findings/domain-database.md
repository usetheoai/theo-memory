---
agent: review-integration-suite-stabilization-domain-database
review_target: bef52f7~1..HEAD for plan integration-suite-stabilization
domain: database
verdict: READY_TO_MERGE (DB-domain scope) — 0 BLOCKER, 0 HIGH; 2 LOW + 2 INFO
domain_specific_patterns_checked:
  - "CREATE DATABASE … TEMPLATE clone correctness (no open connections at clone time)"
  - "DROP DATABASE … WITH (FORCE) race handling (PG 13+)"
  - "admin connection routed to /postgres for DDL"
  - "384-dim runMigrations(pool,{embeddingDim}) path on a freshly-cloned DB"
  - "pgvector CHECK-constraint NULL-hole semantics (jsonb_array_length(NULL) => NULL admits row)"
  - "drizzle journal/meta parity (sql==snapshot count, id/prevId chain, monotonic when[])"
  - "HNSW index drop on isolated clone for exact recall (no production schema impact)"
  - "valid-row seeding vs old-CHECK-hole exploitation"
---

# Domain Review — database — integration-suite-stabilization

## Summary

The DB-domain changes are **sound and empirically verified against the live `ankane/pgvector:v0.5.1` (PG 15) container**. The headline product change — migration `0015` closing the `memories_kind_derived_from_check` NULL-hole — is correct, real (not a test-only hack), and the drizzle journal/meta parity it restores is fully intact. The isolation infrastructure (`CREATE DATABASE … TEMPLATE` clone + `DROP … WITH (FORCE)` reset) is correct and free of connection-leak/clone-race defects in the CI configuration. The HNSW-index-drop fix is confined to the isolated clone and never touches production schema/migrations. The skill-isolation seed change now seeds VALID `derived` rows rather than exploiting the closed hole.

Live verification performed:
- `isolated-db.test.ts` → 3/3 green (clone has late tables; `embeddingDim:384` re-migration yields `atttypmod=384`; `dropDb()` removes the specific DB).
- `skill-isolation` + `schema-snapshot-parity` + `schema-v0-4a-constraints` + `journal-sync` → 12/12 green.
- `triadic-eviction` (HNSW-drop) → 2/2 green; production `memories_embedding_hnsw_idx` confirmed STILL present on the shared `themem` DB.
- Direct probe: `INSERT … kind='derived', derived_from=NULL` is now **REJECTED** by `check_violation` on the live migrated DB (the hole is empirically closed).

Two LOW latent concerns (do not block) + two INFO confirmations below.

findings:

  - id: F-dom-db-1
    severity: LOW
    file: tests/integration/global-setup.ts
    line: 35
    plan_ref: ADR D1 — per-file isolated DB cloned from a migrated template; helper admin connection to /postgres
    domain_anchor: connection-string correctness for DDL admin routing
    summary: >-
      `siblingUri()` (and `adminUriFrom()`) replace the last path segment via
      `/\/[^/]*$/` but a connection string carrying query params
      (`?sslmode=require`, `?application_name=…`) has the params on the LAST
      segment, so they are SILENTLY DROPPED. `siblingUri('…/themem?sslmode=require','postgres')`
      yields `…/postgres` (no `?sslmode=require`). `sharedDbName()` correctly
      strips the query, but the admin/sibling URIs lose it. Does NOT fire in CI
      (URI is param-free `postgresql://themem:themem@localhost:5432/themem`), but
      a TLS-required Postgres would have the admin clone/drop connections fail to
      negotiate SSL while the test pools (built on the unmodified root URI) keep it.
    evidence: |
      ```ts
      function adminUriFrom(uri: string): string {
        return uri.replace(/\/[^/]*$/, '/postgres');  // drops ?query
      }
      export function siblingUri(uri: string, dbName: string): string {
        return uri.replace(/\/[^/]*$/, `/${dbName}`);  // drops ?query
      }
      ```
      Verified: `siblingUri('postgresql://…/themem?sslmode=require','postgres')`
      => `postgresql://…/postgres` (params gone).
    recommended_action: >-
      Preserve the query string when rewriting the db name — split on `?` first
      and re-append, e.g. parse the path segment and reattach `?…` to the sibling
      URI. Low priority (CI is param-free) but worth a one-line fix to avoid a
      future TLS-Postgres footgun. Flag for the implementer; not a merge blocker.

  - id: F-dom-db-2
    severity: LOW
    file: packages/core/src/infrastructure/db/migrations/0015_fix_kind_derived_from_check.sql
    line: 1
    plan_ref: 991efe5 — migration 0015 closes CHECK NULL-hole + restore drizzle meta parity
    domain_anchor: migration idempotency / defensive DROP (cf. 0002 used DROP CONSTRAINT IF EXISTS)
    summary: >-
      0015 uses bare `ALTER TABLE … DROP CONSTRAINT "memories_kind_derived_from_check"`
      (no `IF EXISTS`), whereas its sibling 0002 used `DROP CONSTRAINT IF EXISTS`.
      The constraint is always present in the forward chain (created in 0001/0002),
      so 0015 is correct as applied. But a DB whose constraint was hand-dropped
      out-of-band (or a partial-repair state) would make 0015 hard-fail on a
      missing constraint instead of being self-healing. The project already has a
      `repair-partial-state` discipline, so defensive `IF EXISTS` matches house style.
    evidence: |
      ```sql
      -- 0015 (this change)
      ALTER TABLE "memories" DROP CONSTRAINT "memories_kind_derived_from_check";
      -- 0002 (precedent, defensive)
      ALTER TABLE "memories" DROP CONSTRAINT IF EXISTS "memories_kind_derived_from_check";
      ```
    recommended_action: >-
      Consider `DROP CONSTRAINT IF EXISTS` to match the 0002 precedent and the
      repair-partial-state ethos. Non-blocking — the forward chain is correct and
      the snapshot/journal parity is intact.

  - id: F-dom-db-3
    severity: INFO
    file: packages/core/src/infrastructure/db/migrations/0015_fix_kind_derived_from_check.sql
    line: 2
    plan_ref: 991efe5 — derived branch now requires derived_from IS NOT NULL
    domain_anchor: pgvector/Postgres CHECK three-valued-logic (NULL admits)
    summary: >-
      CONFIRMED CORRECT. The fix adds `derived_from IS NOT NULL` to the `derived`
      branch. Postgres CHECK rejects only on FALSE; `jsonb_array_length(NULL) >= 1`
      evaluates to NULL → whole predicate NULL → row ADMITTED. The old constraint
      thus let `kind='derived', derived_from=NULL` through. Live probe on the
      migrated container confirms the new constraint now raises `check_violation`
      for that row. The `skill` branch correctly retains its `IS NULL OR length>=1`
      tolerance (skills may legitimately have no provenance). schema.ts, the 0015
      migration SQL, and the 0015 meta snapshot CHECK value are byte-identical.
    evidence: |
      Live: `INSERT … kind='derived', derived_from=NULL` => `OK: derived+NULL correctly REJECTED`.
      0014 snapshot CHECK (pre-fix) lacked `IS NOT NULL`; 0015 snapshot CHECK has it; matches schema.ts + 0015.sql.
    recommended_action: None — this is the correct fix; recorded as the load-bearing product change.

  - id: F-dom-db-4
    severity: INFO
    file: packages/core/src/infrastructure/db/migrations/meta/_journal.json
    line: 1
    plan_ref: 991efe5 — restore drizzle meta parity (0011/0013/0014 snapshots)
    domain_anchor: drizzle journal/meta parity (single-head, complete chain)
    summary: >-
      CONFIRMED INTACT. 16 .sql migrations = 16 *_snapshot.json = 16 journal
      entries (idx 0..15). The snapshot id/prevId chain is unbroken
      (0000.prevId=00000000; each subsequent prevId == predecessor.id; 0015.prevId
      =508d0e66 == 0014.id). Journal `when[]` timestamps are strictly monotonic
      and 0015 is the latest (1781556151973 > 0014's 1781001600000). The restored
      0011/0013/0014 snapshots are full bodies (833/1030/1030 lines), not stubs;
      0012 had a 4-line prevId/id repair. The schema-snapshot-parity test correctly
      switched to importing `schema.ts` directly (the public barrel re-exports only
      a memories/entities/history subset), so it now sees ALL declared pgTables —
      a genuine strengthening, not a workaround. journal-sync + parity 12/12 green.
    recommended_action: None — parity is sound. Drizzle-kit generate would be clean.

  - id: F-dom-db-5
    severity: INFO
    file: tests/integration/forgetting/triadic-eviction.test.ts
    line: 89
    plan_ref: ADR D1 + Q1 — heavy GOAL test on isolated DB; exact recall via HNSW drop
    domain_anchor: pgvector HNSW approximation vs exact seq-scan on pathological topology
    summary: >-
      CONFIRMED SOUND. `DROP INDEX IF EXISTS memories_embedding_hnsw_idx` runs on
      the per-file ISOLATED clone (created via createIsolatedDb), never on the
      shared/production DB — verified: production `memories_embedding_hnsw_idx`
      still present on `themem` post-run. The drop forces an EXACT sequential
      cosine scan, removing HNSW's documented approximation error on the synthetic
      one-hot ORTHOGONAL worst-case topology this fixture seeds (the greedy graph
      walk never reaches the isolated rare targets). This measures the actual GOAL
      (triadic eviction preserving the long-tail), not HNSW recall — which is
      separately exercised by v0.1 + distillation GOAL tests on dense vectors.
      Migration 0000 retains the production HNSW index untouched. skill-isolation
      seed of `derived_from='["f-c2-seed-src"]'` for kind='derived' rows is a
      VALID row that satisfies the corrected 0015 constraint (it is NOT exploiting
      the old hole), and the survival assertion (kind filtered, t_invalid null)
      is unchanged.
    recommended_action: None — well-justified and self-documented; the DROP is idempotent and isolated-DB-scoped.
