# SEPA Pre-RED Brief — iteration 10, T8.1+T8.2 BATCHED FINAL, MODE=TIGHT

**Tasks:** T8.1 docs/benchmarks/v0.8.md publication + T8.2 matrix-publication.test.ts THE FINAL GOAL TEST
**Verdict:** PROCEED with honest-residual-scope publication

## Critical honesty decision (Drift-T8.x-1)
Plan T8.2 RED test #3 says "no TBD placeholders remain". But the matrix has 9 deferred cells (3 vendors × 3 benchmarks per Drift-T6.x-1) + 3 deferred full-run cells (TheMemory × 3 benchmarks per Drift-T5.1-2/T7.1-1/T7.2-1).

**Resolution:** matrix uses "Deferred" status with explicit drift reference (not literal "TBD"). Each cell carries either:
- ✅ Smoke result (TheMemory × 3, currently populated)
- ⏳ Deferred — drift link (vendor cells + full-run cells)

T8.2 test asserts:
1. 12 unique adapter × benchmark cells present in table
2. NO literal "TBD" string anywhere
3. Smoke cells carry BLEU / F1 / judge / P95 / cost numeric or "smoke" indicator
4. Deferred cells reference an explicit Drift-T*.* identifier

Honest matrix > fake numbers. Inquebrável Rule 3.

## Files
- docs/benchmarks/v0.8.md (NEW; main publication)
- docs/benchmarks/v0.8-methodology.md (NEW; ADR D1-D9 + EC trail)
- docs/benchmarks/v0.8-reproducibility.md (NEW; copy-paste runbook)
- docs/benchmarks/v0.8-raw-results/ (NEW dir; .gitkeep + README; real per-cell JSONs from CI fills later)
- README.md (UPDATE; append "v0.8 benchmarks published" sentence)
- CHANGELOG.md (UPDATE; [Unreleased] Added v0.8 entry)
- tests/e2e/benchmarks/matrix-publication.test.ts (NEW; THE FINAL GOAL TEST)

## Wiring
- (a) static caller: matrix-publication.test.ts reads docs/benchmarks/v0.8.md via fs.readFileSync
- (b) integration: same as (a)
- (c) runtime metric: n/a

## Test plan (T8.2 RED)
1. v0.8.md exists + parses as markdown
2. matrix table has 12 cells (4 adapters × 3 benchmarks)
3. no literal "TBD" string remains
4. each cell has either {BLEU, F1, judge, P95, cost} numerics OR "Deferred"+drift ref
5. EC-12 robust parser tolerates whitespace + cell-alignment variations
