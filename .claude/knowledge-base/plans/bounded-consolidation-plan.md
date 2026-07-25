---
slug: bounded-consolidation
milestone_id: M24
created_at: 2026-07-25
goal: Move the real LongMemEval knowledge-update case 6a1eabeb from stale to fresh in the e2e-qa bench via bounded per-anchor consolidation, raising the bench above the 91.7% baseline.
issue: 146
---

# Plan — M24 Bounded per-anchor consolidation (#146, real fix of #144) + reflect quarantine (#145)

## Context

M23 (v0.48.2) empirically proved (real gpt-4o-mini bench) that whole-scope reflect
does NOT fix the real knowledge-update case: `recallConsolidationCandidates(filters)`
returns the WHOLE live scope as one cluster, and `LlmJudgedMergeConflictPolicy.consolidate`
ABSTAINS when `candidates.length > clusterCap` (default 20, `llm-judged-merge.ts:95`).
A real LongMemEval conversation has > 20 extracted rows → abstain → the contradiction
pair (`6a1eabeb`: "personal best…charity 5K…27:12" vs "My PB is now 25:50") never
reaches the LLM → the stale `27:12` survives. Two clusters also threw
`ReflectionProvenanceMissingError` (#145), aborting the whole reflect.

Grounded in blueprint `knowledge-update-supersession` (SHIPPABLE) and mem0's write-time
ADD/UPDATE/DELETE shape (`references/mem0/mem0/memory/main.py:1972-2016` = per-write
top-k retrieval + LLM judgment, NOT whole-scope).

## Goal

Move the real LongMemEval knowledge-update case `6a1eabeb` from stale (`27:12`) to
fresh (`25:50`) in the e2e-qa bench via bounded per-anchor consolidation, raising the
bench above the 91.7% baseline — measured by a CHANGED bench outcome on `6a1eabeb`
(not a green unit fixture) plus overall accuracy ≥ 91.7%.

## Baseline Context

### Files that will be touched

| File | LoC today | Last touch | Why it exists |
|---|---|---|---|
| `packages/core/src/infrastructure/db/reflect-orchestrator.ts` | 312 | `git log -1` M11 audit | Runs consolidation (whole-scope, l.160-215) + reflect-LLM (l.217-241) |
| `packages/core/src/domain/conflict-resolution/llm-judged-merge.ts` | 120 | v0.7 distillation | Abstains at >clusterCap (l.95) — the scaling wall |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | ~1240 | M15 entity-boost | `recallConsolidationCandidates` (~1177, no embedding, whole-scope); `persistConsolidations` (~1225, sets t_invalid) |
| `packages/core/src/domain/consolidation/cluster-by-proximity.ts` | (NEW) | — | Pure greedy nearest-neighbor clustering, deterministic, unit-testable |
| `packages/eval/src/stages/e2e-qa/run.ts` | ~295 | M23 gated reflect | Harness — wire bounded consolidation on |
| `packages/eval/src/stages/knowledge-update/bounded-consolidation.pg.test.ts` | (NEW) | — | Deterministic keyless proof at scale |

### Current callers

- `runReflection` (reflect-orchestrator.ts:99) — sole caller of `recallConsolidationCandidates` + `conflictPolicy.consolidate`. Grep: `grep -rn 'recallConsolidationCandidates\|\.consolidate(' packages/core/src` → orchestrator + llm-judged-merge tests only.
- `LlmJudgedMergeConflictPolicy.consolidate` — called once per plan, now once per bounded cluster.

### Glossary

- **Cluster cap** — max candidates the LLM judges in one call (20); above it the policy abstains (no call).
- **Bounded per-anchor cluster** — anchor row + its top-k nearest LIVE neighbors by cosine, ≤ clusterCap, disjoint greedy (mem0 shape).
- **Supersede** — `persistConsolidations` sets `t_invalid=NOW()` on rejected rows (soft, auditable, Princípio 3); recall filters `t_invalid IS NULL`.
- **Quarantine (#145)** — skip one provenance-invalid reflect draft (emit event + counter) instead of throwing and aborting the whole reflect.

### Architecture boundaries

Per `architecture.md`: clustering is pure domain logic → new file in `domain/consolidation/`
(no I/O, no store import). The store returns data (candidates + embeddings); the orchestrator
(infrastructure) composes domain clustering with the store + DIP policy. DIP intact:
`ConflictResolutionPolicy` contract unchanged (still `consolidate(candidates, ctx)`), now
called per bounded cluster.

## Prior Art & Related Work

- Blueprint `knowledge-update-supersession` (`.claude/knowledge-base/discoveries/blueprints/`) — empirical grounding: read-time false-fix, write-time robust, scaling gap.
- mem0 `add()` per-write ADD/UPDATE/DELETE (`references/mem0/mem0/memory/main.py:1972-2016`) — the bounded-retrieval shape this mirrors.
- M23 fixture `packages/eval/src/stages/knowledge-update/golden-embeddings.ts` — FROZEN real embeddings (cos(older,newer)=0.5117) reused to prove clustering co-locates the pair.

## ADRs

### ADR-1 — Bounded greedy clustering in a pure domain function (not SQL, not in the policy)

Cluster candidates in a pure `clusterByProximity(candidates, cap)` TS function (greedy
nearest-neighbor, deterministic tie-break by memoryId), fed embeddings the store returns.

- **Alternative A (rejected): per-anchor top-k SQL in the store.** N vector queries (O(N)),
  harder to unit-test deterministically, couples clustering to pgvector. Rejected — clustering
  is pure logic; keep it testable and store-agnostic (`architecture.md` DIP).
- **Alternative B (rejected): raise clusterCap so the whole scope fits.** A 40-row single
  cluster degrades LLM precision (the M23 regression) and still caps out on longer conversations.
  Bounded disjoint clusters keep each LLM call focused. Rejected.
- **Alternative C (rejected): full mem0 per-write pipeline (retrieve+judge on every `remember`).**
  Larger surface, per-write LLM cost on the hot path, touches the public write API. Bounded
  reflect-time consolidation gets the same bench effect with far less surface (KISS/YAGNI). Deferred.

### ADR-2 — #145: quarantine the offending reflect draft, do not abort

`validateProvenance` throws on the FIRST bad draft, discarding all good drafts + aborting
reflect. Change to per-draft validation: skip invalid drafts (emit `reflection_draft_quarantined`
event + counter), persist the valid ones.

- **Alternative (rejected): keep throwing.** One hallucinated `derivedFrom` id aborts an
  otherwise-good reflect — the M23 bench hit this twice. A hard abort on one bad row of many
  violates fail-graceful (Rule 8 recoverable-vs-unrecoverable). Rejected.

## Dependency Graph

```
T1 (store returns embeddings) ─┐
T2 (clusterByProximity pure)  ─┼─→ T3 (orchestrator bounded loop + #145 quarantine) ─→ T4 (pg proof) ─→ T5 (harness wire + bench)
```

T1 and T2 parallelize; T3 depends on both; T4 depends on T3; T5 depends on T4.

## Phase 1 — Core

### T1.1 — `recallConsolidationCandidates` returns the embedding

#### Why this step

The pure clustering function needs each candidate's vector; the store already has it
(`embedding` column). Return it alongside `{memoryId,text,createdAt,confirmationCount}`.
Reasoning: clustering must be store-agnostic (ADR-1), so the store supplies data, not logic.

#### Files to edit
- `packages/core/src/infrastructure/db/pgvector-store.ts` (add `embedding: number[]` to the candidate row + SELECT it)
- `packages/core/src/infrastructure/db/reflect-orchestrator.ts` (widen `VectorStoreWithConsolidation` candidate type with optional `embedding`)

#### TDD
- `test_recallConsolidationCandidates_returns_embedding_vector`: given 2 remembered rows, assert each returned candidate has a `readonly number[]` embedding of the configured dim. RED first (field absent), GREEN by selecting the column.

#### Acceptance criteria
- Candidate row type has `embedding?: readonly number[]`; pgvector impl populates it; existing consolidation still works (backward-compatible — field optional).

### T2.1 — `clusterByProximity(candidates, cap)` pure greedy clustering

#### Why this step

Turns a flat candidate list into disjoint bounded clusters so each contradiction pair
reaches the LLM in a cluster ≤ cap. Pure + deterministic → unit-testable without a DB or LLM.
Reasoning: this is the whole fix's core mechanism; isolating it as a pure fn (ADR-1) lets us
prove co-location deterministically with the FROZEN real embeddings.

#### Files to edit
- `packages/core/src/domain/consolidation/cluster-by-proximity.ts` (NEW)
- `packages/core/src/domain/consolidation/cluster-by-proximity.test.ts` (NEW)

#### TDD
- `test_clusters_are_bounded_by_cap`: 25 candidates, cap=20 → every cluster ≤ 20, all candidates covered exactly once (disjoint).
- `test_mutual_nearest_pair_lands_together`: using FROZEN golden embeddings (EMB_OLDER_5K cos 0.5117 to EMB_NEWER_5K, both far from 20 filler vectors) → the two PB candidates land in the SAME cluster. This is the real-case co-location proof.
- `test_deterministic_tie_break_by_memory_id`: equal distances → stable order by memoryId (no `Math.random`).
- Singleton cluster (1 candidate) is dropped (nothing to consolidate) — matches the `<2` guard.

#### Acceptance criteria
- Pure function (no imports of store/LLM/`Date`/`Math.random`); clusters disjoint, ≤ cap, cover all inputs; mutual-nearest pair co-located; deterministic.

## Phase 2 — Wire + robustness

### T3.1 — Orchestrator: bounded consolidation loop

#### Why this step

Replace the single whole-scope `consolidate(candidates)` call with: cluster candidates via
`clusterByProximity`, then `consolidate` each cluster, aggregating results. Removes the
abstain-at-scale wall while keeping each LLM call focused. Reasoning: this is where the
bench-moving behavior lands — ADR-1 composed at the composition point.

#### Files to edit
- `packages/core/src/infrastructure/db/reflect-orchestrator.ts` (l.172-215 region)

#### TDD
- `test_orchestrator_consolidates_each_bounded_cluster`: stubbed store returns 25 candidates spanning 2 semantic groups; stubbed policy records call counts → asserts `consolidate` called per bounded cluster (≥2 calls), NOT once with 25 (which would abstain). Persisted supersessions aggregated.

#### Acceptance criteria
- With >clusterCap candidates, consolidation still supersedes (no silent abstain); `persistConsolidations` receives the union of per-cluster results.

### T3.2 — #145: quarantine invalid reflect drafts instead of aborting

#### Why this step

The post-consolidation reflect-LLM (`executeReflection` → drafts → `validateProvenance`)
throws on the first bad draft, aborting everything. Validate per-draft; skip invalid ones
(emit `reflection_draft_quarantined` + counter), persist valid ones. Reasoning: one
hallucinated `derivedFrom` id must not discard a good reflect (Rule 8 fail-graceful); the
M23 bench aborted twice on this.

#### Files to edit
- `packages/core/src/infrastructure/db/reflect-orchestrator.ts` (l.240-241 validateProvenance)
- `packages/core/src/domain/reflection/provenance.ts` (add a per-draft `isDraftProvenanceValid(draft, sourceIds)` predicate reused by the existing `validateProvenance`)

#### TDD
- `test_invalid_draft_is_quarantined_not_thrown`: 3 drafts, 1 with an unknown `derivedFrom` id → the 2 valid drafts persist, the invalid one is skipped, `reflection_draft_quarantined` emitted, NO throw.
- `test_all_valid_drafts_still_persist_unchanged`: regression — all-valid input behaves exactly as before.

#### Acceptance criteria
- A single provenance-invalid draft never aborts reflect; valid drafts persist; a typed observable event records each quarantine (Princípio 3).

## Phase 3 — Proof + bench

### T4.1 — Deterministic keyless pg proof at scale

#### Why this step

Prove the mechanism moves the REAL case at REAL scale WITHOUT a key: remember the two real
`6a1eabeb` sentences PLUS 25 filler facts (real strings), reflect with a STUBBED LLM whose
judge returns `{kept_id:<newer>, rejected_ids:[<older>]}` only for the cluster containing both
PB facts → assert the older row's `t_invalid` is SET and recall returns `25:50`, EVEN THOUGH
total scope > clusterCap (which pre-fix would abstain). Reasoning: this is the honest at-scale
test M23 lacked — the whole-scope path abstains here; the bounded path must not.

#### Files to edit
- `packages/eval/src/stages/knowledge-update/bounded-consolidation.pg.test.ts` (NEW)

#### TDD (this task IS a test)
- `test_bounded_consolidation_supersedes_at_scale_over_cluster_cap`: 27 rows (>20) vs real pgvector, stubbed LLM → `SELECT text,t_invalid FROM memories` shows the stale PB row's `t_invalid` non-null; recall returns `25:50`. The pre-fix whole-scope path is asserted to abstain (control) via the `cluster_too_large` counter on a whole-scope call.
- `test_precision_guard_same_entity_different_attribute_survives`: Google role vs tenure in the filler set → NOT superseded.

#### Acceptance criteria
- At scope > clusterCap, the bounded path supersedes the stale PB row (recall → `25:50`); precision guard holds; keyless (stubbed LLM), real pgvector.

### T5.1 — Wire into harness + real-LLM bench

#### Why this step

Enable bounded consolidation in the e2e-qa harness (reflect with `LlmJudgedMergeConflictPolicy`,
now bounded) and re-run the real-LLM bench to measure whether `6a1eabeb` moves and overall
accuracy ≥ 91.7%. Reasoning: the Goal's metric is a CHANGED bench outcome on the real dataset,
not a unit fixture (the M23 lesson).

#### Files to edit
- `packages/eval/src/stages/e2e-qa/run.ts` (enable reflect with bounded consolidation as default; keep the E2E_QA_REFLECT gate removable once proven)
- `docs/benchmarks/m24-bounded-consolidation.md` (NEW — honest results)

#### TDD
- Harness change covered by T4 mechanism proof; the bench itself is the acceptance measurement (real LLM, documented, reproducible).

#### Acceptance criteria (THE GOAL TEST)
- Real-LLM bench: `6a1eabeb` returns `25:50` (was `27:12`); overall accuracy ≥ 91.7%. If the real dataset + real gpt-4o-mini do NOT move it, report honestly (do not paper over) and the milestone stays `[ ]`.

## Coverage Matrix

| Requirement / gap | Task |
|---|---|
| Candidates carry embeddings for clustering | T1.1 |
| Bounded disjoint clustering, pair co-located | T2.1 |
| Orchestrator judges each bounded cluster (no abstain at scale) | T3.1 |
| #145 quarantine (no abort on one bad draft) | T3.2 |
| At-scale supersession proven keyless vs real pgvector | T4.1 |
| Real-LLM bench moves 6a1eabeb, ≥91.7% | T5.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Bounded clustering may still not surface 27:12 in the anchor's cluster (cos 0.51) | HIGH | T2.1 proves co-location with FROZEN real embeddings before any bench spend; filler vectors are far, so 27:12 is the anchor's nearest | impl |
| Real gpt-4o-mini judge may not supersede / may over-supersede (precision) | MEDIUM | T4.1 precision guard (same-entity/diff-attribute survives) + honest bench report; keep OFF-by-default until bench proves ≥91.7% | impl |
| Per-cluster LLM calls raise cost/latency vs one abstained call | MEDIUM | disjoint greedy clustering → ≤ N/cap calls, not N; reflect is a batch op, not the hot path | impl |
| Bench cost (real key) | LOW | N=12 deterministic subset; isolated DB dropped after; key gitignored + deleted | impl |

## Unresolved Questions

- Should bounded consolidation eventually move to true per-write (mem0 exact shape) on `remember`? Deferred to a future milestone (ADR-1 alt C) — reflect-time bounded is the minimal bench-mover.

## Failure scenarios

- **pgvector nearest-neighbor query returns fewer than k neighbors** (small scope): clustering degrades to whole-scope (≤ cap) — same as today, no abstain. Test: T2.1 bounded-by-cap with < cap inputs = one cluster.
- **LLM returns non-JSON / invalid kept_id** for a cluster: `parseConsolidationResponse` → null → that cluster abstains (existing behavior), other clusters proceed. Covered by existing llm-judged-merge tests + T3.1 aggregation.

## Global DoD

- `pnpm build` + `pnpm typecheck` + `pnpm lint` clean (0 warnings).
- New files ≤ 300 LoC (hook gate); pure domain fn has no I/O import.
- CHANGELOG `[Unreleased]` updated (Rule 6).
- `/code-quality` verdict ∉ {FAIL_HARD, INVALID}.
- T4.1 passes vs real `ankane/pgvector:v0.5.1`.
- THE GOAL TEST (T5.1) measured and documented honestly.

## Final Phase — Integration Validation

Full chain green (test/typecheck/lint/coverage) + T4.1 pg proof + the real-LLM bench recorded in `docs/benchmarks/m24-bounded-consolidation.md`. Milestone flips `[x]` ONLY if the bench moves `6a1eabeb` and stays ≥ 91.7% — otherwise honest `[ ]` + follow-up.
