# SEPA — Iteration 1 / Task T0.1 / Phase Pre-RED

**MODE:** TIGHT (but escalated to multi-finding due to 4 MAJOR flags)

## Plan recap
- T0.1 is a verification-only gate (no commits, no files edited) that runs 6 bash pre-flight checks before T1.1 can begin; ADR D5 means RED is `n/a`.

## Findings
- [INFO] — TDD `RED: none` is CORRECT per ADR D5
- [MAJOR] — Check #1 regex too narrow: misses `tests/integration/forgetting/` + `concepts/pesquisa/`. Widen exclusion OR stash first.
- [MAJOR] — Check #2 (commit ancestry) needs `git merge-base --is-ancestor 85d87bd HEAD`, not just `git log -1`.
- [MAJOR] — Check #3 needs `pg_isready` or `psql -c "SELECT 1"` for real reachability signal (not just port publish).
- [MAJOR] — Check #5 only checks `THEOMEM_PG_URI=` presence — supplement with reachability.
- [INFO] — Node PATH NOT required for T0.1 pure-bash checks (relevant from T1.1).
- [INFO] — T0.1 produces NO commit; capture results into T1.1 commit body buffer.

## Recommended action
- Widen check #1 regex, replace #2 with ancestry check, supplement #3+#5 with reachability test. Capture results for T1.1 commit body. If ANY check fails, HALT (do NOT proceed to T1.1).
