# SEPA — Iteration 10 / T6.1 / pre-COMMIT / MODE=self-audit-consolidated

## Self-audit

T6.1 ships the `evict()` orchestrator + EvictionResult contract + OTel counter wiring. Three concerns absorbed:

1. **Plan EC-4 cites `src/local/telemetry.ts` as meter source — that file does not exist in v0.1.** Resolved by using `metrics.getMeter('@usetheo/memory')` directly from `@opentelemetry/api` (already a project dep). No new file; production telemetry works when consumer registers a MeterProvider.
2. **No `@opentelemetry/sdk-metrics` dep for in-memory exporter test.** Resolved via dual-channel emission: the OTel counter emits unconditionally via the api meter (no-op without a registered provider) AND an optional `onSoftDelete?: (count, attrs) => void` test hook provides deterministic verification. Tests use the hook; production telemetry uses the OTel meter.
3. **search() + keywordSearch() in pgvector-store didn't filter `t_invalid IS NULL`.** v0.1 used physical `DELETE` for `forget()`, so the gap was latent. T6.1 introduces soft-delete via `t_invalid` — added the filter to both queries so recall hides soft-deleted rows per plan T6.1 RED #4. NULL is the default for newly-inserted rows, so the filter is a no-op for active memories — zero regression to v0.4a/v0.6 tests.

## Findings

- ✓ PgEvictor: single UPDATE with `WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL RETURNING id` distinguishes softDeleted vs alreadyInvalid via RETURNING set
- ✓ EC-10 absorbed: empty input array short-circuits without SQL roundtrip
- ✓ EC-4 absorbed: OTel counter `theo.memory.eviction.soft_deletes_total` with attribute `{ policy: 'triadic_scoring' }`; test hook channel verifies count emission
- ✓ Never physical DELETE per ADR D17; audit query `WHERE t_invalid IS NOT NULL` confirms rows persist
- ✓ recall() (PgvectorStore.search + keywordSearch) now filters `t_invalid IS NULL`
- ✓ TriadicScoringPolicy gains 5th optional constructor param `evictor` + public `evict(memoryIds)` method
- ✓ Paper-name scan clean
- ✓ Module-level `meter.createCounter(...)` runs once at import; `add()` is per-call (no leak)
- ✓ Backward compat: when evictor=null, evict() returns empty result; existing T2.1 + T2.2 tests unchanged

## Test results

- 7/7 GREEN: soft-delete, distinguishes-already-invalid, never-physical-delete, recall-filters-out-soft-deleted, audit-query-returns, EC-10 empty-array, EC-4 counter-via-test-hook
- 520/522 contract suite green (no regression)
- 36/36 v0.4b integration suite across 7 files (lazy-half-life + recall-bookkeeping + nearest-neighbor + multiplier + capacity-trigger + time-trigger + evict-soft-delete)
- Lint clean, typecheck clean, boundary clean

## Wiring triad

- (a) DEFER-foundation: policy.evict() has no production caller yet. T7.1 + T7.2 (acceptance tests) are the canonical callers via the full eviction pipeline. T5.1+T5.2 still do their own in-tx UPDATEs (intentional: advisory-lock scope requires same-tx UPDATE). The F4 DRY followup is partially addressed via the unified Evictor interface but the tx-boundary constraint makes direct trigger→policy.evict refactor non-trivial — deferred.
- (b) PASS: 7 integration tests cover all contract surfaces
- (c) PASS: counter `theo.memory.eviction.soft_deletes_total` emission verified via test hook AND structurally present via metrics.getMeter call. T7.1+T8.1 will re-observe via the actual triadic-eviction goal test.

## Followups

F4 (DRY rowToMemoryItem dup across T5.1+T5.2) — UPDATED: PgEvictor consolidates the soft-delete UPDATE+RETURNING but the candidate-loading SELECTs in the triggers remain duplicated. Cross-tx refactor (triggers calling policy.evict outside their advisory-lock tx) defeats the EC-2 serialization. Decision: keep current shape; F4 closed as accepted-divergence per architectural-tradeoff (advisory-lock atomicity > zero duplication).

## Verdict

READY to ship.
