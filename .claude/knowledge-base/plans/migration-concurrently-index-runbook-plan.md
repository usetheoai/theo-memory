---
slug: migration-concurrently-index-runbook
milestone_id: M4
created_at: 2026-06-23
goal: Close the M2 /review MEDIUM (CREATE INDEX vs CONCURRENTLY) with a decision + runbook + automated guard — record an ADR that drizzle-orm 0.45.2 migrate() wraps all migrations in ONE transaction (so CREATE INDEX CONCURRENTLY can never run in a migration file), document the out-of-band CONCURRENTLY-before-deploy procedure as architecture.md § 10.4, and ship a guard test that FAILS if any migrate()-applied migration .sql contains CONCURRENTLY (which would crash the single-tx migrate at deploy), measured by tests/integration/migration-no-concurrently.test.ts green on the clean tree and red when CONCURRENTLY is injected.
---

# Plan: migration-concurrently-index-runbook (M4)

> Closes the MEDIUM finding (F-dom-db-4) from the M2 (`skills-subject-prefix-index`) `/review`: every partial-index migration (`0005`, `0008`, `0009`, `0021`) is a plain in-transaction `CREATE INDEX`, which takes a SHARE lock that blocks writes for the build duration. On a large write-hot production `memories` table this is a deploy-time write stall. `CREATE INDEX CONCURRENTLY` avoids the lock but CANNOT run inside a transaction — and (verified) drizzle-orm 0.45.2 `migrate()` runs ALL pending migrations inside ONE `session.transaction(...)`. This milestone records the decision (ADR), documents the out-of-band runbook (architecture.md § 10.4), and adds an automated guard so a future migration cannot smuggle `CONCURRENTLY` into a migrate()-applied `.sql` (which would crash `migrate()` at deploy with PG error 25001).

## Goal

> "Close the M2 CONCURRENTLY MEDIUM with a decision + runbook + guard: an ADR recording that drizzle-orm 0.45.2 `migrate()` is single-transaction (so `CREATE INDEX CONCURRENTLY` cannot live in a migration file) + a `architecture.md § 10.4` runbook for the out-of-band CONCURRENTLY-before-deploy procedure + a guard test `tests/integration/migration-no-concurrently.test.ts` that is GREEN on the current tree and RED when `CREATE INDEX CONCURRENTLY` is injected into any `migrations/*.sql`, with no regression to the in-tx discipline for small migrations."

## Context

The M2 `/review` domain-database agent (F-dom-db-4, MEDIUM) flagged that the repo's migration strategy uses plain blocking `CREATE INDEX` everywhere, and that CONCURRENTLY is not a drop-in swap because Drizzle runs migrations in a transaction. The finding was accepted with caveat and spun off as roadmap M4 (a project-wide ops concern, NOT a regression of any single migration; do NOT special-case `0021`). This milestone resolves it at the level it actually lives: a documented decision + an enforced guard, not a code change to any migration.

**Verified (discover, 2026-06-23):** `drizzle-orm@0.45.2` `pg-core/dialect.cjs` `PgDialect.migrate()` executes `await session.transaction(async (tx) => { for ... await tx.execute(stmt) })` — a SINGLE transaction wrapping every pending migration statement. There is NO per-migration no-transaction marker in this version (unlike node-pg-migrate / Rails `disable_ddl_transaction!`). Therefore CONCURRENTLY is impossible inside `runMigrations()` and the out-of-band procedure is the only correct mechanism.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists | Invariant to preserve |
|---|---|---|---|---|
| `.claude/knowledge-base/adrs/ADR-0018-large-table-index-concurrently-runbook.md` (NEW) | 0 | — | records the decision + alternatives | MADR-style; cites the verified drizzle single-tx behavior |
| `.claude/rules/architecture.md` | 167 | (existing) | § 10 "Build pipeline — known gaps" documents migration footguns (10.1 asset copy, 10.2 push-vs-migrate, 10.3 trigger side-channel) | existing §§ UNCHANGED; ADD § 10.4 (large-table index builds) following the same shape |
| `tests/integration/migration-no-concurrently.test.ts` (NEW) | 0 | — | the guard: no migrate()-applied `.sql` may contain `CREATE INDEX CONCURRENTLY` | pure file inspection (no pgvector container), like `schema-snapshot-parity.test.ts` |
| `CHANGELOG.md` | (existing) | — | Inquebrável Rule 6 | one `Changed` (or `Added`) entry under `[Unreleased]` |

