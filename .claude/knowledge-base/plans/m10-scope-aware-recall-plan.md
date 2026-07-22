---
slug: m10-scope-aware-recall
milestone_id: M10
created_at: 2026-07-22
goal: Add opt-in scope-aware recall ranking (session recency-boost + global stability-boost) via RecallOptions.scopes over the shipped session∪global union, proven by a real-pgvector recall@k test where a stale session fact is deprioritized and a durable global fact surfaces, with cross-user isolation held.
---

# Plan: M10 — Scope-aware recall (global + current session union, ranked)

## Goal

Add an OPT-IN scope-aware ranking stage to the shipped recall pipeline — session rows recency-boosted, global rows stability-boosted (`confirmation_count`) — selected via a new `RecallOptions.scopes`, over the M8 `session ∪ global` union, always inside `(workspace, user)`, surfacing attribution per result; the default (no `scopes`) is byte-identical to today.

**One metric:** a real-pgvector integration test (`tests/integration/recall/scope-aware-ranking.test.ts`) where, with `scopes` set, a fresh session fact out-ranks a stale session fact AND a high-`confirmation_count` global fact out-ranks a one-off global fact — and user B's scope-aware recall returns 0 of user A's rows.

## Context

Grounded in the blueprint `.claude/knowledge-base/discoveries/blueprints/m10-scope-aware-recall-blueprint.md` (`/discover-confidence` SHIPPABLE 99.1). Central findings: scope-aware reweight is theo-memory-NOVEL (no ref algorithm to port — design from Princípio 1); the union is shipped (M8); M10 is a thin opt-in post-threshold stage; and a **load-bearing gap** — the recall `search` SQL omits `created_at`/`last_accessed_at`, so recency is not computable today (ADR D3 prerequisite). Independent of M9. Owner directive: `/goal` M10.

## Baseline Context

### Files that will be touched

| File | LoC today | Role | Change |
|---|---|---|---|
| `packages/core/src/infrastructure/db/pgvector-store.ts` | ~1187 | vector `search` — `cols` at :514-516 projects `confirmation_count` but NOT the timestamps | EXTEND `cols` with `created_at, last_accessed_at`; map in `rowToResult` |
| `packages/core/src/domain/retrieval/pipeline.ts` | ~611 | 9-step pipeline; `rowToItem` hardcodes `createdAt: now` (:531-532); post-threshold stages (diversify/rerank) at :588-611 | WIRE the scope-reweight stage; carry real `createdAt` |
| `packages/core/src/domain/retrieval/scope-reweight.ts` | 0 (NEW) | the deterministic scope-aware reweight (pure function) | NEW |
| `packages/core/src/domain/options.ts` | ~251 | `RecallOptions` — has diversify/rerank/graphExpand, NO `scopes` | ADD `readonly scopes?: {...}` opt-in |
| `packages/core/src/domain/memory-item.ts` | ~100 | `MemoryItemWithScore` declares `createdAt`/`lastAccessedAt?` (:23,71) but recall leaves them stale | (no change — fields exist; pipeline now populates them) |
| `tests/integration/recall/scope-aware-ranking.test.ts` | 0 (NEW) | recall@k + isolation hard-gate proof | NEW |
| `benchmarks/m10-scope-aware-recall.bench.mjs` | 0 (NEW) | recall@k before/after the weights | NEW |

### Current seams (verified — blueprint reuse surface)

- Union: `Filters.scopeHierarchy` → SQL predicate (`pgvector-store.ts:199-212`) — M8, shipped.
- Base score: `combineScores`/`maxPossible` (`scoring.ts:65-101`) — additive, reused unchanged.
- Post-threshold opt-in stage precedent: `diversify` (MMR) + `rerank` (Reranker DIP) at `pipeline.ts:588-611`; mutual-exclusion guard `RerankerConflict`.
- Reranker DIP: `dip/reranker.ts:32-46` (1 method).
- Stability signal available on recall today: `MemoryItemWithScore.confirmationCount` (`pipeline.ts:524-525`; projected `pgvector-store.ts:516`).
- Recency signal NOT available (the gap): `search` `cols` (`pgvector-store.ts:514-516`) omits `created_at`/`last_accessed_at`; `rowToItem` hardcodes now (`pipeline.ts:531-532`). Plumbing exists on `getAll` (`pgvector-store.ts:746-747`).
- Per-row scope-of-origin: `payload.session_id`/`agent_id` (`pgvector-store.ts:82-90`).
- Attribution: `MemoryItemWithScore.attributedTo` (`pipeline.ts:519-520`).
- Isolation upstream of ranking: `composeFilters` (`pgvector-store.ts:184-212`).

