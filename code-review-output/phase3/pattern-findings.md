# Phase 3 — Design Pattern Analysis

**Date:** 2026-06-10
**Target:** `src/` (production code only, excluding `__tests__`)
**Scope:** 7 canonical patterns evaluated against 13 declared DIP interfaces

---

## Executive Summary

The codebase claims vector-based hybrid architecture with 13 dependency-inversion interfaces. **That claim is validated.** The DIP layer (`src/core/dip/`) is well-structured: each interface has a clear contract, method counts respect ADR-0008 caps, and multiple concrete implementations exist for the high-traffic DIPs (Embedder: 3, LLM: 2, ReflectionPolicy: 3, ConflictResolutionPolicy: 3).

Three medium-severity suggestions surface opportunities to tighten the pattern application. None are blocking; all are incremental improvements to an already-sound architecture.

| Verdict | Count |
|---------|-------|
| applied_correctly | 2 (Strategy, Observer) |
| applied_correctly_with_caveat | 1 (Factory) |
| missing (opportunity) | 2 (Repository extension interfaces, Value Object for MemoryItem) |
| misapplied | 0 |
| over_engineered | 0 |
| not_applicable | 2 (Mediator, Builder) |

---

## Finding 1 — Strategy: Applied Correctly

**Severity:** low | **Verdict:** applied_correctly | **DB ID:** 41

The 13 DIP interfaces in `src/core/dip/` implement the Strategy pattern correctly via TypeScript interfaces with `kind` discriminators. The factory (`createLocalMemory`) wires concrete implementations at construction time. Multiple implementations exist per DIP where variability is needed.

**Structural signals present:**
- Each interface defines a contract with 1-11 methods per ADR-0008 caps
- Factory wires concrete impls at construction, not at call-time
- `kind` discriminator on ReflectionPolicy, EvictionPolicy, ConflictResolutionPolicy enables runtime dispatch

**Files:** `src/core/dip/*.ts` (13 files)

**No action needed.**

---

## Finding 2 — Repository: Duck-Typed Extensions Bypass the DIP Boundary

**Severity:** medium | **Verdict:** missing (partial) | **DB ID:** 42

`VectorStore` acts as the Repository for memory persistence (11 methods covering CRUD + search). However, skill-write and consolidation operations live as duck-typed extensions on the concrete `PgvectorStore`, accessed via unsafe `as unknown as` casts.

**Structural signals (2 of 3 present):**
1. Three ad-hoc interfaces (`VectorStoreWithDerivedInsert`, `VectorStoreWithConsolidation`, `VectorStoreWithSkillInsert`) defined locally in the factory file or `skill-store-args.ts` — not in `src/core/dip/`
2. Runtime `typeof` guards replace compile-time contract enforcement
3. Same `config.vectorStore` cast to 3 different shapes within one file

**Key locations:**
- `src/local/index.ts:695` — `as unknown as VectorStoreWithConsolidation`
- `src/local/index.ts:745` — `as unknown as VectorStoreWithDerivedInsert`
- `src/local/index.ts:1034` — `as VectorStore & VectorStoreWithSkillInsert`

**Remediation:** Promote the ad-hoc interfaces to `src/core/dip/` as named extension interfaces, or split VectorStore into role interfaces per ISP (base ReadWriteStore, DerivedMemoryStore, ConsolidationStore). This eliminates the unsafe casts and makes extension methods part of the DIP contract.

---

## Finding 3 — Factory: Well-Structured but Coupled via instanceof

**Severity:** medium | **Verdict:** applied_correctly_with_caveat | **DB ID:** 43

`createLocalMemory` is a proper async factory: it probes embedder dim, validates config, resolves optional subsystems (eviction, cache), and wires DIPs into a `LocalMemory` instance. The MCP dispatch (`src/agent-tools/tools/dispatch.ts`) uses a `Map<string, HandlerFn>` registry — a clean Strategy/Command pattern.

However, the factory contains 3 `instanceof PgvectorStoreClass` checks that couple the factory to a concrete implementation:

| Line | Purpose |
|------|---------|
| 448 | Cache validation — reject non-Pg stores |
| 945 | Forget — soft-delete (Pg) vs hard-delete (InMemory) |
| 1152 | Eviction — reject non-Pg stores |

Each check delivers fundamentally different behavior based on class identity rather than a DIP-declared capability.

**Remediation:** Extract capability-query interfaces (e.g., `SoftDeletable`, `PoolProvider`) so the factory checks interface shape rather than class identity.

---

## Finding 4 — Observer: Applied Correctly

**Severity:** low | **Verdict:** applied_correctly | **DB ID:** 44

