# Followups — v0-4b-forgetting-pipeline (scope-creep avoided during implementation)

Tracking items observed during the halt-loop but DEFERRED to avoid scope creep
per `cycle-implement.md § Anti-pattern #7`. Add new entries below; archive
when the entry ships in its own follow-up plan.

## F1 — SEPA agent file default weights drift (surfaced at iter 3 / T2.1)

The SEPA agent definition at `.claude/agents/implement-v0-4b-forgetting-pipeline-2026-05-30/sepa.md` lines 26 + 110 declares the default triadic weights as `[0.4, 0.3, 0.3]`. The locked plan T2.1 § Deep Dives line 482, the blueprint D8 lines 418 + 506, and the implementation `DEFAULT_TRIADIC_WEIGHTS` at `src/local/eviction/triadic-scoring-policy.ts` all use `[0.4, 0.2, 0.4]`. The SEPA file drifted at generation time.

**Impact:** zero source-code defect (impl follows the locked plan). The drift only affects future SEPA brief outputs that cite weights — a future reviewer reading SEPA's response might compare against the wrong baseline.

**Recommended owner:** next pass over the SEPA file (e.g., when resolving any future SEPA-flagged finding that touches weights). Single-line fix in two places.

## F2 — Plan T2.1 § Files to edit lists `src/local/eviction/types.ts` (NEW) + `src/local/eviction/index.ts` (NEW) — collapsed at T2.1

T2.1 plan declared a separate types file for `TriadicWeights` + `TriadicConstants` and a barrel `index.ts`. Implementation collapsed both into `triadic-scoring-policy.ts` per KISS/YAGNI (2 small interfaces co-located with their consumer; no second policy ships at T2.1 to justify a barrel).

**Impact:** If T4.2 (long-tail multiplier) or a future v0.5+ policy adds a second `EvictionPolicy` implementation, the split should be revisited.

**Recommended owner:** T4.2 implementer evaluates whether splitting types out makes the multiplier integration cleaner.

## F3.5 — v0.4a CHECK constraint `memories_kind_derived_from_check` missing IS NOT NULL guard for kind='derived' (surfaced at iter 5 / T3.1)

Pre-existing bug surfaced by running the full integration suite. The CHECK constraint is:
```sql
((kind='derived' AND jsonb_array_length(derived_from) >= 1) OR ...)
```
`jsonb_array_length(NULL) IS NULL` evaluates to NULL, and `NULL >= 1` is NULL (unknown). Postgres CHECK constraints treat NULL as PASSING (only FALSE rejects). So an INSERT with `kind='derived', derived_from=NULL` succeeds when the test `kind='derived' with derived_from=NULL violates CHECK` expects it to fail.

**Verified pre-existing:** `git stash` + re-run on 0739d26 reproduced both this failure AND the threshold-policy.test.ts pool setup failure. NOT caused by T3.1.

**Fix:** add explicit `derived_from IS NOT NULL` guard to the kind='derived' arm:
```sql
(kind='derived' AND derived_from IS NOT NULL AND jsonb_array_length(derived_from) >= 1)
```
Requires a new migration `0005_fix_kind_derived_from_check.sql` (DROP + ADD constraint atomically).

**Recommended owner:** next v0.4b iteration that needs to touch v0.4a constraints OR a small follow-up plan.

## F3.6 — `tests/integration/reflection/threshold-policy.test.ts` setup failure: `this.pool.query is not a function` (surfaced at iter 5 / T3.1)

Pre-existing test-setup bug at `PgvectorStore.initialize` line 134; suite fails to bootstrap. Likely a stale fixture pattern; not caused by T3.1 (verified via stash + re-run).

**Recommended owner:** next pass over v0.4a integration test fixtures.

## F3 — Plan T1.1 § Files to edit lists `src/core/dip/index.ts` (UPDATE) — barrel does not exist

T1.1 plan declared adding `export * from './eviction-policy'` to `src/core/dip/index.ts`. That file does NOT exist; established convention re-exports DIPs directly from `src/core/index.ts` (verified against `ReflectionPolicy`, `ScoringStrategy`, `SkillRepresentationStrategy` re-export sites). T1.1 followed convention.

**Impact:** Plan v1.3 (post-cycle) should be patched to point at `src/core/index.ts` to prevent future tasks (T2.1+) re-hitting the same defect during plan re-reads.

**Recommended owner:** post-T8.1 plan archive step OR a 1-line plan patch at the start of the next phase.
