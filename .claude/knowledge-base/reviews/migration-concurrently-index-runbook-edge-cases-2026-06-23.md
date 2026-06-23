# Edge Case Review — migration-concurrently-index-runbook

Date: 2026-06-23
Tasks analyzed: 3 (T1.1, T1.2, T1.3)
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: vacuous-green if the migrations dir path drifts (0 files scanned)
- **Affected task:** T1.1
- **Family:** State / Format
- **Scenario:** the guard globs `packages/core/src/infrastructure/db/migrations/*.sql`. If that path drifts (monorepo reorg — it already drifted once, the architecture.md §§ 10.1-10.3 still say `src/local/migrations`), the glob returns 0 files and the "no file contains CONCURRENTLY" assertion passes VACUOUSLY — the guard silently protects nothing.
- **Impact:** the guard rots into a no-op; a future CONCURRENTLY-in-migration slips through to a deploy crash.
- **Suggested fix:** assert the scan found the expected baseline — `expect(files.length).toBeGreaterThan(0)` (ideally `>= 22`, the current count) BEFORE the CONCURRENTLY assertion, so a path drift fails the test loudly. (The plan's Failure-scenarios row already names this; promote it to an explicit assertion in T1.1.)

## SHOULD TEST

### EC-2: a line-split `CREATE INDEX\nCONCURRENTLY` evades a line-by-line scan
- **Affected task:** T1.1
- **Suggested test:** scan the WHOLE file text (after stripping `--...EOL` comments), matching `/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i` where `\s+` spans newlines — NOT line-by-line. Add an inline fixture string `"CREATE INDEX\n  CONCURRENTLY x ON t(c);"` and assert the detector flags it, so a DDL-formatter wrap can't evade the guard.

## DOCUMENT

### EC-3: scan SRC migrations only, not the dist/ copy
- **Accepted risk:** `dist/infrastructure/db/migrations/*.sql` is a build-time copy of src. The guard scans the SRC dir only (the source of truth + what `db:generate` writes); dist is regenerated each build. Scanning both would double-count + couple the guard to build state. Documented: src-only is intentional.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 1 | 1 | 1 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (non-zero file-count assertion, the load-bearing non-vacuity guard) into T1.1; EC-2 (whole-file `\s+` scan) into the T1.1 detector; EC-3 as a one-line note. No new tasks, no scope change.
