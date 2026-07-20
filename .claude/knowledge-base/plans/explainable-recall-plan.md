# Plan: Explainable Recall (accountable forgetting — Slice 1)

> **Version 1.2** — Ship the write-side foundation of the "accountable forgetting" differentiator: an opt-in `RecallTraceStore` DIP + a queryable `recall_traces` Postgres table that persists, per recall, one row per DROPPED candidate (sub-threshold or MMR) with its component-score breakdown, threshold, and drop-reason, keyed by a server-generated `recall_id`. This is Slice 1 (S1) of the blueprint; S2 (`explain(recallId)` read surface) reads what S1 persists. Expected outcome: with tracing enabled, every recall's negative-space becomes a set of queryable rows — the "why we dropped it" that no competitor persists.

## Goal

> "Enable operators to see WHY each recall candidate was dropped by adding an opt-in `RecallTraceStore` DIP that persists one `recall_traces` row per dropped candidate (semantic/bm25/entity breakdown + threshold + drop-reason, keyed by `recall_id`), measured by an integration test against real `ankane/pgvector:v0.5.1` where a recall dropping ≥1 candidate writes the matching rows retrievable by `recall_id`, and a recall dropping 0 candidates writes 0 rows."

## Context

The "accountable forgetting" differentiator (blueprint `knowledge-base/discoveries/blueprints/accountable-forgetting-blueprint.md`, `/discover-confidence` SHIPPABLE_WITH_CAVEATS 89) established that the unique, defensible surface is the **negative-space of memory**: what recall ignored/dropped and *why*. The blueprint proved (with SOTA code) that Graphiti and Mem0 both **discard the reason** for a drop (Graphiti keeps only timestamps; Mem0 keeps action but not rationale; `NONE` is invisible) and OpenMemory hides the negative-space entirely (`memories.py:277` drops non-ADD events; `:129-130` filters reads).

**v1.2 (2026-07-20)** — TDD RED lines rewritten to executable `test_<behavior>` shape (implement-side shape gate). **v1.1** — absorbs 3 MUST FIX from `/edge-case-plan` (`knowledge-base/reviews/explainable-recall-edge-cases-2026-07-20.md`): EC-1 (cap `maxRowsPerRecall` to guard the Postgres 65535 bind-param limit → T0.1 validator), EC-2 (thread `workspaceId`+`scopeKey` via a single `recallTraceContext` field on `RetrievalDeps` → D1, T3.1, T4.1), EC-3 (probe `recall_traces` at resolve time → fail-fast instead of silent-no-trace → T4.1). SHOULD-TEST items EC-4 (truncation signal), EC-5 (partial-context gate), EC-6 (null-composite round-trip) folded into the respective TDD blocks.

Scope for THIS plan is fixed by the grill `knowledge-base/grills/explainable-recall-grill.md` (6 decisions, verdict READY_FOR_PLAN): Slice 1 = the **recall-time** write-side only (persist the reason + a recall trace), core-only, opt-in via factory, into a dedicated queryable table behind a DIP. The `explain()`/`replay()` read surface (S2), edge-supersession (S3, blueprint ADR D1), and the write-time trace (dedup/zero-facts, S1b) are explicitly out of scope.

The three IGNORE events already exist in-code (`packages/core/src/domain/memory-event.ts:46` `recall_threshold_filtered`) but carry only aggregate counts — the per-candidate reason is discarded at the pipeline's `continue` statements. This plan closes that gap for the recall path.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/dip/recall-trace-store.ts` (NEW) | 0 | — | (new DIP contract) | — |
| `packages/core/src/infrastructure/db/recall-trace/pg-recall-trace-store.ts` (NEW) | 0 | — | (new pg impl) | — |
| `packages/core/src/infrastructure/db/recall-trace/index.ts` (NEW) | 0 | — | (new subpath barrel) | — |
| `packages/core/src/infrastructure/db/migrations/0023_recall_traces.sql` (NEW) | 0 | — | (new migration) | — |
| `packages/core/src/infrastructure/db/schema.ts` | 684 | `23e97f8` (2026-07-16) | Single drizzle schema aggregate; tables `recallCache` (`:521-549`), `scopeUsageCounters` (`:665-684`) | Existing table defs unchanged; new table additive only |
| `packages/core/src/domain/retrieval/pipeline.ts` | 520 | `23e97f8` (2026-07-16) | 9-step hybrid search; `runRetrievalPipeline` (`:311`), `RetrievalDeps` (`:39-63`), `filterAtThreshold` (`:130-150`) | MUST keep returning bare `readonly MemoryItemWithScore[]` (`:311`); trace write is side-effect only, never alters the returned set |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 541 | `23e97f8` (2026-07-16) | `LocalScopedMemory.recall` (`:269`), `retrieveResults` (`:302`) assembles `RetrievalDeps` (`:361-366`) | `recall()` return contract unchanged (bare array); fail-soft side-effect precedent at `:288-297` |
| `packages/core/src/domain/memory-event.ts` | 197 | `23e97f8` (2026-07-16) | `MEMORY_EVENTS` typed union (`:15-172`) + `emitEvent` (`:181`); `recall_threshold_filtered` (`:46`) | Existing 16 literals unchanged; new event literals additive only |
| `packages/core/src/infrastructure/db/factory.ts` | 300 | `23e97f8` (2026-07-16) | `createLocalMemory` (`:154`); `resolveRecallCacheStore` opt-in (`:67-105`, called `:212`) | Opt-in default-OFF; no behavior change when `recallTrace` absent |
| `packages/core/src/infrastructure/db/config.ts` | (see repo) | `23e97f8` (2026-07-16) | `LocalMemoryConfig`; `recallCache?` field (`:120`) | Additive optional field only; existing fields unchanged |
| `packages/core/src/domain/index.ts` | 570 | `283fbc2` (2026-07-16) | `@usetheo/memory/contract` barrel; re-exports RecallCacheStore types (`:364-381`) | Existing re-exports unchanged; additive only |
| `packages/core/package.json` | (see repo) | — | Subpath `exports` map (`:51`); `./cache-pg` (`:108-111`) | Existing subpaths unchanged; add `./recall-trace-pg` |
| `packages/core/src/domain/dip/recall-trace-store.test-d.ts` (NEW) | 0 | — | (type-level test) | — |
| `packages/core/src/domain/dip/recall-trace-store.test.ts` (NEW) | 0 | — | (config validator unit test) | — |
| `tests/integration/recall-trace/recall-trace-store.test.ts` (NEW) | 0 | — | (THE GOAL TEST vs real pgvector) | — |