### Current callers / dependents

- **`runMigrations`** (`packages/core/src/infrastructure/db/migrations-runner.ts:34`) → Drizzle `migrate()` → `PgDialect.migrate()` (single tx). The guard protects this path: a `CONCURRENTLY` in a journal-applied `.sql` would throw inside the tx at deploy. UNCHANGED by this milestone (the guard is a test; the runbook is docs).
- **`scripts/apply-trigger-migrations.mjs`** (§ 10.3) — the existing out-of-band psql side-channel for `CREATE TRIGGER`/`FUNCTION` (tx-safe via `CREATE OR REPLACE`). Precedent for out-of-band DDL; the CONCURRENTLY runbook is its read-side analogue but is NOT auto-applied (CONCURRENTLY is a deliberate, ops-gated step on large tables only).
- **The 4 existing partial-index migrations** (`0005`, `0008`, `0009`, `0021`) — all plain `CREATE INDEX IF NOT EXISTS`. UNCHANGED; the guard confirms none uses CONCURRENTLY, and the runbook's `IF NOT EXISTS` discipline is what lets an out-of-band CONCURRENTLY build coexist with the migration no-op.

### Domain glossary

- **single-transaction migrate** — drizzle-orm 0.45.2 wraps ALL pending migrations in one `session.transaction`. A statement that PG forbids inside a tx (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER TYPE ... ADD VALUE` pre-12) crashes the whole migrate with SQLSTATE 25001.
- **out-of-band index build** — running `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` on a direct autocommit connection (psql / a dedicated script), OUTSIDE `runMigrations()`, BEFORE deploying the app. Because the index then already exists, the migration file's plain `CREATE INDEX IF NOT EXISTS` is a metadata no-op at deploy and the journal stays consistent.
- **INVALID index** — if a `CREATE INDEX CONCURRENTLY` build fails midway, PG leaves an `indisvalid=false` index that still consumes writes; the runbook's recovery is `DROP INDEX [CONCURRENTLY] IF EXISTS` then retry.

### Architecture boundaries affected

- **No DIP/layer/runtime boundary crossed.** Deliverables are: one ADR (knowledge-base), one `architecture.md` subsection (rules), one guard test (tests/integration), one CHANGELOG entry. ZERO production code change, ZERO migration change, ZERO public-API change.
- **Migration-strategy policy boundary:** the guard formalizes an invariant of the existing single-tx migrate() contract (no CONCURRENTLY in journal-applied SQL). It does not alter how migrations run.

## Prior Art & Related Work

- **In-repo:** `architecture.md § 10.3` (trigger side-channel via `apply-trigger-migrations.mjs`) is the established precedent for out-of-band DDL that Drizzle's model can't carry; § 10.4 is the read-side (CONCURRENTLY) analogue. The guard mirrors `schema-snapshot-parity.test.ts` + `config-parity.test.ts` (pure file-inspection integration sentinels).
- **External:** GitLab database migration style guide + Rails `strong_migrations` both mandate `CREATE INDEX CONCURRENTLY` out-of-transaction for large tables and ship a lint that forbids plain `CREATE INDEX` on big tables / forbids CONCURRENTLY inside a transactional migration. This milestone adopts the same shape adapted to drizzle's single-tx migrator.
- **Verified source:** `drizzle-orm@0.45.2/pg-core/dialect.cjs` `PgDialect.migrate` (single `session.transaction`).

## Dependencies

(none — zero new runtime or dev dependencies. The guard is a Node `fs` file scan in a vitest test; the runbook + ADR are Markdown.)

## ADRs

### D1 — Out-of-band CONCURRENTLY runbook, NOT an in-migrate mechanism (no such mechanism exists in drizzle 0.45.2)

- **Decision:** document the out-of-band `CREATE INDEX CONCURRENTLY IF NOT EXISTS` before-deploy procedure (architecture.md § 10.4) as the chosen mechanism for large-table index builds; keep migration files as plain `CREATE INDEX IF NOT EXISTS` (correct for fresh/dev DBs).
- **Rationale:** drizzle-orm 0.45.2 `migrate()` is single-transaction (verified in source) and exposes no per-migration no-transaction escape; CONCURRENTLY in a migration file would crash deploy. The out-of-band step + `IF NOT EXISTS` makes the index build non-blocking on large prod tables while keeping the migration journal consistent (the migrate() `CREATE INDEX IF NOT EXISTS` no-ops when the index already exists). KISS + Rule 9 (use the platform primitive + the established § 10.3 out-of-band precedent).
- **Alternatives rejected:**
  - **Switch migration tool to one with no-tx mode** (node-pg-migrate `disableTransaction`, custom runner) — large blast radius, re-tooling the whole migration layer for one edge case the project does not yet hit (pre-release scale). YAGNI.
  - **Fork/patch drizzle migrate() to run a flagged file outside the tx** — maintaining a patched migrator is a liability; no upstream marker to rely on. Rejected.
  - **Accept blocking `CREATE INDEX` forever** — fine today (small tables) but a known deploy-stall landmine at GA scale; leaving it undocumented + unguarded is the actual defect M4 closes. Rejected.

### D2 — Enforce the invariant with a guard test, NOT a manual review note

- **Decision:** ship `tests/integration/migration-no-concurrently.test.ts` asserting no `migrations/*.sql` (the journal-applied set) contains `CREATE INDEX CONCURRENTLY` (case-insensitive, comment-tolerant).
- **Rationale:** a prose runbook alone is forgotten; an automated guard makes the invariant executable (a future dev who adds `CONCURRENTLY` to a migration file — the natural-but-wrong instinct after reading "use CONCURRENTLY for big tables" — gets a RED test BEFORE the deploy-time crash). Mirrors the repo's sentinel-test discipline (schema-snapshot-parity, config-parity, no-paper-names).
- **Alternatives rejected:** a `/code-quality` rule or a commit hook — heavier, out of band from the test suite; the existing pure-file sentinel pattern is the lightest correct fit.

## Dependency Graph

```
T1.1 (RED: guard test) ── precedes ──▶ T1.2 (GREEN: prove non-vacuous + clean-tree pass) ── precedes ──▶ T1.3 (ADR + architecture.md § 10.4 runbook + CHANGELOG)
```

Single phase, sequential.

## Phase 1 — Decision, runbook, and guard

### T1.1 — RED: guard test that forbids CONCURRENTLY in journal-applied migrations

#### Why this step
**Action:** add `tests/integration/migration-no-concurrently.test.ts` (pure `fs` scan, no pgvector) that reads every `packages/core/src/infrastructure/db/migrations/*.sql` and asserts none matches `/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i` (ignoring `--` comment lines).
**Reasoning:** drizzle's single-tx migrate() crashes (SQLSTATE 25001) if any journal-applied statement is CONCURRENTLY; the guard makes that invariant executable. Per Inquebrável Rule 5, prove it RED first: temporarily inject a `CREATE INDEX CONCURRENTLY` line into a scratch `.sql` (or a fixture) and confirm the test FAILS, then remove — documented in the iteration log (the guard is non-vacuous).

#### Files to edit
- `tests/integration/migration-no-concurrently.test.ts` (NEW)

#### TDD
- `test('no journal-applied migration .sql uses CREATE INDEX CONCURRENTLY (would crash drizzle single-tx migrate)')` — scans the SRC migrations dir (`packages/core/src/infrastructure/db/migrations/*.sql`, NOT the dist copy — EC-3); asserts the offending-file list is empty; the failure message names each offending file + the § 10.4 runbook pointer.
- **EC-1 (MUST FIX — non-vacuity guard):** BEFORE the CONCURRENTLY assertion, assert `expect(files.length).toBeGreaterThan(0)` (path-drift sentinel — the monorepo path already drifted once; a 0-file glob would pass vacuously). A path drift fails the test loudly.
- **EC-2 (whole-file scan):** read each file's full text, strip `--...EOL` line comments, then match `/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i` over the joined text (so `\s+` spans newlines — a `CREATE INDEX\nCONCURRENTLY` formatter wrap is still caught), NOT line-by-line. Inline fixture `"CREATE INDEX\n  CONCURRENTLY x ON t(c);"` asserts the detector flags it.
- Non-vacuity: temporary injection of `CREATE INDEX CONCURRENTLY "x" ON memories(id);` into a real `.sql` → test RED; remove → GREEN (captured in the impl log).

#### Concurrency tests
(none — single-threaded) — the test is a synchronous file scan; the milestone's subject (DB transactions) is documentation, not concurrent code.

#### Acceptance criteria
- Running `npx vitest run tests/integration/migration-no-concurrently.test.ts` exits zero with all assertions passing on the clean tree (path-drift sentinel `files.length > 0` + zero CONCURRENTLY hits + the line-split fixture flagged).

#### DoD
- `npx vitest run tests/integration/migration-no-concurrently.test.ts` reports all tests passed; the injected-CONCURRENTLY RED run is captured verbatim in the iteration log.

### T1.2 — GREEN: clean-tree pass + comment-tolerance check

#### Why this step
**Action:** confirm the guard passes against the current 22 migration files (none uses CONCURRENTLY) and that the regex ignores a `-- ... CONCURRENTLY ...` comment (so a runbook reference in a SQL comment does not false-positive).
**Reasoning:** the guard must enforce the real statement, not a mention; comment-tolerance prevents a future false RED when a migration documents the policy in a comment.

#### Files to edit
- (none — verification; the test already encodes comment-tolerance)

#### TDD
- A second assertion (or fixture) proves a line beginning with `--` containing `CONCURRENTLY` does NOT trip the guard.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- Running the guard against the 22 current migrations exits zero, AND an inline fixture asserts a `-- ... CONCURRENTLY ...` comment line produces zero hits (comment-tolerance proven, no false-RED).

#### DoD
- `npx vitest run tests/integration/migration-no-concurrently.test.ts` reports all tests passed (clean tree + comment-tolerance fixture).

### T1.3 — ADR + architecture.md § 10.4 runbook + CHANGELOG

#### Why this step
**Action:** write `ADR-0018-large-table-index-concurrently-runbook.md` (decision D1/D2 + alternatives) and add `architecture.md § 10.4 — Large-table index builds run CONCURRENTLY out-of-band` documenting: WHY (single-tx migrate + blocking lock), WHEN (large + write-hot tables; small/fresh = plain is fine), the PROCEDURE (author the migration as `CREATE INDEX IF NOT EXISTS`; before deploying against a large prod DB, run the CONCURRENTLY equivalent out-of-band on a direct connection; deploy → migrate() no-ops via `IF NOT EXISTS`), the INVALID-index recovery (`DROP INDEX CONCURRENTLY IF EXISTS` + retry), and the guard (§ D2) that enforces no CONCURRENTLY in migration files. Add a CHANGELOG entry.
**Reasoning:** this is the milestone's primary deliverable (the goal: "tracked as a runbook in architecture.md"); the guard (T1.1) enforces it.

#### Files to edit
- `.claude/knowledge-base/adrs/ADR-0018-large-table-index-concurrently-runbook.md` (NEW)
- `.claude/rules/architecture.md` (add § 10.4)
- `CHANGELOG.md` (`[Unreleased]`)

#### TDD
- N/A (documentation). The guard test (T1.1) is the executable enforcement of the documented policy.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- Running `grep -c "rejected" .claude/knowledge-base/adrs/ADR-0018-large-table-index-concurrently-runbook.md` returns ≥ 2 AND `grep -c "### 10.4" .claude/rules/architecture.md` returns 1 AND `grep -c "packages/core/src/infrastructure/db/migrations" .claude/rules/architecture.md` returns ≥ 1 (correct path in § 10.4) AND the CHANGELOG `[Unreleased]` gains exactly one entry.

#### DoD
- `grep -q "### 10.4" .claude/rules/architecture.md` exits zero; ADR-0018 file exists with Decision + ≥ 2 rejected alternatives; CHANGELOG `[Unreleased]` entry present.

## Coverage Matrix

| Goal claim / requirement | Task |
|---|---|
| ADR records drizzle single-tx → no in-migrate CONCURRENTLY | T1.3 (ADR-0018 D1) |
| Runbook documents the out-of-band procedure (architecture.md § 10.4) | T1.3 |
| Decision (out-of-band vs no-tx mode) recorded with rationale + alternatives | T1.3 (ADR D1) |
| No regression to the in-tx discipline for small migrations | T1.1/T1.2 (guard only forbids CONCURRENTLY; plain CREATE INDEX still allowed) |
| Guard: green on clean tree, red on injected CONCURRENTLY | T1.1 |
| Comment-tolerance (a `--` mention does not false-RED) | T1.2 |
| CHANGELOG entry | T1.3 |

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | The runbook is an ops PROCEDURE, not automation — a hurried operator could still deploy a plain `CREATE INDEX` migration against a large table and stall writes | MEDIUM | the runbook makes the procedure explicit + the guard prevents the WORSE failure (CONCURRENTLY-in-migrate crash); full automation (a CI lint on table size) is a larger follow-up, out of scope (YAGNI at pre-release scale) | documented |
| 2 | Guard regex over-matches (e.g. `CREATE INDEX CONCURRENTLY` inside a string literal in a future migration) | LOW | migrations are hand-authored DDL (< 25 files); regex + comment-stripping is sufficient (same rationale as § 10.3's trigger-detection regex); revisit if migration count grows | documented |
| 4 | Guard goes vacuous if the migrations path drifts (0 files scanned) — EC-1 | MEDIUM | T1.1 asserts `files.length > 0` (path-drift sentinel) BEFORE the CONCURRENTLY assertion; a drift fails the test loudly | implementer |
| 5 | A line-split `CREATE INDEX\nCONCURRENTLY` evades a line-by-line scan — EC-2 | LOW | T1.1 scans whole-file text (comment-stripped) with `\s+` spanning newlines; inline fixture proves it | implementer |
| 3 | architecture.md §§ 10.1-10.3 carry stale `src/local/migrations` paths (pre-monorepo) | LOW | OUT OF SCOPE — § 10.4 uses the correct `packages/core/src/infrastructure/db/migrations` path; fixing the older subsections is a separate doc-hygiene pass (not scope-crept here) | deferred |

## Unresolved Questions

(none — every decision is resolved at plan time: drizzle's single-tx behavior is verified in source, the out-of-band mechanism is the only correct option, and the guard + runbook shapes mirror established in-repo precedents.)

## Failure scenarios

The runbook documents a Postgres ops procedure; the guard test itself touches no external I/O (pure file scan). Documented failure modes (in the runbook, not the test):

| Dependency | Failure mode | Handled where | Expected behavior |
|---|---|---|---|
| Postgres (out-of-band CONCURRENTLY build) | build fails midway → INVALID index left behind | architecture.md § 10.4 recovery | `DROP INDEX CONCURRENTLY IF EXISTS <name>` then retry; never leave an `indisvalid=false` index consuming writes |
| Postgres (migrate at deploy) | a migration file smuggles CONCURRENTLY → migrate() crashes (SQLSTATE 25001) inside the single tx | the guard test (T1.1) | caught at test time, before deploy — RED build, never a prod crash |
| filesystem | migrations dir missing/renamed | guard test | test fails loudly (cannot scan) rather than silently passing on zero files |

## Global Definition of Done

- [ ] `tests/integration/migration-no-concurrently.test.ts` green on the clean tree; non-vacuity (injected-CONCURRENTLY RED) demonstrated + logged.
- [ ] Comment-tolerance asserted (a `--` CONCURRENTLY mention does not false-RED).
- [ ] `ADR-0018-large-table-index-concurrently-runbook.md` exists (Decision + ≥ 2 rejected alternatives).
- [ ] `architecture.md § 10.4` documents WHY + WHEN + PROCEDURE + INVALID-index recovery + the guard cross-reference (correct migrations path).
- [ ] `CHANGELOG.md` `[Unreleased]` entry.
- [ ] `npm run test` (or the targeted guard run) green; no production/migration code changed (`git diff` = docs + 1 test only).
- [ ] `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- [ ] `/review` verdict READY_TO_MERGE.

## Final Phase: Integration Validation

- `npx vitest run tests/integration/migration-no-concurrently.test.ts` (+ the full suite remains green — the guard is additive).
- Verify `git diff --stat` shows ONLY: the new test, the new ADR, architecture.md, CHANGELOG — no production/migration code.
- The plan is NOT complete until the above pass AND `/code-quality` + `/review` are green.
