# ADR-0018: Large-table index builds run `CREATE INDEX CONCURRENTLY` out-of-band, not inside a migration

- **Status:** Accepted
- **Date:** 2026-06-23
- **Plan:** [`migration-concurrently-index-runbook-plan.md`](../plans/migration-concurrently-index-runbook-plan.md) (M4)
- **Owner:** TheMemory `migration-concurrently-index-runbook` cycle
- **Source:** `skills-subject-prefix-index` (M2) `/review` finding F-dom-db-4 (MEDIUM) — spun off to roadmap M4
- **Governs:** [`architecture.md § 10.4`](../../rules/architecture.md) + the guard `tests/integration/migration-no-concurrently.test.ts`

## Context

Every partial-index migration in the repo (`0005`, `0008`, `0009`, `0021`) is a plain `CREATE INDEX IF NOT EXISTS`. A plain `CREATE INDEX` takes a `SHARE` lock on the table, blocking concurrent writes for the full build duration. On a small/fresh table (current pre-release scale, CI `ankane/pgvector:v0.5.1`) this is trivial; on a large, write-hot production `memories` table (post-TheoCloud-GA) it is a deploy-time write stall.

`CREATE INDEX CONCURRENTLY` builds without the write lock — but Postgres **forbids it inside a transaction block**. And (verified in source, `drizzle-orm@0.45.2/pg-core/dialect.cjs` `PgDialect.migrate`) Drizzle's `migrate()` runs **ALL pending migrations inside ONE `session.transaction(...)`**. There is no per-migration no-transaction marker in this Drizzle version (unlike node-pg-migrate's `disableTransaction` or Rails' `disable_ddl_transaction!`). Therefore a `CREATE INDEX CONCURRENTLY` placed in a migration file would crash `runMigrations()` at deploy with SQLSTATE `25001` ("CREATE INDEX CONCURRENTLY cannot run inside a transaction block").

The M2 `/review` accepted the plain-`CREATE INDEX` status quo with a caveat (it is a pre-existing, project-wide property — not a regression of any single migration; do NOT special-case `0021`) and required this ADR + runbook before the cross-repo skills list (or any index) is on a hot path at GA scale.

## Decision

1. **Mechanism = out-of-band, not in-migrate.** Large-table index builds run `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` OUT-OF-BAND (a direct autocommit connection — `psql` or a dedicated ops script), BEFORE deploying the app that runs `runMigrations()`. The index migration file stays a plain `CREATE INDEX IF NOT EXISTS` (correct + sufficient for fresh/dev DBs). Because the index already exists from the out-of-band step, the migration's `CREATE INDEX IF NOT EXISTS` is a metadata no-op at deploy and the Drizzle journal stays consistent. Procedure documented in [`architecture.md § 10.4`](../../rules/architecture.md). **Invariant (operator footgun guard):** the out-of-band index NAME and DEFINITION (columns, opclass, partial `WHERE`, method) MUST be byte-identical to the migration's `CREATE INDEX` — `IF NOT EXISTS` matches on name only, so a name mismatch reintroduces the blocking build and a same-name-different-definition build silently ships the wrong index. Run it on every primary (multi-region) before that environment's deploy.

2. **Enforce with a guard.** `tests/integration/migration-no-concurrently.test.ts` fails if any journal-applied `migrations/*.sql` contains `CREATE INDEX CONCURRENTLY` — catching the deploy-crash footgun at test time, before production. The natural-but-wrong instinct (after reading "use CONCURRENTLY for big tables") is to put CONCURRENTLY in the migration file; the guard turns that into a RED build.

No change to any existing migration, to `runMigrations()`, or to the public API. The in-transaction discipline for ordinary (small) migrations is unchanged — plain `CREATE INDEX` remains allowed and correct.

## Alternatives considered

- **Switch the migration tool to one with a no-transaction mode** (node-pg-migrate `disableTransaction`, or a custom runner). Rejected — re-tooling the entire migration layer for one edge case the project does not yet hit (pre-release scale) is a large blast radius (YAGNI). The out-of-band step + the established § 10.3 psql side-channel precedent already give a correct path.
- **Fork/patch Drizzle's `migrate()` to run a flagged file outside the transaction.** Rejected — maintaining a patched migrator is a standing liability and there is no upstream marker to rely on in 0.45.2.
- **Accept blocking `CREATE INDEX` forever (status quo, undocumented).** Rejected — fine today but a known deploy-stall landmine at GA scale; leaving it undocumented AND unguarded is the actual defect M4 closes.
- **Special-case migration `0021` to CONCURRENTLY now.** Rejected — it would diverge `0021` from the `0005/0008/0009` precedent for zero benefit at current scale, and CONCURRENTLY cannot live in the migration file anyway (see Decision).

## Consequences

- **Positive:** the deploy-crash footgun is impossible to merge (guard); the GA-scale index-build procedure is documented + repeatable; the in-tx discipline for small migrations is preserved; zero code/migration churn.
- **Negative / honest disclosure:** the runbook is an ops PROCEDURE, not full automation — a hurried operator could still ship a plain `CREATE INDEX` migration against a large table and stall writes (the guard prevents the WORSE CONCURRENTLY-in-migrate crash, not the lesser plain-build stall). Full automation (a CI lint keyed on table size, or migrating to a no-tx-capable runner) is a larger follow-up, deferred until GA scale justifies it.
- **Recovery:** a failed `CREATE INDEX CONCURRENTLY` leaves an `indisvalid=false` index that still consumes writes; the runbook's recovery is `DROP INDEX CONCURRENTLY IF EXISTS <name>` then retry.

## Reference

- Verified source: `drizzle-orm@0.45.2/pg-core/dialect.cjs` `PgDialect.migrate` (single `session.transaction`).
- Precedent: `architecture.md § 10.3` (out-of-band trigger/function side-channel via `apply-trigger-migrations.mjs`).
- Guard: `tests/integration/migration-no-concurrently.test.ts`.
- External shape: GitLab DB migration style guide + Rails `strong_migrations` (CONCURRENTLY out-of-transaction for large tables).