### Current callers / dependents

- **Symbol:** `runRetrievalPipeline` in `packages/core/src/domain/retrieval/pipeline.ts:311`
  - **Callers (production):** `packages/core/src/infrastructure/db/scoped-memory.ts:360-367` (non-cache path), `scoped-memory.ts:382-386` (cache-miss path)
  - **Callers (tests):** retrieval-pipeline tests under `packages/core/src/domain/retrieval/`
  - **External (public API consumed by other repos):** no — internal to core
- **Symbol:** `LocalScopedMemory.recall` in `packages/core/src/infrastructure/db/scoped-memory.ts:269`
  - **Callers (production):** `packages/api/src/server/handlers/recall.ts:37`, `packages/mcp/src/tools/recall-handler.ts:52`, `packages/mcp/src/openmemory/tools.ts:100`
  - **Callers (tests):** integration suites under `tests/integration/`
  - **External (public API consumed by other repos):** YES — the return type `readonly MemoryItemWithScore[]` is the locked `recall` verb contract. **MUST NOT change** (S1 keeps it bare-array; trace is a side-channel).
- **Symbol:** `RetrievalDeps` in `packages/core/src/domain/retrieval/pipeline.ts:39-63`
  - **Callers (production):** assembled in `scoped-memory.ts:361-366` and `:383-385`
  - **Change:** additive optional fields (`recallTrace?`, `recallId?`), like existing optional `reranker`/`retrievalPolicy`/`graphExpansionStore` (`:47,:55,:61`) — non-breaking.

### Domain glossary

- **recall trace** — the set of dropped-candidate rows persisted for one recall, keyed by `recall_id`.
- **recall_id** — server-generated UUID minted per recall in `retrieveResults`, shared by all trace rows of that recall.
- **drop-reason** — why a candidate was excluded: `semantic_gate` (dropped at `pipeline.ts:138` before composite is computed), `sub_threshold` (composite `< threshold`, `:144`), `nan` (composite NaN, `:144`), `mmr_redundant` (not selected by MMR, `mmr.ts:67-84`).
- **component breakdown** — the `{ semantic, bm25, entity }` sub-scores that compose the additive score (`pipeline.ts:140-143` `combineScores`).
- **fail-soft side-effect** — a best-effort write whose failure is swallowed so it never breaks the primary operation (precedent: usage-counter block `scoped-memory.ts:288-297`).

### Architecture boundaries affected

Per `rules/architecture.md`: the DIP contract (`recall-trace-store.ts`) lives in **domain** (`§ 2` — the domain declares the interface); the pg implementation lives in **infrastructure** (`§ 1` — adapter implements the domain interface). The pipeline (domain) receives the port via `RetrievalDeps` (DIP, `§ 2`) — it does NOT import the pg impl. The composition root (`factory.ts`) wires the concrete pg store into the port (`§ 1` "composition root at the top"). No inner→outer import is introduced. The event emission stays domain; the pg sink stays infra (`architecture.md § 2`).

## Prior Art & Related Work

- **Internal blueprint** — `knowledge-base/discoveries/blueprints/accountable-forgetting-blueprint.md` § "Cross-cutting Comparison" + ADR D2 (first-class tenant-governed trace tied to `memory-event.ts`); § "Coverage Corner 4 — Techniques" (Graphiti/Mem0 discard the reason). This plan implements the write-side of ADR D2.
- **Grill** — `knowledge-base/grills/explainable-recall-grill.md` (6 decisions: slice=S1, table+DIP, opt-in factory, recall-time only, rich payload, SMART goal).
- **Reference projects** — `knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:686-695` (Graphiti discards the dedup "why", keeps only timestamps); `knowledge-base/references/mem0/openmemory/api/app/routers/memories.py:277` (OpenMemory drops non-ADD at the boundary — the anti-pattern this plan avoids by persisting the reason).
- **Internal DIP precedent** — `packages/core/src/domain/dip/recall-cache-store.ts:119-162` (13th DIP, the shape mirrored here); `packages/core/src/infrastructure/db/pg-usage-counter-store.ts:27-64` (raw-SQL pg impl idiom); `factory.ts:67-105` (opt-in resolver pattern).
- **Patterns skills** — (none identified — no `skills/*-patterns/` exists in this repo).

## Dependencies

**No new runtime or dev dependencies.** S1 uses only what is already declared in `packages/core/package.json`:

