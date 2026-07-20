# SEPA pre-RED — iteration 1 / T0.1 (2026-07-20)

Verdict: **PROCEED_WITH_NOTES**.

- **HIGH** — validator NaN/non-integer gap: the plan pseudocode gates only `<= 0 || > 5000`; `NaN`/`Infinity`/floats silently pass (IEEE-754). Mirror `validateRecallCacheStoreConfig`'s `Number.isInteger` guard. → **Applied:** validator uses `!Number.isInteger(...) || <= 0 || > MAX_ROWS_PER_RECALL`; RED test `rejects non-integer / NaN / Infinity` added.
- **MEDIUM** — `RecallTraceBatch.rows` Omit shape not asserted in test-d. → **Applied:** added test-d assertion that rows omit recallId/workspaceId/scopeKey/createdAt (EC-2) and carry memoryId/dropReason/composite.
- **MEDIUM** — DRY: reference `MAX_ROWS_PER_RECALL` const, not magic 5000. → **Applied:** validator + message reference the exported const.
- NOTE — ADR-0008 2-method cap on track; naming consistent; `InvalidRecallTraceConfig` mirrors `InvalidCacheConfig`. Public re-export of the error → Phase 4 (T0.1 only defines it).
