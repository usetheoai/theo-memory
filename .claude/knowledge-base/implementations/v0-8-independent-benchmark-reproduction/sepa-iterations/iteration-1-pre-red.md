# SEPA Pre-RED Brief — iteration 1, T0.1, MODE=VERBOSE

**Task:** T0.1 BenchmarkAdapter Protocol in src/core/dip/benchmark-adapter.ts
**Status:** YELLOW
**Recommendation:** CONTINUE with documented drift

## Findings

### Item 1: Plan recap ✓ verified

### Item 2: EC-5 absorption verified ✓ (speaker?/expectedSpeakers? declared correctly)

### Item 3: TypeScript type design check GREEN
- All fields readonly ✓
- `unknown` not `any` ✓
- `BenchmarkAdapter.name: string` (deferred-literal-union per OCP — open-set adapter discipline) ✓
- No `src/local/` or `src/cloud/` imports ✓

### Item 4: Precedent locus fit GREEN
- src/core/dip/ has 9 sibling DIPs (conflict-resolution-policy.ts most recent v0.7 precedent)
- BenchmarkAdapter is the 10th DIP

### Item 5: CRITICAL plan-vs-reality drift (RED finding)

Plan v1.2 line 240 + 321 declare `src/core/dip/index.ts` re-export, but **this file does NOT exist**. v0.7 ConflictResolutionPolicy precedent re-exports through `src/core/index.ts` (lines 115-119), not through a `src/core/dip/` barrel.

**Resolution: Option A (recommended)** — append re-export to existing `src/core/index.ts` mirroring v0.7 pattern. Document drift in implementation md.

### Item 5b: vitest.contract.config.ts include update
- Existing glob already covers test-d via `src/{core,theokit}/**/__tests__/**/*.test-d.ts`
- `src/benchmarks/**/__tests__/**/*.test.ts` glob update for Phase 1+ — land in T0.1 per plan letter (Option A, zero-risk)

### Item 6: JSDoc citation requirements verified
- Top-of-file `@see plan T0.1` + ADRs D1/D5/D6
- BenchmarkCorpusItem.speaker JSDoc cites EC-5 + LongMemEval/LoCoMo rationale
- BenchmarkQuery.expectedSpeakers JSDoc cites EC-5
- SearchResult.tokensUsed cites ADR D7
- AddMetrics.latencyMs notes ADR D8 OTel
- BenchmarkAdapter interface JSDoc cites ADR D6 (NOT inheriting MemoryStore)
- Forbidden: paper-name strings in JSDoc bodies; canonical benchmark names (LongMemEval/LoCoMo/DMR) OK only in `@see` references to plan/knowledge-base

## Wiring triad — pre-COMMIT
- Pillar (a): N/A at T0.1 (DIP declaration phase; first caller arrives T3.1). ADR-DEFER-WIRING-A marker in implementation md.
- Pillar (b): test-d typecheck conformance + future Phase 3 integration
- Pillar (c): n/a for types-only

## Drift to document
Plan v1.2 line 240 + 321 reference `src/core/dip/index.ts` which does not exist. Followed v0.7 precedent (re-export via `src/core/index.ts`). Documented in implementation md T0.1 entry.
