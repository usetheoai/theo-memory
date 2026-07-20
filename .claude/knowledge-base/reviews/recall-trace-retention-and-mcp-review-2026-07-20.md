# Review: recall-trace-retention-and-mcp (M4)

**Date:** 2026-07-20
**Reviewers:** 1 adversarial Staff-level agent (security/tenant-isolation + DIP + concurrency + cross-validation), consolidated by the main loop
**Diff reviewed:** `git diff 0b532fb..HEAD` (M4 implementation) + fix-cycle `f5e4e32`
**Findings:** 6 total (BLOCKER: 0, HIGH: 0, MEDIUM: 3, LOW: 2, INFO: 1)
**Verdict:** READY_TO_MERGE

The tenant-isolation core — the load-bearing dimension for a governed-deletion feature —
was **clean on the first pass** (M4-SEC-CLEAN): the retention sweep is age-based only and
cannot target a tenant; the MCP `explain_recall` tool resolves the workspace from the
auth-trusted scope (never the args, CWE-441 safe) and reuses the S2 workspace-scoped
`getByRecallId`; the per-workspace opt-out is fail-closed and DB-read-free. No BLOCKER, no
HIGH. The 3 MEDIUM + 2 LOW findings were governance/robustness gaps, all fixed in `f5e4e32`
and re-validated green.

## MEDIUM findings (all RESOLVED in f5e4e32)

### M4-R1 — per-workspace opt-out was not operator-reachable — RESOLVED
- The flagship opt-out (`disabledWorkspaces`) was only settable via SDK config; the deployed
  MCP/agent-tools/server factory wired an empty `recallTrace: {}` POJO, so an operator could
  not actually opt a workspace out.
- **Fix:** `resolveRecallTraceDisabledWorkspaces()` parses `THEOMEM_RECALL_TRACE_DISABLED_WORKSPACES`
  (CSV) and `wireMemoryFromPool` threads it into the write config — reachable in the deployed
  artifact. Chain proven: env→list (unit `recall-trace-env.test.ts` 9/9) + list→zero-rows
  (integration `recall-trace-store.test.ts`).

### M4-R2 — unvalidated retention window (full-wipe footgun) — RESOLVED
- `Number("-1")` → predicate `created_at <= NOW() + interval` → matched EVERY row across ALL
  tenants (audit-log wipe); `NaN` → interval cast throws every tick (silent no-run).
- **Fix:** validated at two layers (error-handling.md § 2): `resolveRecallTraceMaxAgeSeconds()`
  throws `RangeError` on non-positive/non-finite env; `PgRecallTraceRetention.sweep` throws a
  typed `InvalidRecallTraceConfig` before touching the table. Regression tests: `sweep(-1)` /
  `sweep(NaN)` / `sweep(Infinity)` reject and the cross-tenant log is intact (retention 7/7).

### M4-R3 — race test did not exercise the 40001 retry — RESOLVED
- The original race test used fresh writes disjoint from the (old-row) delete-set, so no
  serialization conflict ever arose — it proved outcome, not the retry mechanism.
- **Fix:** added a test running TWO concurrent sweeps over the SAME old rows (a real write-write
  SSI conflict → 40001 → retried once): both resolve, the old set is deleted exactly once, no
  orphan, cross-workspace fresh row untouched (retention 7/7).

## LOW findings (RESOLVED in f5e4e32)

### M4-R4 — benchmark measured write cost, not the recall ON/OFF delta — RESOLVED (honest doc)
- The shipped numbers are real (sweep 335,276±40,449 rows/sec; trace write 4.26±0.59 ms/recall)
  but not a recall-path p50/p95 ON/OFF arm. **Fix:** the benchmark doc now states the write cost
  IS the ON-vs-OFF delta (the pipeline is byte-identical except for the single batch INSERT; OFF
  adds 0), so no separate harness re-measures the same INSERT.

### M4-R5 — shutdown did not drain an in-flight sweep — RESOLVED
- **Fix:** `startRecallTraceRetentionCron().stop()` is now async and awaits the in-flight tick;
  `installServerLifecycle` awaits `retentionCron.stop()` before `pool.end()`.

## INFO

### M4-SEC-CLEAN — tenant-isolation dimension clean (unchanged by the fix-cycle)
Sweep age-based/parameterized/internal (no cross-tenant delete); `explain_recall` workspace from
scope, `.strict()` schema, DTO projected (no workspaceId/scopeKey/createdAt leak); retention port
separate from the store (SRP + ADR-0008 2-method cap); croner reused (Rule 9).

## Quality gates (post-fix, re-validated)

- FX1 env-resolver unit: **9/9** PASS
- recall-trace retention integration (incl. FX2 validation + FX3 real 40001): **7/7** PASS
- full recall-trace integration suite: **30/30** PASS
- unit suites agent-core + cli + mcp: **247/247** PASS
- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 warnings**
- module-size budget: agent-tools-memory 267, run-server 296 (both ≤ 300; SRP extractions)

## Handoff decision

READY_TO_MERGE — all findings resolved and re-validated; proceed to `/release`.
