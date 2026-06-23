# Implement-Validate — migration-concurrently-index-runbook (M4)

**Date:** 2026-06-23
**Branch:** develop
**Commit:** 8bc04ca
**Verdict:** PASS

## Cycle-implement discipline (executed directly — docs + 1 guard test)

| Phase | Result |
|---|---|
| RED | guard test written; proven non-vacuous by injecting `CREATE INDEX CONCURRENTLY` into a real migration `.sql` → test RED (offender named); removed → GREEN |
| GREEN | clean tree 2/2 green (detector unit cases + the migrations scan) |
| Docs | ADR-0018 + architecture.md § 10.4 runbook + CHANGELOG `Changed` |
| WIRING | guard test IS the executable enforcement of the documented policy; no production code (a runbook + a sentinel) — runtime metric N/A |
| COMMIT | `8bc04ca` (docs + 1 test only; the 2 unrelated session-modified files `settings.json`/`validate-command.sh` deliberately EXCLUDED per Rule 3) |

## Validation gates

| Gate | Result |
|---|---|
| Guard `migration-no-concurrently.test.ts` clean tree | 2/2 PASS |
| Non-vacuity (injected CONCURRENTLY) | RED proven, then removed → GREEN |
| `schema-snapshot-parity.test.ts` (no regression) | PASS |
| EC-1 path-drift sentinel (`files.length > 0`) | asserted |
| EC-2 line-split + comment-tolerance | asserted (detector unit cases) |
| `/code-quality` | PASS (zero caps) |
| Diff scope (docs + 1 test, no production/migration code) | confirmed |

## Verified premise (the runbook's load-bearing claim)

`drizzle-orm@0.45.2/pg-core/dialect.cjs` `PgDialect.migrate` runs `await session.transaction(async (tx) => { for ... tx.execute(stmt) })` — ALL pending migrations in ONE transaction. Hence `CREATE INDEX CONCURRENTLY` (forbidden in a tx) cannot live in a migration file; the out-of-band runbook is the only correct mechanism. ADR-0018.

## Coverage Matrix — 7/7 delivered

| Goal claim | Task | Verified by |
|---|---|---|
| ADR records drizzle single-tx → no in-migrate CONCURRENTLY | T1.3 | ADR-0018 D1 |
| Runbook documents out-of-band procedure (§ 10.4) | T1.3 | `grep '### 10.4'` = 1 |
| Decision + ≥2 rejected alternatives | T1.3 | ADR-0018 § Alternatives |
| No regression to in-tx discipline for small migrations | T1.1 | guard only forbids CONCURRENTLY; plain CREATE INDEX still allowed |
| Guard green on clean tree, red on injection | T1.1 | demonstrated |
| Comment-tolerance (no false-RED) | T1.2 | detector unit case |
| CHANGELOG entry | T1.3 | `[Unreleased] § Changed` |