The Observer/event-emission pattern uses a 17-event union type `MEMORY_EVENTS` with a single `emitEvent` function wrapping OTel spans. Events are produced at pipeline phase boundaries. The event vocabulary is a compile-time `const` tuple — intentional for audit safety.

Cache invalidation in `LocalScopedMemory.remember/forget/reflect` is imperative (sequential `await`) rather than event-driven. This is the correct choice given the consistency requirement (prevent stale cache serving between write and next read).

**Files:** `src/core/memory-event.ts`, consumption sites throughout `src/local/index.ts`

**No action needed.**

---

## Finding 5 — Value Object: MemoryItem Lacks Construction Centralization

**Severity:** medium | **Verdict:** missing (opportunity) | **DB ID:** 45

`Scope` is correctly modeled as a discriminated union with exhaustive `switch` coverage at 10+ call sites. `MemoryItem`, however, is a 16-field plain interface constructed ad-hoc at 4+ sites with inconsistent field population.

**Structural signals (2 of 3 present):**
1. Same tuple of 16 fields passed through 7+ function boundaries (pipeline output, cache, REST, MCP, recall scoring, eviction scoring, reflection input)
2. Construction invariants enforced by convention (tValid mirrors createdAt for new rows; confirmationCount defaults differ by adapter; createdAt fallback to `new Date()` on adapter miss)

**Key construction sites with divergent logic:**
- `src/local/index.ts:652` — reflect: `tValid: new Date(), tInvalid: null`
- `src/local/index.ts:834` — getAll: `tValid: createdAt, tInvalid: null` (with adapter fallback)
- `src/local/index.ts:989` — get: `tValid: new Date(), tInvalid: null`

**Remediation:** Extract a `buildMemoryItem(from: VectorStoreResult, scope: Scope): MemoryItem` factory function in `src/core/` to centralize field-population logic. This eliminates construction drift as new fields are added to MemoryItem.

---

## Patterns Not Applicable

### Mediator
The codebase does not have a mediator shape. `createLocalMemory` is a factory, not a mediator — it wires DIPs at construction and does not coordinate runtime interactions between peers. The extraction pipeline (`src/core/extraction/pipeline.ts`) is a sequential pipeline, not a hub. No structural signals for Mediator were found.

### Builder
`MemoryConfig` has 7 fields (3 required, 4 optional). `LocalMemoryConfig` extends it with 4 more optional fields. `RecallOptions` has 6 optional fields. None of these cross the Builder threshold (>4 optional parameters AND repeated in 2+ sites AND chained setter pattern). The codebase uses plain object literals passed to the factory — appropriate for the current field count.

---

## DIP Claim Validation

The CLAUDE.md claims 13 DIPs. Verified inventory:

| # | DIP | File | Method Count | Impls Found |
|---|-----|------|-------------|-------------|
| 1 | Embedder | embedder.ts | 2 | OpenAIEmbedder, LocalTransformerEmbedder, StubEmbedder |
| 2 | LLM | llm.ts | 2 | OpenAILLM, StubLLM |
| 3 | VectorStore | vector-store.ts | 11 | PgvectorStore, InMemoryVectorStore |
| 4 | HistoryManager | history-manager.ts | 4+3 opt | DrizzleHistoryManager |
| 5 | ReflectionPolicy | reflection-policy.ts | 1+2 opt | Manual, Threshold, SleepTime |
| 6 | ScoringStrategy | scoring-strategy.ts | 1 | AdditiveWeightedScoring |
| 7 | SkillRepresentationStrategy | skill-representation-strategy.ts | 3 | (slot only; no impl at v0.6) |
| 8 | EvictionPolicy | eviction-policy.ts | 2+2 opt | TriadicScoringPolicy |
| 9 | ConflictResolutionPolicy | conflict-resolution-policy.ts | 1+1 disc | Noop, LastWriteWins, LlmJudgedMerge |
| 10 | BenchmarkAdapter | benchmark-adapter.ts | (not examined) | 4 adapters per CLAUDE.md |
| 11 | Tokenizer | tokenizer.ts | (not examined) | - |
| 12 | AuthVerifier | auth-verifier.ts | 1 | BearerAuthVerifier, ApiKeyAuthVerifier, OidcAuthVerifier |
| 13 | RecallCacheStore | recall-cache-store.ts | 4 | PgvectorRecallCacheStore |

**Claim validated.** 13 DIP interfaces exist. Method counts align with ADR-0008 declarations. The DIP boundary (`src/core/` does not import `src/local/`) is respected — with the caveat that 3 ad-hoc extension interfaces bypass the boundary via duck-typing (Finding 2).
