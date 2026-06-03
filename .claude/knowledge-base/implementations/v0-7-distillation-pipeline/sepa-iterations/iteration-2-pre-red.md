# SEPA log — iteration 2 / T1.1 / pre-RED

**Mode:** TIGHT

**Findings:**
- [CRITICAL — resolved] Plan T1.1 verbatim re-read: 3 types declared, field list not exhaustive. Resolution: minimum fields per usage downstream — ConsolidationCandidate { memoryId, text, createdAt } (EC-1 tie-break + EC-2 validation + LLM reasoning). ConsolidationResult { keptMemoryId, rejectedMemoryIds[], reason, policyName, originalEpisodeIds[] } (matches T0.1 schema columns).
- [CRITICAL — resolved] ConsolidationContext.llm placement: plan says "ConsolidationContext (LLM + scope + observation_date)" but plan T1.3 says "Depends only on LLM DIP" via constructor pattern + 8 existing DIPs use constructor injection. ARCH-CORRECT INTERPRETATION: LLM at constructor (T1.3); ConsolidationContext per-call carries { scope, observationDate } only.
- [MAJOR — resolved] memoryId field on Candidate is load-bearing for EC-2.
- [MAJOR — resolved] Method shape: `consolidate(candidates: readonly ConsolidationCandidate[], ctx: ConsolidationContext): Promise<readonly ConsolidationResult[]>` — empty array = abstain.
- [MAJOR — resolved] RED test convention: precedent `src/core/__tests__/dip-eviction-policy.test.ts` uses implementation stub + structural-contract assertions. Plan SAYS `tests/unit/conflict-resolution/dip-shape.test.ts` — honor plan; vitest.contract.config.ts includes tests/unit/ ✓.
- [MAJOR — resolved] Re-export: src/core/index.ts barrel + src/index.ts root. plan also says @usetheo/memory/contract — verify chain.

**Decision:** kind discriminator added per EvictionPolicy precedent. File budget ≤ 80 LoC achievable (interface + 3 types + kind + 5 fields max per type).