| Dependency | Version (already declared) | Used for | Rule-9 (don't reinvent) |
|---|---|---|---|
| `pg` (`Pool`) | existing | `PgRecallTraceStore` raw SQL (mirrors `PgUsageCounterStore`) | Battle-tested Postgres driver already in use |
| `crypto.randomUUID` (Node built-in) | Node ≥ 20 | `recall_id` generation | stdlib — no dep (parsimony ladder rung 2) |
| `drizzle-orm` | existing | `recall_traces` schema def for migration generation | already the project's migration tool |

No CVE surface added (nothing new to audit). `/deps-audit` is a NOOP for this plan.

## Objective

- [ ] Sub-goal 1 — `RecallTraceStore` DIP + `RecallTraceRow` + `DropReason` enum + config + validator defined in domain (2-method interface within ADR-0008 cap).
- [ ] Sub-goal 2 — `recall_traces` drizzle table + migration `0023` (scoped by `workspace_id`, keyed by `recall_id`).
- [ ] Sub-goal 3 — `PgRecallTraceStore` (raw-SQL `record` + `getByRecallId`) + `./recall-trace-pg` subpath export + contract re-export.
- [ ] Sub-goal 4 — pipeline collects dropped candidates (all 4 drop-reasons) with breakdown and writes them via the port, fail-soft, without altering the returned set.
- [ ] Sub-goal 5 — opt-in wiring: `config.recallTrace` → factory resolver → threaded into `RetrievalDeps`; `recall_id` minted per recall.
- [ ] Sub-goal 6 — THE GOAL TEST green vs real pgvector (≥1 drop → rows by `recall_id`; 0 drops → 0 rows).

## ADRs

### D1 — Write from inside the pipeline via a `RetrievalDeps` port (do NOT change `recall()`'s return)

**Decision:** Add optional `recallTrace?: RecallTraceStore` + `recallTraceContext?: { recallId: string; workspaceId: string; scopeKey: string }` to `RetrievalDeps` (EC-2: one context field so tenant keys reach the write point, since scope resolution lives in `scoped-memory.ts`, not the pipeline); collect dropped candidates at the `filterAtThreshold` drop points and the MMR branch, and write them via the port from inside `runRetrievalPipeline` — mirroring the existing in-pipeline `emitEvent` side-effect.

**Rationale:** The pipeline currently discards dropped candidates (`pipeline.ts:137-146` `continue`) and returns a bare array; `recall()` and all three production callers (`recall.ts:37`, `recall-handler.ts:52`, `tools.ts:100`) depend on the `readonly MemoryItemWithScore[]` contract (a locked verb). Threading the port through `RetrievalDeps` (like `reranker`/`graphExpansionStore`, `pipeline.ts:47,61`) is the smallest blast radius and keeps the return contract intact. Per `architecture.md § 2`, the port is a domain interface; the pipeline never imports the pg impl.

**Alternatives considered:** (a) Change `runRetrievalPipeline` to return `{ items, dropped }` and write in `scoped-memory.ts` — rejected: changes an internal contract with two call sites and risks leaking the dropped set toward `recall()`'s public return. (b) Emit dropped rows only as OTel span attributes (extend `recall_threshold_filtered`) — rejected: spans are fire-and-forget, not queryable per-recall (blueprint ADR D2 alt (a); `architecture.md § 2` keeps event≠sink). (c) Reconstruct drops post-hoc by re-scoring — rejected: duplicates the pipeline, non-deterministic.

**Consequences:** `RetrievalDeps` gains two optional fields — `recallTrace` + `recallTraceContext` (non-breaking). The pipeline gains a write side-effect that must be fail-soft (D3). MMR-drop breakdown is recovered via the `candidates` Map at the pipeline layer, not inside `mmrRerank` (`mmr.ts:25-29` lacks the breakdown). The write gate requires BOTH `recallTrace` AND `recallTraceContext` present (EC-5).

### D2 — Dedicated `recall_traces` table behind a 2-method DIP, opt-in via factory (mirror `recallCache`)

**Decision:** Persist to a new `recall_traces` Postgres table behind a `RecallTraceStore` DIP with exactly two methods — `record(batch)` and `getByRecallId(recallId)` — resolved opt-in in the factory (`resolveRecallTraceStore`), default OFF, threaded into `RetrievalDeps`.

**Rationale:** The differentiator requires the negative-space to be **queryable** (S2 `explain` reads it), which an OTel sink is not. A dedicated table mirrors the project's audit tables (`history`, `consolidation_history`) and the `recallCache` precedent (`recall-cache-store.ts:119`, `factory.ts:67-105`). Two methods (write + read-by-id) is the minimum that satisfies S1's GOAL TEST — no `clearExpired` is added (retention is deferred, YAGNI per `parsimony-ladder.md`; see Unresolved Q1). Stays within ADR-0008's DIP method-count cap.

**Alternatives considered:** (a) Reuse the `history` table — rejected: different shape (audit of remember/forget, not per-candidate scores) and would overload a stable table. (b) Always-on persistence — rejected: write-amplification on every recall; the grill fixed opt-in (mirrors `recallCache`/`eviction` opt-in). (c) Per-call `RecallOptions.explain` flag — rejected (grill Q3): makes `explain()` non-deterministic.

**Consequences:** New subpath `@usetheo/memory/recall-trace-pg` (bundle-isolated like `./cache-pg`). Deployment-level opt-in means any `recall_id` is explainable when on. Retention/rotation is a follow-up.

### D3 — The trace write is fail-soft; a trace-store failure never breaks `recall`

**Decision:** Wrap the trace write in a best-effort guard: on any error, swallow-and-continue (optionally emit an OTel event), and return the recall results unchanged.

**Rationale:** The trace is a side-channel governance artifact, not part of the recall result. Breaking a user's recall because an audit write failed would be a severe regression. This mirrors the existing fail-soft usage-counter block (`scoped-memory.ts:288-297`) and honors `error-handling.md § 2` (distinguish recoverable side-effects) — the trace write is recoverable/skippable, the recall itself is not.

**Alternatives considered:** (a) Fail-hard (abort recall on trace error) — rejected: turns an audit dependency into a recall SPOF. (b) Silent swallow with no signal — rejected: violates Princípio 3 (observability); a swallowed trace failure must itself be observable, so emit an OTel event on the failure path.

**Consequences:** A trace-store outage degrades gracefully (no traces written, recall unaffected). The GOAL TEST must assert BOTH the happy path AND the fail-soft path (recall returns results when the store throws).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `entity` component is uniformly 0 in v0.1 (`pipeline.ts:348` — `entityBoostById` never populated), so the trace's `entity` column carries no signal today | Medium | Persist the column now (schema-forward); document it in the row JSDoc; it becomes meaningful when entity-boost integration lands. Do NOT block S1 on it | core |
| Write-amplification when tracing is ON (≥1 row per dropped candidate per recall) → `recall_traces` grows unbounded (no retention in S1) | Medium | Opt-in default-OFF (D2); document retention as Unresolved Q1 (follow-up per `audit-trail-rotation.md`); add `maxRowsPerRecall` cap in config as a defensive bound | ops |
| Four already-over-budget aggregate files are edited (`schema.ts` 684, `pipeline.ts` 520, `scoped-memory.ts` 541, `index.ts` 570 > 500 LoC budget) | Low | Additions are minimal (~10-30 lines each); splitting these aggregates is a separate refactor out of S1 scope. Documented deviation — the per-file ≤500 criterion is waived for these pre-existing aggregates, not for the NEW files | core |
| Pipeline write side-effect could slow recall (extra INSERT on the hot path) | Low | Fail-soft + can be a single batched `record` call per recall (not per-candidate); benchmark the ON vs OFF recall latency in integration | core |

## Unresolved Questions

- Q1 — Retention/rotation of `recall_traces` rows. S1 ships capture only; unbounded growth when ON. A TTL/rotation policy (cf. `rules/audit-trail-rotation.md`) is a follow-up slice — NOT gated on S1. Decision deferred; `maxRowsPerRecall` config bound added as a stopgap.
- Q2 — Whether to also stamp `recall_id` onto the existing `recall_threshold_filtered` OTel event (`pipeline.ts:392-396`) for span↔table correlation. Low-risk enrichment; resolve during implementation of T3.1 (include if trivial, else defer to S2).
- Q3 — For `semantic_gate` drops the composite is never computed (`pipeline.ts:138` precedes `:140`). Store `composite = NULL` for those rows vs recompute. Plan assumes NULL (honest — the composite genuinely was not evaluated); `/edge-case-plan` to confirm.

## Dependency Graph

```
Phase 0 (DIP contract) ──▶ Phase 1 (schema+migration) ──▶ Phase 2 (pg impl+export)
        │                                                        │
        │                                                        ▼
        └────────────────▶ Phase 3 (pipeline write) ──▶ Phase 4 (factory wiring)
                                                                 │
                                                                 ▼
                                                   Final Phase: Integration Validation
```

Phase 0 blocks all (defines the types). Phase 1→2 are sequential (table before pg impl). Phase 3 depends only on Phase 0 (uses the port type) and can start in parallel with Phase 1/2. Phase 4 depends on Phase 2 (needs the pg store to resolve) AND Phase 3 (needs the port in deps).

---

## Phase 0: `RecallTraceStore` contract

**Objective:** Define the domain DIP, row shape, drop-reason enum, config, and validator.

### T0.1 — Define `RecallTraceStore` DIP + types

#### Objective
Create the domain contract: `RecallTraceStore` (2 methods), `RecallTraceRow`, `RecallTraceBatch`, `DropReason` enum, `RecallTraceStoreConfig`, `validateRecallTraceStoreConfig`.

#### Why this step (action + reasoning)
1. **What this step does** — introduces the DIP interface + supporting types in `domain/dip/`, mirroring `recall-cache-store.ts` structure.
2. **Why it is necessary now** — every downstream phase (schema, pg impl, pipeline, factory) references these types; the contract is the root of the dependency graph (D2). Defining it first lets Phase 3 proceed in parallel with Phase 1/2.

#### Evidence
`recall-cache-store.ts:119-162` (interface shape to mirror), `:95-112` (config shape), `:207-234` (validator pattern). Drop-reasons enumerated from `pipeline.ts:138,144` + `mmr.ts:67-84`.

#### Files to edit
```
packages/core/src/domain/dip/recall-trace-store.ts — NEW: interface + types + validator
packages/core/src/domain/dip/recall-trace-store.test-d.ts — NEW: RED type-level test
packages/core/src/domain/dip/recall-trace-store.test.ts — NEW: RED validator unit test
```

#### Deep file dependency analysis
- `recall-trace-store.ts` (NEW): no dependents yet; will be imported by pg impl (Phase 2), pipeline (Phase 3), factory (Phase 4), and re-exported by `domain/index.ts` (Phase 4). Mirrors `recall-cache-store.ts` (Baseline row).
- No existing caller is affected (pure addition).

#### Deep Dives
- `DropReason` = `'semantic_gate' | 'sub_threshold' | 'nan' | 'mmr_redundant'`.
- `RecallTraceRow` fields: `recallId: string`, `workspaceId: string`, `scopeKey: string`, `memoryId: string`, `semantic: number`, `bm25: number`, `entity: number`, `composite: number | null` (null for `semantic_gate`, Q3), `threshold: number`, `dropReason: DropReason`, `createdAt: Date`.
- `RecallTraceBatch` = `{ recallId; workspaceId; scopeKey; query?: string; rows: readonly Omit<RecallTraceRow,'recallId'|'workspaceId'|'scopeKey'|'createdAt'>[] }`.
- `RecallTraceStoreConfig` = `{ maxRowsPerRecall?: number }` (default `DEFAULT_MAX_ROWS_PER_RECALL = 200`); validator throws a typed `InvalidRecallTraceConfig` on non-positive values AND on values above `MAX_ROWS_PER_RECALL = 5000` (EC-1: 5000 rows × ~10 cols = 50 000 bind params < the Postgres 65 535 limit; a higher cap would make the batch INSERT throw and — being fail-soft — silently write nothing). Typed error, clear message (per `error-handling.md`).
- Invariant: interface has exactly 2 methods (ADR-0008 cap).

#### Pseudo-code / Signatures
```pseudocode
interface RecallTraceStore {
  record(batch: RecallTraceBatch): Promise<void>
  getByRecallId(recallId: string): Promise<readonly RecallTraceRow[]>
}
function validateRecallTraceStoreConfig(c: RecallTraceStoreConfig): void
  -- if c.maxRowsPerRecall != null && (c.maxRowsPerRecall <= 0 || c.maxRowsPerRecall > 5000): throw InvalidRecallTraceConfig  -- EC-1
```

#### Tasks
1. Write RED type test asserting the 2-method interface shape + row/enum types.
2. Write RED unit test for the validator (rejects `maxRowsPerRecall <= 0`, accepts undefined/positive).
3. Implement the types + validator minimally to pass.

#### TDD
```
RED:     test_recall_trace_store_interface_shape() — asserts RecallTraceStore has exactly record + getByRecallId; DropReason union; RecallTraceRow.composite is number|null
RED:     test_validate_config_rejects_nonpositive() — expects validateRecallTraceStoreConfig(0) and (-1) to throw InvalidRecallTraceConfig
RED:     test_validate_config_rejects_over_max() — expects validateRecallTraceStoreConfig(5001) to throw InvalidRecallTraceConfig (EC-1)
RED:     test_validate_config_accepts_bounds() — expects accept of undefined, 1 (min), 5000 (max)
GREEN:   Implement recall-trace-store.ts (types + validator)
REFACTOR: None expected
VERIFY:  npm test -- recall-trace-store
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] Interface has exactly 2 methods (ADR-0008) — asserted by `recall-trace-store.test-d.ts`
- [ ] `DropReason` enumerates all 4 reasons — asserted by `recall-trace-store.test-d.ts`
- [ ] Validator throws `InvalidRecallTraceConfig` on invalid config — asserted by `recall-trace-store.test.ts`
- [ ] Pass: size — `wc -l packages/core/src/domain/dip/recall-trace-store.ts` returns ≤ 500
- [ ] Pass: lint — `npm run lint` zero warnings on changed files
- [ ] Pass: typecheck — `npm run typecheck` zero errors

#### DoD
- [ ] `npm test -- recall-trace-store` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] File-size budget respected (NEW file)

---

## Phase 1: Schema + migration

**Objective:** Add the `recall_traces` drizzle table and its migration.

### T1.1 — `recall_traces` table + migration `0023`

#### Objective
Add the drizzle table def to `schema.ts` and the `0023_recall_traces.sql` migration (table + indexes on `recall_id` and `workspace_id`).

#### Why this step (action + reasoning)
1. **What this step does** — declares the storage: columns matching `RecallTraceRow`, scoped by `workspace_id`, indexed by `recall_id` (the read key for `getByRecallId`) and `(workspace_id, created_at)` (retention/scan).
2. **Why it is necessary now** — Phase 2's pg impl writes/reads this table; it must exist first. Follows the `recallCache`/`scopeUsageCounters` table pattern (Baseline).

#### Evidence
`schema.ts:521-549` (`recallCache` table w/ workspace_id + indexes), `schema.ts:665-684` (`scopeUsageCounters`), migration examples `0020_scope_usage_counters.sql:1-11` and `0010_recall_cache.sql:27-40`. Latest migration is `0022` → new is `0023`.

#### Files to edit
```
packages/core/src/infrastructure/db/schema.ts — add recallTraces table def (additive)
packages/core/src/infrastructure/db/migrations/0023_recall_traces.sql — NEW: CREATE TABLE + indexes
packages/core/src/infrastructure/db/migrations/meta/ — drizzle journal update (generated)
tests/integration/recall-trace/migration.test.ts — NEW: RED migration-applies + shape test
```

#### Deep file dependency analysis
- `schema.ts` (Baseline row, 684 LoC, already over budget): additive table def (~18 lines); existing tables untouched. Downstream: drizzle migration generation + `PgRecallTraceStore` reads column names.
- New migration: applied by `migrations-runner.ts`; must be idempotent (`CREATE TABLE IF NOT EXISTS`) per `0010` precedent.

#### Deep Dives
- Columns: `id uuid PK default gen_random_uuid()`, `recall_id text NOT NULL`, `workspace_id text NOT NULL default 'default'`, `scope_key text NOT NULL`, `memory_id text NOT NULL`, `semantic real NOT NULL`, `bm25 real NOT NULL`, `entity real NOT NULL default 0`, `composite real` (nullable, Q3), `threshold real NOT NULL`, `drop_reason text NOT NULL`, `created_at timestamptz NOT NULL default now()`.
- Indexes: `CREATE INDEX IF NOT EXISTS recall_traces_recall_id_idx ON recall_traces (recall_id)`; `CREATE INDEX IF NOT EXISTS recall_traces_ws_created_idx ON recall_traces (workspace_id, created_at)`.
- Invariant (Baseline `schema.ts` row): existing table defs unchanged; migration additive.
- No `vector(...)` column → no parametric-dim caveat (unlike `0010`).

#### Tasks
1. RED integration test: run migrations against a fresh pgvector container; assert `recall_traces` exists with the 12 columns + 2 indexes.
2. Add the drizzle table def to `schema.ts`.
3. Author `0023_recall_traces.sql` (idempotent) + update the drizzle meta journal.

#### TDD
```
RED:     test_migration_creates_recall_traces() — after runMigrations(pool), asserts information_schema shows recall_traces with expected columns + indexes
GREEN:   Add recallTraces to schema.ts + write 0023_recall_traces.sql
REFACTOR: None expected
VERIFY:  npm run test:integration -- recall-trace/migration
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — migration application is serialized by the runner.

#### Acceptance Criteria
- [ ] `recall_traces` created idempotently; re-running migrations is a no-op
- [ ] Indexes on `recall_id` and `(workspace_id, created_at)` present
- [ ] Existing tables/migrations unchanged — `git diff schema.ts` shows only added lines (zero deletions)
- [ ] Pass: lint/typecheck on `schema.ts` changes
- [ ] Size: NEW migration file ≤ 500 lines; `schema.ts` deviation documented (Drawbacks)

#### DoD
- [ ] `npm run test:integration -- recall-trace/migration` green (needs `docker compose up -d pgvector`)
- [ ] `npm run typecheck` zero errors

---

## Phase 2: Pg impl + subpath export

**Objective:** Implement `PgRecallTraceStore` (raw SQL) and expose it via `@usetheo/memory/recall-trace-pg`.

### T2.1 — `PgRecallTraceStore` + subpath barrel + exports

#### Objective
Raw-SQL `record` (batch INSERT, honoring `maxRowsPerRecall`) + `getByRecallId` (SELECT ordered by created_at), plus the `recall-trace/index.ts` barrel, `package.json` `./recall-trace-pg` export, and `domain/index.ts` contract re-export.

#### Why this step (action + reasoning)
1. **What this step does** — the concrete pg adapter for the port, following the raw-SQL idiom (not drizzle query builder).
2. **Why it is necessary now** — the factory (Phase 4) resolves this concrete store; the GOAL TEST reads via `getByRecallId`. Mirrors `PgUsageCounterStore` (`pg-usage-counter-store.ts:27-64`) and the `cache-pg` subpath (`package.json:108-111`).

#### Evidence
`pg-usage-counter-store.ts:27-64` (raw-SQL INSERT/SELECT template), `pgvector-recall-cache-store.ts:128-221` (SQL-as-const + pool.query), `recall-cache/index.ts:16-38` (subpath barrel), `package.json:108-111` (`./cache-pg` mapping), `domain/index.ts:364-381` (contract re-export pattern).

#### Files to edit
```
packages/core/src/infrastructure/db/recall-trace/pg-recall-trace-store.ts — NEW: raw-SQL impl
packages/core/src/infrastructure/db/recall-trace/index.ts — NEW: subpath barrel (re-export impl + contract types)
packages/core/package.json — add "./recall-trace-pg" to exports
packages/core/src/domain/index.ts — re-export RecallTraceStore contract types (additive)
tests/integration/recall-trace/pg-store.test.ts — NEW: RED record→getByRecallId round-trip
```

#### Deep file dependency analysis
- `pg-recall-trace-store.ts` (NEW): implements `RecallTraceStore` (Phase 0); imports `pg.Pool`. Downstream: resolved by factory (Phase 4).
- `package.json` (Baseline row): additive subpath; existing `./cache-pg` etc. unchanged. Must not pull the impl into the default barrel (EC-26 bundle-isolation precedent — dynamic import in factory).
- `domain/index.ts` (Baseline row, 570 LoC): additive re-export at the RecallCache re-export site (`:364-381`).

#### Deep Dives
- `INSERT_SQL`: multi-row insert; cap rows at `maxRowsPerRecall` (slice before insert). Parameterized (`$1,$2,...`).
- `GET_BY_RECALL_ID_SQL`: `SELECT ... FROM recall_traces WHERE recall_id = $1 ORDER BY created_at ASC`.
- Invariant: raw parameterized SQL (SQL-injection-safe); no drizzle query builder (Baseline finding §5/§7).
- Edge cases: empty `rows` → no INSERT (skip); unknown `recallId` → empty array.

#### Pseudo-code / Signatures
```pseudocode
class PgRecallTraceStore implements RecallTraceStore
  constructor(pool: Pool, config: RecallTraceStoreConfig)
  async record(batch):
    rows = batch.rows.slice(0, this.maxRowsPerRecall)
    if rows.length == 0: return
    await pool.query(INSERT_SQL, flatten(batch, rows))
  async getByRecallId(id):
    r = await pool.query(GET_BY_RECALL_ID_SQL, [id]); return r.rows.map(toRow)
```

#### Tasks
1. RED integration test: `record` a batch of 3 dropped rows → `getByRecallId` returns 3 with correct breakdown + drop-reason; `maxRowsPerRecall=2` caps to 2; unknown id → `[]`.
2. Implement the store (raw SQL).
3. Add barrel + `package.json` subpath + `domain/index.ts` re-export.

#### TDD
```
RED:     test_pg_store_record_getbyid_roundtrip() — expects record(3 rows) then getByRecallId returns 3; cap respected; empty rows→no insert; unknown id→[]
RED:     test_pg_store_preserves_null_composite() — expects a semantic_gate row written with composite=null to read back as null (not 0/NaN) (EC-6)
GREEN:   Implement PgRecallTraceStore + barrel + exports
REFACTOR: Extract SQL consts (mirror pgvector-recall-cache-store)
VERIFY:  npm run test:integration -- recall-trace/pg-store
```

#### Concurrency tests (only when applicable)

atomic-counter invariant (parallel test): N concurrent record() calls with DISTINCT
recall_ids (Promise.all) each persist fully; getByRecallId per id returns only its own
rows (no lost update, no cross-recall bleed). Rows keyed by recall_id → no shared mutable row.

#### Acceptance Criteria
- [ ] `record`→`getByRecallId` round-trip preserves breakdown + drop-reason + null composite
- [ ] `maxRowsPerRecall` cap enforced
- [ ] `./recall-trace-pg` resolves; default barrel does NOT pull the pg impl (bundle isolation)
- [ ] Pass: coverage ≥ 90% on new files; lint/typecheck clean; new files ≤ 500 lines

#### DoD
- [ ] `npm run test:integration -- recall-trace/pg-store` green
- [ ] `npm run typecheck` + `npm run lint` clean

---

## Phase 3: Pipeline write (the core)

**Objective:** Collect dropped candidates with breakdown and write them via the port, fail-soft, without altering the returned set.

### T3.1 — Trace dropped candidates inside `runRetrievalPipeline`

#### Objective
Add `recallTrace?: RecallTraceStore` + `recallId?: string` to `RetrievalDeps`; capture each dropped candidate (all 4 drop-reasons) with `{semantic,bm25,entity,composite?,threshold}`; call `recallTrace.record(...)` once per recall, fail-soft.

#### Why this step (action + reasoning)
1. **What this step does** — turns the silent `continue` drops (`pipeline.ts:137-146`) and MMR non-selections into recorded rows, written via the port from inside the pipeline (D1).
2. **Why it is necessary now** — this is the load-bearing capability (Sub-goal 4); without it there is no negative-space to persist. Done in the pipeline because the component breakdown is only in scope there (Baseline §1, §5 finding: MMR layer lacks breakdown).

#### Evidence
`pipeline.ts:130-150` (drop points w/ `c.semantic/bm25/entity/payload` in scope), `:384-397` (threshold-filter call site + event emit), `:495-511` (MMR branch), `mmr.ts:67-84` (greedy selection), `scoped-memory.ts:288-297` (fail-soft precedent for D3).

#### Files to edit
```
packages/core/src/domain/retrieval/pipeline.ts — add ports to RetrievalDeps; collect+write dropped rows (fail-soft)
packages/core/src/domain/memory-event.ts — add recall_trace_write_failed + recall_trace_truncated to MEMORY_EVENTS (typed union)
packages/core/src/domain/retrieval/pipeline.test.ts — RED unit tests (stub store)
```

#### Deep file dependency analysis
- `pipeline.ts` (Baseline row, 520 LoC, over budget): `RetrievalDeps` (`:39-63`) gains 2 optional fields (non-breaking — callers in `scoped-memory.ts:361-366` pass them in Phase 4). `filterAtThreshold` (`:130-150`) collects drops instead of only discarding. MUST keep returning the bare kept array (`:311` invariant).
- Downstream: `scoped-memory.ts` (Phase 4) supplies the deps; no change to `recall()`'s return.

#### Deep Dives
- Collect a `dropped: RecallTraceRow-partial[]` alongside the survivors in `filterAtThreshold`: at `:138` push `{reason:'semantic_gate', composite:null}`, at `:144` push `{reason: Number.isNaN(combined)?'nan':'sub_threshold', composite:combined}`. For MMR: after `mmrRerank` (`:510`), diff pool vs selected → push `{reason:'mmr_redundant'}` recovering breakdown from the `candidates` Map by id (`:351`).
- Fail-soft (D3): `try { await deps.recallTrace.record(batch) } catch (e) { emitEvent(deps.tracer, 'recall_trace_write_failed', {error:String(e)}) }` — never rethrow. Only call when `deps.recallTrace && deps.recallId` present (opt-in gate).
- One `record` per recall (batched), not per candidate (perf, Drawback row).
- Invariant: the returned `top`/`selected` set is byte-identical whether tracing is on or off.
- Edge case: 0 drops → `batch.rows` empty → `record` skips INSERT (mirrors `filtered_count=0` no-emit at `:391`).

#### Pseudo-code / Signatures
```pseudocode
-- inside runRetrievalPipeline, tracing gate:
dropped = []   -- filled at :138, :144, and MMR diff
kept = filterAtThreshold(...)   -- unchanged return
...
if deps.recallTrace && deps.recallTraceContext:          -- EC-5: BOTH required
  ctx = deps.recallTraceContext                          -- { recallId, workspaceId, scopeKey } (EC-2)
  rows = dropped.slice(0, cap)                            -- cap = store's maxRowsPerRecall
  if dropped.length > rows.length:                        -- EC-4: no silent truncation
    emitEvent(deps.tracer, 'recall_trace_truncated', { dropped_total: dropped.length, persisted: rows.length })
  try: await deps.recallTrace.record({ ...ctx, rows })
  catch e: emitEvent(deps.tracer, 'recall_trace_write_failed', { error: String(e) })
return kept   -- IDENTICAL to today
```

#### Tasks
1. RED: pipeline with a stub `RecallTraceStore` + `recallId`; a query dropping ≥1 candidate → `record` called with the dropped rows carrying correct breakdown + drop-reason; kept set unchanged.
2. RED: 0 drops → `record` not called (or called with empty rows, no INSERT).
3. RED (fail-soft): stub `record` throws → `runRetrievalPipeline` still returns the kept results; `recall_trace_write_failed` observed.
4. GREEN: implement collection + fail-soft write.

#### TDD
```
RED:     test_pipeline_traces_threshold_drops() — expects sub_threshold + semantic_gate + nan drops recorded with breakdown; kept set identical to no-trace run
RED:     test_pipeline_traces_mmr_drops() — expects mmr_redundant drops recorded with breakdown recovered from candidates Map
RED:     test_pipeline_failsoft_and_zero_drops() — expects 0 drops → no INSERT; fail-soft → recall returns results when record() throws
RED:     test_pipeline_marks_trace_truncated() — expects drops > cap → only cap rows recorded AND recall_trace_truncated emitted (EC-4)
RED:     test_pipeline_skips_when_context_incomplete() — expects recallTrace set but recallTraceContext missing → no write, no throw (EC-5)
GREEN:   Implement dropped-candidate collection + fail-soft record in pipeline.ts
REFACTOR: Extract a collectDropped helper if pipeline.ts readability drops
VERIFY:  npm test -- retrieval/pipeline
```

#### Concurrency tests (only when applicable)

happens-before observation: with a barrier (Promise.all) then assert the returned kept
set is identical whether record() resolves OR rejects (Promise.reject) — the fail-soft
write is awaited but never alters the returned array. No shared mutable state across recalls.

#### Acceptance Criteria
- [ ] All 4 drop-reasons captured with correct breakdown; `composite=null` for `semantic_gate`
- [ ] Kept/returned set is identical with tracing on vs off (invariant)
- [ ] Fail-soft: `record()` throwing does NOT break recall; failure is observable
- [ ] Pass: coverage ≥ 90% on the diff (critical path: 100%); lint/typecheck clean
- [ ] Size: `pipeline.ts` deviation documented (pre-existing over-budget aggregate)

#### DoD
- [ ] `npm test -- retrieval/pipeline` green
- [ ] `npm run typecheck` + `npm run lint` clean

---

## Phase 4: Factory wiring + recall_id

**Objective:** Opt-in resolution of the store and per-recall `recall_id` minting.

### T4.1 — `resolveRecallTraceStore` + thread into `RetrievalDeps` + mint `recall_id`

#### Objective
Add `config.recallTrace`, a factory `resolveRecallTraceStore` (default OFF, dynamic-import the pg impl), thread the port into the deps assembled in `retrieveResults`, and mint a `recall_id` per recall.

#### Why this step (action + reasoning)
1. **What this step does** — wires the opt-in: config → resolved store → `RetrievalDeps`; generates `recall_id` in `retrieveResults` before the pipeline call.
2. **Why it is necessary now** — completes the wiring triad (caller + the Phase 3 port + the runtime write); without it the port is never supplied and no trace is written. Mirrors `resolveRecallCacheStore` (`factory.ts:67-105,212`).

#### Evidence
`factory.ts:67-105` (resolver pattern), `:212` (call site), `:226/:275` (threading precedent), `config.ts:120` (`recallCache?` field), `scoped-memory.ts:361-366` (deps assembly — where the port + recallId are injected), `:269` (`recall()` — where recall_id is minted).

#### Files to edit
```
packages/core/src/infrastructure/db/config.ts — add recallTrace?: RecallTraceStoreConfig | RecallTraceStore
packages/core/src/infrastructure/db/factory.ts — resolveRecallTraceStore + call in createLocalMemory
packages/core/src/infrastructure/db/scoped-memory.ts — mint recall_id; pass recallTrace+recallId into RetrievalDeps
packages/core/src/infrastructure/db/factory.test.ts — RED wiring tests
```

#### Deep file dependency analysis
- `config.ts` (Baseline row): additive optional field (mirror `:120`).
- `factory.ts` (Baseline row, 300 LoC): new resolver + one call; dynamic-import keeps the pg impl out of the default bundle (EC-26).
- `scoped-memory.ts` (Baseline row, 541 LoC, over budget): `retrieveResults` (`:302`) mints `recallId = crypto.randomUUID()` and adds `recallTrace`/`recallId` to the deps object at `:361-366` and `:383-385`. `recall()`'s return unchanged (invariant).

#### Deep Dives
- `resolveRecallTraceStore(config)`: returns `undefined` when `config.recallTrace` absent (default OFF); DIP-instance escape hatch (like `isRecallCacheStoreInstance`); else validate POJO + **probe the `recall_traces` table exists** (EC-3 — mirror `resolveRecallCacheStore`'s dim-probe `factory.ts:91-97`; throw a clear typed error at `createLocalMemory` if the migration was not run, instead of degrading to silent-no-trace under fail-soft) + dynamic-import `PgRecallTraceStore`.
- `recallTraceContext`: built once per `retrieveResults` invocation as `{ recallId: crypto.randomUUID(), workspaceId, scopeKey }` (EC-2 — `workspaceId`/`scopeKey` resolved here via the scope, then passed into the pipeline deps so the write point has the tenant keys). `recallId` is NOT returned to the caller (S1 — surfacing to callers is S2).
- Invariant: when `recallTrace` is OFF, `retrieveResults` behavior is byte-identical to today (deps lack the port → pipeline's opt-in gate skips).

#### Tasks
1. RED: `createLocalMemory({})` → no trace store; a recall writes nothing.
2. RED: `createLocalMemory({ recallTrace: {} })` (pg-backed) → the store is threaded; deps carry `recallTrace` + a `recall_id`.
3. GREEN: implement config field + resolver + threading + recall_id mint.

#### TDD
```
RED:     test_factory_wires_recall_trace_optin() — expects recallTrace absent → deps.recallTrace undefined; present → deps.recallTrace defined + recallTraceContext has {recallId uuid, workspaceId, scopeKey}
RED:     test_resolve_throws_when_table_absent() — expects resolveRecallTraceStore to throw a typed error when the recall_traces table is absent (EC-3)
RED:     test_factory_rejects_invalid_config_fast() — expects invalid maxRowsPerRecall (0 or > 5000) to fail createLocalMemory fast, not at first recall (EC-1)
GREEN:   Implement config.recallTrace + resolveRecallTraceStore (with table probe) + retrieveResults threading
REFACTOR: None expected
VERIFY:  npm test -- factory
```

#### Concurrency tests (only when applicable)

concurrent test: 2 concurrent recalls (Promise.all) each mint their own recall_id (no
shared counter) → assert the 2 produced recall_ids are distinct (no id collision).

#### Acceptance Criteria
- [ ] Default OFF: no trace store, zero behavior change vs today
- [ ] ON: port threaded into deps; `recall_id` is a fresh uuid per recall
- [ ] pg impl dynamic-imported (not in default bundle)
- [ ] Pass: coverage ≥ 90% on diff; lint/typecheck clean; `scoped-memory.ts` deviation documented

#### DoD
- [ ] `npm test -- factory` green
- [ ] `npm run typecheck` + `npm run lint` clean

---

## Coverage Matrix

| # | Gap / Requirement (grill decision) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Slice = S1 recall-time write-side (grill Q1/Q4) | T3.1 | Pipeline captures recall-time drops only; write-time out of scope |
| 2 | Dedicated queryable table + DIP (grill Q2) | T0.1, T1.1, T2.1 | `RecallTraceStore` DIP + `recall_traces` table + `PgRecallTraceStore` |
| 3 | Opt-in via factory, default OFF (grill Q3) | T4.1 | `config.recallTrace` + `resolveRecallTraceStore` |
| 4 | Rich payload: breakdown + threshold + drop-reason (grill Q5) | T0.1, T3.1 | `RecallTraceRow` + pipeline collection of all 4 drop-reasons |
| 5 | `recall_id` per recall (grill Q5) | T4.1 | Minted in `retrieveResults` |
| 6 | THE GOAL TEST (grill Q6) | T3.1, T4.1 | Behavior the GOAL TEST asserts (drops→rows by recall_id) is produced by T3.1 (pipeline write) + T4.1 (wiring); executed in the Final Phase integration run |
| 7 | Blueprint ADR D2 (persist the reason, tenant-governed) | T1.1, T3.1 | `workspace_id`-scoped rows; reason persisted |
| 8 | Fail-soft (trace never breaks recall) | T3.1 | D3 guard + fail-soft test |
| 9 | Edge-case hardening (EC-1 param cap, EC-2 tenant-context, EC-3 table probe, EC-4 truncation signal, EC-5 partial gate, EC-6 null composite) | T0.1, T2.1, T3.1, T4.1 | Absorbed v1.1 from edge-case review |

**Coverage: 9/9 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npm test` + `npm run test:integration` green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected for NEW files; documented deviation for pre-existing over-budget aggregates (`schema.ts`, `pipeline.ts`, `scoped-memory.ts`, `index.ts`)
- [ ] CHANGELOG.md updated under `[Unreleased] § Added` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — `recall()` still returns `readonly MemoryItemWithScore[]`; three callers (`recall.ts:37`, `recall-handler.ts:52`, `tools.ts:100`) unaffected
- [ ] Plan-specific: default-OFF path is byte-identical to pre-plan behavior (no trace store instantiated)
- [ ] **Runtime-metric proof** — with tracing ON, an integration workload writes ≥1 `recall_traces` row (counter non-zero), observed in the GOAL TEST, not just compiled
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

The plan touches Postgres (the `recall_traces` table via `pg.Pool`).

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:recall_traces` (DB INSERT) | connection error / query throws during `record()` | stub `RecallTraceStore.record` to reject (unit, T3.1); OR kill the pool mid-test (integration) | Fail-soft (D3): recall returns the kept results unchanged; `recall_trace_write_failed` OTel event emitted; NO partial break of `recall()` |
| `postgres:recall_traces` (DB SELECT) | `getByRecallId` on a fresh/unknown recall_id | integration: query an id never written | returns `[]` (empty), no error |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Prove S1 works end-to-end against real pgvector — THE GOAL TEST.

### Execution
```
docker compose up -d pgvector
npm run test:integration -- recall-trace     # migration + pg-store + GOAL TEST
npm test                                      # unit/contract (incl. pipeline + factory)
npm run typecheck
npm run lint
```

THE GOAL TEST (`tests/integration/recall-trace/recall-trace-store.test.ts`): with `createLocalMemory({ recallTrace: {} })` against real `ankane/pgvector:v0.5.1`, seed memories so a `recall(query, { threshold })` drops ≥1 candidate; assert `getByRecallId(recallId)` returns the dropped rows with `{semantic,bm25,entity}` breakdown + `dropReason` + `threshold`; a second recall with a threshold dropping 0 candidates writes 0 rows; a recall with tracing OFF writes nothing.

### Acceptance Criteria
- [ ] All suites green — `npm test && npm run test:integration` exit 0
- [ ] Coverage ≥ 90% on changed files (pipeline collection path: 100%) — `npm run coverage` report
- [ ] Zero type errors and zero lint warnings — `npm run typecheck` + `npm run lint` exit 0
- [ ] Runtime-metric proof — `recall_traces` row count > 0 after the ≥1-drop recall
- [ ] Failure scenarios green — fail-soft path exercised (recall returns on `record()` throw)

### If Validation Fails
1. Separate plan-caused failures from pre-existing (the repo has known SKIPs).
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
