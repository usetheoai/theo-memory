# Review: memory-contract-v0-0

**Date:** 2026-05-22
**Verdict:** READY_TO_MERGE
**Reviewers (spawned agents):** 5 (architecture, cross-validation, review-memory-contract-v0-0-domain-memory-layer, tests, review-memory-contract-v0-0-wiring)
**Total findings:** 10

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 0 |
| MAJOR | 0 |
| MINOR | 0 |
| INFO | 10 |

## INFO findings (10)

### F-wire-1: Barrel re-export is the load-bearing wiring for v0.0

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/index.ts`
- **Plan reference:** Plan § Objective Sub-goal 1
- **Evidence:**

  src/core/index.ts re-exports all 29 public contract symbols.
  package.json#exports./contract points to src/core/index.ts for both types and default.
  All tests import via the public path (@usetheo/memory/contract), not from private modules.


### F-wire-2: Memory (public interface) wired through barrel + 36 barrel tests

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/memory-store.ts`
- **Plan reference:** Plan § T2.5 centerpiece + T4.1 barrel
- **Evidence:**

  Memory exported from memory-store.ts; re-exported in barrel.
  36 tests in index.test-d.ts verify barrel import + type narrowing.
  Consumer signature verified:
    type ConsumerFlow = (factory: CreateMemoryFactory) => Promise<readonly MemoryItem[]>
    const memory = factory(config); memory.user('alice').remember('text');
  Type narrowing (memory.user(id) returns User-scoped type) asserted via expectTypeOf.


### F-wire-3: Embedder DIP interface + 5 type-level tests

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/dip/embedder.ts`
- **Plan reference:** Plan § D8 DIP method counts
- **Evidence:**

  Embedder exported from dip/embedder.ts; re-exported in barrel.
  5 type-level tests in embedder.test-d.ts verify interface shape (3 required methods).
  Used in: memory-store tests (synthetic stub implementation), memory-item tests.
  No orphan exports; no unused methods in interface.


### F-wire-4: HistoryManager DIP + 10 integration tests

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/dip/history-manager.ts`
- **Plan reference:** Plan § D8 DIP method counts (4 methods)
- **Evidence:**

  HistoryManager exported; re-exported in barrel.
  4 type-level tests verify interface shape.
  10 runtime tests in dip/history-manager.test.ts verify batch record contract.
  Used in: memory-store composition tests.


### F-wire-5: ReflectionPolicy + ManualReflectionPolicy (strategy pattern) wired

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/dip/reflection-policy.ts`
- **Plan reference:** Plan § D5 (reflection trigger ADR) + D8
- **Evidence:**

  ReflectionPolicy, ReflectionTrigger, ManualReflectionPolicy exported; re-exported in barrel.
  4 type-level tests verify interface + union shapes.
  Used in: MemoryConfig composition, memory-store tests.
  Strategy pattern for reflection triggers locked per ADR-0005.


### F-wire-6: Config types exported; both tested via package.json#exports mapping

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/memory-store.ts`
- **Plan reference:** Plan § T2.5 + EC-1 (config variant designs)
- **Evidence:**

  MemoryConfig (local) and CloudMemoryConfig (TheoCloud) defined in memory-store.ts.
  Both re-exported in barrel.
  index.test.ts verifies package.json exports (EC-3 gate) points to both.
  Type-level tests verify MemoryConfig required fields + CloudMemoryConfig optionals.


### F-wire-7: 5 domain errors exported; runtime tests verify instanceof + prototype chain

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/errors.ts`
- **Plan reference:** Plan § T2.4 + EC-2 (Object.setPrototypeOf)
- **Evidence:**

  BiTemporalNotSupportedLocally, EmbeddingMismatch, InvalidScope,
  MemoryNotFound, ReflectionNotConfigured all defined as Error subclasses.
  All re-exported in barrel.
  8 runtime tests in errors.test.ts verify:
    - Each error is instanceof Error
    - Object.setPrototypeOf correctly chains prototype
    - Error messages contain expected text
    - Each error is thrown where documented
  No silent error swallowing; all errors propagate.


### F-wire-8: RememberOptions, RecallOptions, ForgetOptions, etc. tested + documented

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/options.ts`
- **Plan reference:** Plan § T2.3
- **Evidence:**

  All 5 options types exported from options.ts; re-exported in barrel.
  3 type-level tests verify option shapes (required/optional fields).
  10 runtime tests in options.test.ts verify:
    - asOf JSDoc is present (EC-5 gate)
    - GetAllOptions.scope is narrowed to UserScope | SessionScope | AgentScope
    - No fabricated options; all tests exercise real fields


### F-wire-9: Barrel completeness test + package.json#exports mapping gates

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/__tests__/index.test.ts`
- **Plan reference:** Plan § Global DoD — test coverage 100% critical paths
- **Evidence:**

  Line 56-76: barrel re-exports completeness test validates all 13 modules present.
  Line 21-52: EC-3 gate (package.json#exports./contract.default not null).
  Tests verify:
    - exports./contract exists
    - types and default both point to src/core/index.ts (not null)
    - _v0_0_exports_preview_only flag set (self-documenting v0.0 status)
    - no "." entry in exports (locks accidental default import)


### F-wire-10: Type narrowing verified: memory.user(id) returns User-scoped type

- **Found by:** review-memory-contract-v0-0-wiring
- **File:** `src/core/__tests__/index.test-d.ts`
- **Plan reference:** Plan § Sub-goal 5 (type-level invariants)
- **Evidence:**

  Line 101-116: synthetic consumer signature tests the intended DX.
  expectTypeOf verifies scope narrowing works end-to-end.
  Type inference from factory(config).user('alice').remember(...) narrows
  correctly to UserScope (not global Memory).



## Handoff decision

Implementation passes all gates. Ready for merge.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-memory-contract-v0-0-2026-05-22/architecture.md`
- `.claude/agents/review-memory-contract-v0-0-2026-05-22/cross-validation.md`
- `.claude/agents/review-memory-contract-v0-0-2026-05-22/review-memory-contract-v0-0-domain-memory-layer.md`
- `.claude/agents/review-memory-contract-v0-0-2026-05-22/tests.md`
- `.claude/agents/review-memory-contract-v0-0-2026-05-22/review-memory-contract-v0-0-wiring.md`
