# SEPA — Iteration 2 / Task T2.1 / Phase pre-COMMIT (VERBOSE)

## Verdict: APPROVE COMMIT after 3 corrections applied

## Findings
- [MAJOR] Commit subject MUST honor plan-locked DoD string: `feat(local): PgvectorStore.list projects created_at + EC-1 null-safe + EC-2 deterministic ORDER BY (T2.1)`. Original draft used `feat(pgvector): project created_at + flip list() ORDER BY DESC,id ASC (T2.1)` — diverges from plan-contract.
- [MINOR] Hoist PRIORITY 0 attestation to labelled header near body top.
- [ACCEPTANCE #5] EXPLAIN ANALYZE evidence: captured post-fix as `Limit → Sort (created_at DESC, id) → Seq Scan` — identical class to pre-fix `Limit → Sort (created_at ASC) → Seq Scan`. Same Sort node + same Seq Scan; only sort direction + composite key added. Zero plan regression. Attested inline.

## DoD checkbox audit (after corrections)
| # | Criterion | State |
|---|---|---|
| 1 | list returns VectorStoreResult.createdAt per row | PASS |
| 2 | EC-1 NULL → undefined, NOT new Date(0) | PASS |
| 3 | EC-2 ORDER BY created_at DESC, id ASC + 5-call determinism | PASS |
| 4 | Integration test PASS against real PG | PASS |
| 5 | EXPLAIN ANALYZE no plan regression | PASS (attested inline + captured in pre-commit log) |
| 6 | Pass lint + typecheck | PASS |

## Wiring triad
- (a) PASS — existing callers in src/local/index.ts + consolidate.ts + extraction/pipeline.ts
- (b) PASS — 3 integration tests at tests/integration/pgvector-store-list-temporal.test.ts
- (c) N/A — consumer OTel `getall_temporal_fallback{count}` deferred to T2.2 per ADR D2

## EXPLAIN ANALYZE evidence (captured 2026-06-09)
```
Limit  (cost=15.86..16.11 rows=100 width=484) (actual time=0.591..0.593 rows=0 loops=1)
  ->  Sort  (cost=15.86..16.19 rows=130 width=484) (actual time=0.586..0.587 rows=0 loops=1)
        Sort Key: created_at DESC, id
        Sort Method: quicksort  Memory: 25kB
        ->  Seq Scan on memories  (cost=0.00..11.30 rows=130 width=484) (actual time=0.015..0.016 rows=0 loops=1)
Planning Time: 19.275 ms / Execution Time: 1.434 ms
```
Pre-fix shape (current ASC ordering): identical Seq Scan + Sort + Limit chain; only Sort Key differs (ASC → DESC + id ASC tiebreak). No index on (created_at, id); composite key adds zero cost to the existing in-memory quicksort.

## SEPA emission
`SEPA verdict: APPROVE-AFTER-CORRECTIONS | T2.1 | pre-COMMIT | 6/6 DoD | wiring: a=pass b=pass c=n/a | gates: typecheck=0 lint=0 vitest-full=1194pass | scope: D5-clean | EXPLAIN: no regression`