### Glossary

- **Scope-aware reweight** = a deterministic post-threshold score adjustment: a session-origin row gets a recency boost (newer `created_at`/`last_accessed_at` → higher); a global-origin row gets a stability boost (higher `confirmation_count` → higher). Bounded, explainable (Princípio 3).
- **scope-of-origin** = whether a recalled row is session (`session_id` set) or global (`session_id` NULL) — derivable from the projected columns.

### Architecture boundaries

- Domain: the reweight is a pure function (`retrieval/scope-reweight.ts`) + a pipeline stage (no I/O). `RecallOptions` extension is domain.
- Infrastructure: the `search` projection extension (pgvector-store).
- Isolation unchanged: reweight runs on the already-`(workspace,user)`-safe pool.

## Prior Art & Related Work

- Blueprint `.claude/knowledge-base/discoveries/blueprints/m10-scope-aware-recall-blueprint.md` (SHIPPABLE 99.1) — mem0 additive/scope-blind, graphiti reranker catalog (RRF/MMR/node-distance, no recency), scope-reweight theo-memory-novel.
- Shipped: the `diversify`/`rerank` post-threshold stages are the exact opt-in-stage template; `scoring.ts` the base score; M8 hierarchical union the pool.

## ADRs

### D1 — M10 is an opt-in post-threshold reweight STAGE, not a base-score change

**Decision:** the scope-weight is a NEW pipeline stage after threshold, gated by `RecallOptions.scopes`; the base `combineScores` is untouched; default path byte-identical.

**Rationale:** blueprint ADR D1 — changing `scoring.ts` would reweight for ALL callers (not opt-in) + break v1.5 parity. The `diversify`/`rerank` stages are the shipped template. **Alternatives:** base-score term (rejected — not opt-in); RRF fusion (rejected — fuses by rank position, cannot express per-scope boost).

### D2 — Deterministic scope-weight from Princípio 1 signals, NOT a neural reranker

**Decision:** the weight is bounded deterministic arithmetic over scope-of-origin + recency (age) + `confirmation_count`; no model dependency; mutually exclusive with `rerank` (the cross-encoder), like `diversify`.

**Rationale:** blueprint ADR D2 — explainable, dep-free; the cross-encoder is ROADMAP Item 23. **Alternative:** LLM-judged reweight (rejected — cost per recall; the signals are free + shipped).

### D3 — Extend the recall `search` projection to carry the recency signal (prerequisite)

**Decision:** add `created_at, last_accessed_at` to the vector `search` `cols` (`pgvector-store.ts:514-516`) + map them in `rowToResult`, so the pipeline carries real timestamps (stop hardcoding `now` at `pipeline.ts:531-532`).

**Rationale:** blueprint ADR D3 — recency is uncomputable without it; the column plumbing exists on `getAll`. **Alternative:** a second query for timestamps (rejected — N+1 on the hot path). **Drawback:** two extra projected columns on the hottest query — benchmarked (cheap).

## Dependency Graph

```
Phase 1 (projection + options) ─→ Phase 2 (reweight fn) ─→ Phase 3 (pipeline wire + attribution) ─→ Phase 4 (recall@k + isolation + benchmark)
  T1.1 search cols + rowToResult    T2.1 scope-reweight     T3.1 pipeline stage + RecallOptions.scopes   T4.1 recall@k/isolation e2e
  T1.2 RecallOptions.scopes                                  T3.2 attribution surfaced                     T4.2 recall@k benchmark
```

Phase 2 depends on Phase 1 (needs the timestamps). Phase 3 depends on Phase 2. Phase 4 depends on Phase 3.

## Phase 1 — Carry the recency signal + the opt-in field

### T1.1 — Extend the vector `search` projection with the timestamps

#### Files to edit
- `packages/core/src/infrastructure/db/pgvector-store.ts` (`cols` + `rowToResult`)
- `packages/core/src/infrastructure/db/pgvector-store.test.ts` (assert the SQL projects the columns)

#### Why this step
The recency boost reads `created_at`/`last_accessed_at`; today the vector `search` omits them, so `rowToItem` hardcodes `now` — recency is a constant, boost is a no-op. This is the load-bearing prerequisite (ADR D3).

#### TDD
- `RED: test_search_sql_projects_created_at_and_last_accessed_at` — the `search` SQL string includes `created_at` + `last_accessed_at` in `cols`; a real-pgvector search returns a row whose mapped `createdAt` equals the stored value (not `now`).

