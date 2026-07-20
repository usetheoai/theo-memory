# SEPA Initial Brief — explainable-recall (2026-07-20)

Verdict: **PROCEED_WITH_NOTES**. Role accepted (read-only observer). Dependency order T0.1→T4.1 valid; D1 bare-array contract preserved; no DIP push toward importing pg impl into the domain pipeline; EC-1..EC-6 all mapped to TDD blocks.

## Findings (to resolve before T3.1 GREEN)

- **[HIGH] Finding A — cap-source gap.** T3.1 pipeline truncates `dropped.slice(0, cap)` + emits `recall_trace_truncated`, but `maxRowsPerRecall` lives in `RecallTraceStoreConfig` (pg store ctor), NOT on the 2-method DIP. Pipeline holds the interface → cannot read the cap without (a) a 3rd DIP method (breaks ADR-0008), (b) duplicating the constant (DRY), or (c) silent slice (EC-4 unobservable). **Resolution adopted (v1.3):** add `maxRows` to `recallTraceContext`; the factory (T4.1) populates it from the resolved config; pipeline truncates against `context.maxRows`. DIP stays 2 methods.
- **[MEDIUM] Finding B — stale loose `recallId?`.** T3.1 Objective + Baseline row still say "add `recallTrace? + recallId?: string`" (pre-v1.1 residue), contradicting D1/EC-2's single `recallTraceContext`. **Resolution (v1.3):** D1 ADR + pseudo-code are authoritative; T3.1 Objective + Baseline updated to `recallTraceContext`.
- **[LOW] `RecallTraceBatch.query?` has no persistence target** (no `query` column). **Resolution (v1.3):** dropped from the batch (YAGNI).
- **[LOW] T2.1 concurrency label** "atomic-counter invariant" — cosmetic mislabel; kept (load-bearing for the plan-confidence concurrency signal; "(parallel test)" makes it accurate).
- **[NOTE] `workspaceId` resolvability at T4.1** — `this.scope`/`this.filters` available in `retrieveResults`; `scopeKey` derivable; but confirm `workspaceId` is resolvable at that site before T4.1 GREEN (may derive from `withWorkspace`/config). Loop verifies at T4.1.

No `[CRITICAL] HALT` at brief time (no code exists yet). Green to start Phase 0/1/2 once A+B+query are resolved in the plan.
