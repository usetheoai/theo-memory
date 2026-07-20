# Edge Case Review — explainable-recall

Date: 2026-07-20
Plan: .claude/knowledge-base/plans/explainable-recall-plan.md (v1.0)
Tasks analyzed: 5 (T0.1, T1.1, T2.1, T3.1, T4.1) + Final Phase
Cases found: 8 (EDGE: 3, NEGATIVE: 5 | MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: Postgres parameter-limit blows the batch INSERT when `maxRowsPerRecall` is large
- **Affected task:** T2.1
- **Kind:** NEGATIVE (invalid-at-scale input)
- **Family:** Resource / Boundary
- **Scenario:** `PgRecallTraceStore.record` builds ONE multi-row parameterized INSERT. Each row has ~10 columns → params = rows × ~10. Postgres caps bind params at 65535. `maxRowsPerRecall` default is 200 (2000 params, safe), but the config lets an operator set it arbitrarily high; `maxRowsPerRecall ≥ ~6500` → INSERT throws `too many parameters`. Because the write is fail-soft (D3), the failure is swallowed → tracing silently writes nothing for large-drop recalls.
- **Impact:** Feature silently no-ops on the exact case it exists for (a recall that drops many candidates), with no correct result.
- **Suggested fix:** In `validateRecallTraceStoreConfig` (T0.1), cap `maxRowsPerRecall` at a safe max (e.g., `≤ 5000`) with a typed error; OR chunk the INSERT in `record` into batches of ≤ 5000 params. Prefer the validator cap (simpler, KISS).

### EC-2: `workspaceId` + `scopeKey` may not be in scope at the pipeline write point
- **Affected task:** T3.1
- **Kind:** NEGATIVE (missing dependency)
- **Family:** State / Integration
- **Scenario:** T3.1's pseudo-code calls `record({ recallId, workspaceId, scopeKey, rows })` from inside `runRetrievalPipeline`. The baseline confirmed `recallId` is threaded via `RetrievalDeps`, but did NOT confirm `workspaceId`/`scopeKey` are available inside the pipeline — the pipeline operates on the `candidates` Map + `RetrievalDeps`, and scope resolution lives in `scoped-memory.ts` (`filtersFromScope`), not necessarily passed into the pipeline. If they are absent, the batch cannot be keyed by tenant → breaks D2 (tenant-scoped rows).
- **Impact:** Plan-time assumption that may not hold → implementation blocked or rows written without `workspace_id`.
- **Suggested fix:** Thread `workspaceId` + `scopeKey` into the pipeline alongside `recallId` — carry them in a single `recallTraceContext?: { recallId; workspaceId; scopeKey }` field on `RetrievalDeps` (one optional field instead of three). Update T3.1 Deep Dives + T4.1 threading accordingly.

### EC-3: Tracing enabled but `recall_traces` table absent → silent forever (migration not run)
- **Affected task:** T4.1
- **Kind:** NEGATIVE (environment/config failure)
- **Family:** State / Permission
- **Scenario:** Operator sets `createLocalMemory({ recallTrace: {} })` but forgot `themory migrate` (table missing). First `record()` throws "relation recall_traces does not exist"; fail-soft (D3) swallows it; every recall silently writes nothing. The feature appears "on" but produces no data — the worst outcome per Princípio 3 (silent failure of the whole capability).
- **Impact:** Undetectable no-trace state; violates the auditability contract.
- **Suggested fix:** In `resolveRecallTraceStore` (T4.1), probe the `recall_traces` table at resolve time (mirror `resolveRecallCacheStore`'s dim-probe, `factory.ts:91-97`) and throw a clear typed error at `createLocalMemory` if absent — fail-fast at construction, not silent-forever at runtime. Add a sub-task to T4.1.

## SHOULD TEST

### EC-4: Silent truncation when a recall drops MORE than `maxRowsPerRecall`
- **Affected task:** T3.1
- **Kind:** EDGE (extreme of valid)
- **Suggested test:** `test_pipeline_marks_trace_truncated_when_drops_exceed_cap` — with `maxRowsPerRecall=2` and 5 dropped candidates, assert only 2 rows persist AND a truncation signal is emitted (an OTel event `recall_trace_truncated` with `dropped_total` vs `persisted`), so `explain()` (S2) knows the trace is partial. "No silent caps" (root CLAUDE.md workflow principle) — a truncated trace must not read as complete.

### EC-5: Partial deps presence — `recallTrace` set but `recallId`/context missing (or vice versa)
- **Affected task:** T3.1
- **Kind:** NEGATIVE (inconsistent internal state)
- **Suggested test:** `test_pipeline_skips_trace_when_context_incomplete` — assert the write gate requires BOTH the store AND the context; partial presence → no write, no throw (defensive, since Phase 4 always supplies both together). Prevents a NPE if a future caller wires one without the other.

### EC-6: `composite = null` round-trip for `semantic_gate` drops
- **Affected task:** T2.1
- **Kind:** EDGE (nullable-but-valid)
- **Suggested test:** `test_pg_store_preserves_null_composite` — a `semantic_gate` row written with `composite: null` reads back as `null` (not 0, not NaN, not dropped). Guards Q3's honest-null decision through the pg driver's number/null coercion.

## DOCUMENT

### EC-7: `drop_reason` column has no DB CHECK constraint
- **Kind:** NEGATIVE (invalid value)
- **Accepted risk:** `drop_reason` is `text` with no CHECK on the 4 enum values. Acceptable: the ONLY writer is our pipeline (past the trust boundary, data is trusted per `architecture.md`/`error-handling.md § 2`); the TS `DropReason` union enforces it at compile time. A DB CHECK is belt-and-suspenders not worth the migration rigidity. Revisit if a second writer ever appears.

### EC-8: Trace write adds latency to the recall hot path even when drops are few
- **Kind:** EDGE (performance boundary)
- **Accepted risk:** One extra INSERT per recall when tracing is ON. Already a Drawback in the plan; mitigated by opt-in default-OFF + single batched write. The Final Phase should observe ON-vs-OFF recall latency but this is not a blocker — documented, not gated.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 (EC-1 fix lands here) | 0 | 0 |
| T1.1 | 0 | 1 | 0 | 0 | 1 (EC-7) |
| T2.1 | 1 | 1 | 1 (EC-1) | 1 (EC-6) | 0 |
| T3.1 | 1 | 1 | 1 (EC-2) | 2 (EC-4, EC-5) | 0 |
| T4.1 | 0 | 1 | 1 (EC-3) | 0 | 0 |
| Final | 1 | 0 | 0 | 0 | 1 (EC-8) |

**Coverage check:** every task touching an input boundary has ≥1 EDGE and ≥1 NEGATIVE considered. T0.1 is pure type/validator (validator NEGATIVE already in plan).

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX (EC-1 param-limit cap, EC-2 thread workspaceId/scopeKey, EC-3 probe table at resolve). Absorb into v1.1 before `/plan-confidence`.