#### Failure scenarios
- A legacy row with NULL `last_accessed_at` → mapped as `undefined`, the reweight treats absent recency as neutral (no throw).

#### Concurrency tests
(none — single-threaded read projection)

#### Acceptance criteria
- The `search` result carries real `createdAt` + `lastAccessedAt`; `npm run typecheck` 0; existing recall tests stay green.

### T1.2 — Add `RecallOptions.scopes`

#### Files to edit
- `packages/core/src/domain/options.ts`
- `packages/core/src/domain/options.test-d.ts` (type-level: the field is optional)

#### Why this step
The opt-in trigger for the scope-aware stage; default (omitted) preserves today's recall (D1).

#### TDD
- `RED: test_recall_options_scopes_optional` — `RecallOptions` type-checks with and without `scopes`; the shape carries the reweight weights (session recency weight, global stability weight, bounds).

#### Concurrency tests
(none — type-level)

#### Acceptance criteria
- Optional field; backward-compatible; documented weights with defaults.

## Phase 2 — The deterministic scope-aware reweight

### T2.1 — `scopeAwareReweight` pure function

#### Files to edit
- `packages/core/src/domain/retrieval/scope-reweight.ts` (NEW)
- `packages/core/src/domain/retrieval/scope-reweight.test.ts` (NEW)

#### Why this step
The reweight is a pure, deterministic, explainable function (Princípio 3) — unit-testable in isolation (the mem0 `test_scoring.py` order-test template).

#### TDD
- `RED: test_session_row_recency_boost_reorders` — given two session rows with equal base score but different `createdAt`, the newer is ranked higher after reweight.
- `RED: test_global_row_stability_boost_reorders` — two global rows equal base score, higher `confirmation_count` ranked higher.
- `RED: test_bounds_and_determinism` — the reweight is bounded (never inverts a large base-score gap arbitrarily) and deterministic given inputs; absent recency (undefined timestamp) is neutral.

#### Concurrency tests
(none — pure function)

#### Acceptance criteria
- Pure (no I/O); deterministic; bounded; session→recency, global→stability; documented weight formula.

## Phase 3 — Wire the opt-in stage + attribution

### T3.1 — Insert the scope-reweight stage into the pipeline (opt-in)

#### Files to edit
- `packages/core/src/domain/retrieval/pipeline.ts`

#### Why this step
Mirror the shipped `diversify`/`rerank` post-threshold stage: when `options.scopes` is set, apply `scopeAwareReweight` AFTER threshold + BEFORE topK; mutually exclusive with `rerank` (guard like `RerankerConflict`); `emitEvent` observability; fail-soft.

#### TDD
- `RED: test_pipeline_applies_scope_reweight_when_scopes_set` — with `scopes`, the post-threshold order reflects the reweight; without it, order is byte-identical to today. A `scopes`+`rerank` combo throws the conflict guard.

#### Failure scenarios
- The reweight throws → fail-soft: recall returns the un-reweighted (base-score) order + an OTel `scope_reweight_failed` event (never crashes recall).

#### Concurrency tests
(none — single recall call)

#### Acceptance criteria
- Caller present (pipeline stage); opt-in; default unchanged; mutual-exclusion with rerank; OTel event.

### T3.2 — Surface attribution on scope-aware results

#### Files to edit
- `packages/core/src/domain/retrieval/pipeline.ts` (ensure `attributedTo` is carried — already hoisted; assert it survives the reweight)

#### Why this step
ROADMAP M10 DoD: attribution (user/agent) surfaced on each result.

#### TDD
- `RED: test_attribution_survives_scope_reweight` — a recalled row keeps its `attributedTo` through the reweight stage.

#### Concurrency tests
(none)

#### Acceptance criteria
- `attributedTo` present on scope-aware results.

## Phase 4 — Integration Validation (the hard gate)

### T4.1 — recall@k + isolation e2e on real pgvector

#### Files to edit
- `tests/integration/recall/scope-aware-ranking.test.ts` (NEW)

#### Why this step
The M10 DoD hard gate: prove the scope-aware ranking + cross-user isolation on real `ankane/pgvector`.

#### TDD
- `RED: test_scope_aware_ranking_and_isolation` — user A: a fresh session fact + a stale session fact + a high-`confirmation_count` global fact + a one-off global fact. A session recall with `scopes` ranks: fresh-session > stale-session, durable-global > one-off-global. User B in the same workspace: scope-aware recall returns 0 of A's rows (the FULL `(workspace_id, user_id)` filter — ROADMAP M10 risk #1 hard gate).

