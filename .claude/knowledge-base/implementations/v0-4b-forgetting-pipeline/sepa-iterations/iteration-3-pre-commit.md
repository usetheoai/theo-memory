# SEPA — Iteration 3 / T2.1 / pre-COMMIT / MODE=VERBOSE (consolidated)

## Findings (verbatim summary from SEPA)

### CRITICAL — NONE

Math-typo absorption matches T0.1/T1.1 precedent (plan-internally-inconsistent vs adjacent RED test names → inline correction defensible; Stop Condition #4 is reserved for "behavior contradicted by reality", not single-character sign-error in adjacent prose).

### MAJOR — 4 surfaced, 2 FIXED inline + 2 deferred to followups

- **MAJOR-1 (Wiring (a) classification)** — FIXED: reclassified to `a=defer-foundation` matching T1.1 precedent. The 3 callers reported by `check_wiring.py` include 2 JSDoc-only mentions; no real production read/write consumer exists yet (T6.1 evict() impl is the canonical caller). Honest classification: defer-foundation. Wiring summary in commit body updated.
- **MAJOR-2 (Plan deviation link to wiring)** — FIXED via commit body wording: notes that the types.ts + index.ts collapse means there's no separate barrel to count as a caller, reinforcing the (a)=defer-foundation classification.
- **MAJOR-3 (SEPA agent file weights drift)** — DEFERRED to followup: SEPA file frontmatter declares default weights `[0.4, 0.3, 0.3]` but the locked plan + blueprint + impl all use `[0.4, 0.2, 0.4]`. Out of scope for T2.1 commit (no source code defect). Will be noted in followups when count grows.
- **MAJOR-4 (Paper-name `Generative-Agents` in JSDoc)** — FIXED inline: removed; replaced with neutral wording `"NOT multiplicative scoring shape (per blueprint D8 rationale)"` per `no-paper-names-in-code.md`. Tests still pass post-edit.

### MINOR — accepted

- MemoryItem extension backward-compatible (all 4 fields optional + nullable; matches v0.6 RepoScope precedent).
- `async score()` has `await Promise.resolve();` as TS-ergonomics no-op; T4.2 long-tail multiplier will land the actual async work.
- `selectVictims` sorts a fresh array from `Promise.all`; no mutation of readonly input.
- 15 tests = 11 plan-declared + 4 bonus (2 defaults contract + 2 boundary verifications). Surplus protects exported public surface; no scope creep.

### DoD verification

- 15/15 RED → GREEN ✓
- 520/522 contract suite ✓
- 0 typecheck errors ✓ (memory-item.test-d.ts shape regression updated)
- Lint clean ✓
- DIP boundary clean (no src/local/eviction/* imports from cloud; only ../../core/* imports) ✓
- Complexity ≤ 10 per helper (each is ≤ 6 LoC of body) ✓
- Coverage on critical path: 100% (15 tests exercise all 4 helpers + class methods + error paths) ✓
- Size: ~165 LoC impl, ~155 LoC test, ~34 LoC memory-item.ts addition — within budgets ✓

## Verdict

READY to ship after the two inline fixes (MAJOR-1 wiring reclassification + MAJOR-4 paper-name removal). MAJOR-3 SEPA file weights drift goes to followups (zero source code impact).
