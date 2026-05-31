# SEPA — Iteration 1 / Task T0.1 / Phase Pre-RED / Mode VERBOSE

Date: 2026-05-31
Agent ID: a4ac360e8ac8eda9f
Invocation path: Fallback

## Plan recap
- T0.1 generates `meta/0003_snapshot.json` + `meta/0004_snapshot.json` + bumps `_journal.json` entries idx=3, idx=4 via `npm run db:generate` against a CLEAN throwaway DB; closes **F-dom-db-1 BLOCKER** (runMigrations skips 0003/0004 on fresh prod DBs because Drizzle reads journal-only).

## Findings

- **INFO** — Filesystem state confirmed: 5 .sql files (0000-0004), 3 snapshots (0000-0002), journal stops at idx=2. RED will fail BOTH assertions.
- **MAJOR** — Test path `tests/integration/migrations/journal-sync.test.ts` is NEW; verify dir exists OR create. Verify `vitest.integration.config.ts` `include` glob covers `tests/integration/**/*.test.ts` (cycle-implement v1.5 Fix #5).
- **MAJOR** — RED test must assert BOTH (a) `count(meta/*.json) - 1 == count(0*.sql)` AND (b) per-`.sql` matching `tag` in journal entries.
- **MAJOR** — EC-1 absorption (DROP DATABASE + delta==2) is correctly built into GREEN steps. DO NOT skip the delta assertion.
- **MAJOR** — Plan Acceptance separately requires smoke test against a SECOND fresh DB `themem_test_runmigrations` with full `runMigrations()` E2E. Separate from journal-sync.test.ts.
- **MINOR** — ADR D4: snapshots MUST be drizzle-kit-generated, NEVER hand-authored. If `db:generate` fails, HALT — do not patch JSON manually.
- **MINOR** — REFACTOR Step #9 `DROP DATABASE themem_journal_sync_tmp` is cleanup hygiene; safe to defer but recommended same iteration.

## Recommended action

1. Verify `tests/integration/migrations/` dir exists; `mkdir -p` if not.
2. Verify vitest integration config glob covers new path BEFORE writing test.
3. Write the test asserting BOTH (a) count match AND (b) per-`.sql` tag presence.
4. Run integration test — confirm BOTH assertions fail.
5. GREEN with delta==2 HARD HALT gate. **Most important gotcha: if delta ≠ 2, ABORT and surface — never commit byte-suspect snapshots.**
