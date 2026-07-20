# SEPA pre-COMMIT — iteration 3 / T2.1 (2026-07-20)

Verdict: PROCEED_WITH_NOTES. 9/9 audit checks PASS: SQL fully parameterized (injection-safe); multi-row param indexing correct ($base+1..+10); cap + empty no-op (EC-1); toRow coercion (real→number, composite number|null EC-6, created_at→Date); DIP boundary clean (imports only domain contract); bundle isolation (default barrel has ZERO recall-trace refs — only the subpath exposes the impl); package.json/alias mirror cache-pg; raw Pool + unknown[] acceptable per pg-usage-counter-store precedent.

Notes (carried forward):
- MEDIUM — constructor does not validate config → T4.1 factory MUST validate before construction (logged in followups).
- MEDIUM — CHANGELOG not staged → RESOLVED (fix commit 9a5a0dd adds the [Unreleased] entry).
- impl-before-test: ACCEPT with note (infra adapter over a RED-first contract; integration test exercises real behavior). RED-first recommended for remaining infra tasks.

Post-SEPA defect I caught myself: the round-trip test was flaky (positional assertion on non-insertion-order rows) → fixed order-independent in 9a5a0dd.
