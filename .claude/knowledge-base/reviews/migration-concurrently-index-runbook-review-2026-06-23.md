# Review: migration-concurrently-index-runbook (M4)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 3 — domain (Postgres/migrations), tests, cross-validation
**Findings:** BLOCKER 0, HIGH 0, MEDIUM 2 (both FIXED inline), LOW 4, INFO 14
**Verdict:** READY_TO_MERGE

## Scope reviewed

theo-memory commit `8bc04ca` (M4) + the review-fix commit: ADR-0018 + `architecture.md § 10.4` runbook + the guard `tests/integration/migration-no-concurrently.test.ts` + CHANGELOG. No production/migration code.

## BLOCKER / HIGH

None.

## MEDIUM (both FIXED inline)

### F-T1 (tests, MEDIUM) — guard under-matched `CREATE UNIQUE INDEX CONCURRENTLY` — FIXED
- The detector regex `/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i` missed `CREATE UNIQUE INDEX CONCURRENTLY` — a valid Postgres statement that crashes the single-tx `migrate()` identically (SQLSTATE 25001), so it could smuggle past the guard.
- **FIXED:** regex → `/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i` + fixtures (UNIQUE-CONCURRENTLY flagged; UNIQUE-IF-NOT-EXISTS allowed). Re-proved non-vacuous: injecting `CREATE UNIQUE INDEX CONCURRENTLY` → RED (offender named); removed → GREEN.

### F-dom-db-runbook-3 (domain, MEDIUM) — out-of-band index name/definition-match invariant unstated — FIXED
- `IF NOT EXISTS` matches on index NAME only, never definition. The runbook didn't state that the out-of-band index must be byte-identical to the migration's `CREATE INDEX` — a name mismatch reintroduces the blocking build; a same-name-different-definition build silently ships the WRONG index (e.g. forgetting `0021`'s `text_pattern_ops` opclass or partial `WHERE`).
- **FIXED:** added the byte-identical-name+definition invariant + the per-database (multi-region: build on every primary) note to both `architecture.md § 10.4` step 2 and ADR-0018 § Decision.

## LOW (accepted / noted)

- **F-T2 (tests) — FIXED:** added a fixture asserting a real statement WITH a trailing `-- comment` is still flagged (locks the comment-stripper's keep-statement behavior against future refactors).
- **F-T5 / F-dom-db-runbook-6 (over-match):** the comment stripper handles `--` line comments only, not `/* */` blocks or string literals — a CONCURRENTLY inside those would false-RED. ACCEPTED: fails CLOSED (a false RED a human inspects, never a false GREEN that ships a crash); migrations are hand-authored DDL (< 25 files); same rationale as § 10.3's trigger-detection regex (plan Drawback #2).
- **F-dom-db-runbook-4/7 (INVALID-index name + multi-region):** the recovery uses the same name as the failed build (unambiguous `DROP INDEX CONCURRENTLY IF EXISTS`); multi-region per-database note added (see F-dom-db-runbook-3 fix).

## Domain (Postgres) verdict — runbook TECHNICALLY CORRECT

All four load-bearing claims verified against drizzle-orm 0.45.2 source + Postgres semantics: (1) `migrate()` is single-transaction (`pg-core/dialect.cjs` `session.transaction`); (2) `CREATE INDEX IF NOT EXISTS` is a pure metadata no-op when the named index exists + the journal INSERT runs unconditionally → journal stays consistent; (3) `DROP INDEX CONCURRENTLY IF EXISTS` recovery for `indisvalid=false` (which still consumes writes) is correct; (4) the "IF NOT EXISTS is load-bearing" claim is accurate (without it, a bare `CREATE INDEX` would hit 42P07 and roll back the whole migrate batch).

## Cross-validation — all INFO

7/7 Coverage Matrix delivered. `git show 8bc04ca --stat`: ONLY docs + 1 test (6 docs/artifacts + 1 test; 0 migration `.sql`, 0 `schema.ts`, 0 production src). The 2 unrelated session-modified files (`.claude/settings.json`, `.claude/hooks/validate-command.sh`) were correctly EXCLUDED from the commit (Rule 3 honesty — not swept in). § 10.4 uses the correct `packages/core/src/infrastructure/db/migrations` path; the stale `src/local/migrations` survives only in the pre-existing §§ 10.1/10.2 (out of scope per Drawback #3). CHANGELOG entry correct category (Changed). Goal proven (guard green clean + red on injection, both reproduced).

## Quality gates

- Guard `migration-no-concurrently.test.ts` green (clean + UNIQUE + trailing-comment + comment-tolerance + line-wrap fixtures); non-vacuity reproduced for both plain AND UNIQUE CONCURRENTLY.
- `schema-snapshot-parity.test.ts` green (no regression). `/code-quality` PASS (zero caps).

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER / 0 HIGH. Both MEDIUM fixed inline (guard now catches `UNIQUE ... CONCURRENTLY`; runbook now states the name+definition-match invariant + multi-region per-database step). LOW are accepted (fail-closed over-match) or fixed (trailing-comment fixture). Docs + 1 guard test only; no production/migration code; the runbook's technical claims are source-verified.