#### Failure scenarios
- pgvector unavailable (`THEOMEM_PG_URI` unset) → `describe.skip` (no false green).

#### Concurrency tests
(none — read path)

#### Acceptance criteria
- The GOAL TEST passes on real pgvector; isolation held; ranking order correct.

### T4.2 — recall@k benchmark (before/after)

#### Files to edit
- `benchmarks/m10-scope-aware-recall.bench.mjs` (NEW) + `docs/benchmarks/m10-scope-aware-recall.md`

#### Why this step
ROADMAP M10 risk #2 mitigation: prove the weights improve (or don't regress) recall@k on a fixture set; benchmark the extra projection cost (D3).

#### TDD
- `RED: bench asserts recall@k with scope-aware ≥ recall@k baseline on the fixture set` (or documents the delta honestly).

#### Acceptance criteria
- A reproducible recall@k benchmark with numbers (mean over ≥ 3 runs) + the projection-cost measurement.

## Coverage Matrix

| M10 DoD item (ROADMAP) | Task(s) |
|---|---|
| `RecallOptions.scopes` opt-in union (default single-scope) | T1.2 + T3.1 |
| Scope-aware ranking (session recency, global stability) + attribution surfaced | T2.1 + T3.1 + T3.2 |
| Cross-user isolation PROVEN (hard gate) | T4.1 (reuses composeFilters upstream — the blueprint's isolation-reuse decision) |
| Integration test (real pgvector): session fact surfaces, stale deprioritized, global surfaces, no cross-user leak | T4.1 |
| recall@k benchmark before/after | T4.2 |
| (prerequisite) recency signal available on recall | T1.1 |

100% of the M10 DoD maps to ≥ 1 task.

## Drawbacks & Risks

1. **Bad scope weights bury durable facts under session noise (HIGH).** **Mitigation:** bounded deterministic weights (never invert a large base-score gap); the recall@k benchmark (T4.2) gates the weights; weights documented + tunable. **Owner:** T2.1. **Severity:** HIGH.
2. **The extra projection columns cost on the hottest query (MEDIUM).** **Mitigation:** two cheap columns; benchmarked (T4.2 projection-cost). **Owner:** T1.1. **Severity:** MEDIUM.
3. **Editing the 1187-LoC pgvector-store.ts + 611-LoC pipeline.ts trips the 300-LoC quality-hook budget (MEDIUM).** **Mitigation:** pre-existing over-budget files; the changes are minimal additions (projection + one stage) — document the deferral (schema.ts precedent), do not split in M10 (KISS/YAGNI). **Owner:** T1.1/T3.1. **Severity:** MEDIUM.

## Unresolved Questions

- Should `scopes` also re-rank the AGENT tier? **Resolved:** NO — M10 is session-vs-global per the ROADMAP; agent-tier ranking is out of scope (YAGNI).
- Exact weight formula (linear vs sigmoid recency decay)? **Resolved at plan time:** start with a bounded linear age-decay for session + a log-scaled `confirmation_count` for global; the benchmark (T4.2) validates; tunable via `RecallOptions.scopes`. (none other — every decision resolved at plan time.)

## Failure scenarios

- pgvector timeout on the projection-extended search → same error path as today (the extra columns don't change failure modes); T1.1 tests a NULL `last_accessed_at` (neutral).
- The reweight throws → recall fails-soft to base-score order + `scope_reweight_failed` OTel event (T3.1) — recall never crashes.
- `scopes` + `rerank` both set → the mutual-exclusion guard throws a typed error (T3.1) — fail-fast, no silent precedence.

## Global Definition of Done

- `npm run typecheck` 0, `npm run lint` 0.
- Contract tier: T1.2 + T2.1 + T3.1 + T3.2 unit tests green.
- Integration tier (real pgvector): T4.1 recall@k + isolation green; T4.2 benchmark produced.
- Wiring triad: caller (pipeline stage T3.1), integration test (T4.1), runtime metric (`scope_reweight_applied` / `scope_reweight_failed` OTel event).
- `CHANGELOG.md [Unreleased]` updated.
- Default recall (no `scopes`) byte-identical (backward-compat).

## Final Phase: Integration Validation

The plan is NOT complete until `npm run test:integration` (real pgvector) passes T4.1 + produces the T4.2 benchmark AND `npm test` passes the unit tier, with `npm run typecheck` + `npm run lint` clean. The cross-user isolation hard gate (T4.1: user B sees 0 of user A's rows under scope-aware recall) is the eat-your-own-cooking gate.
