---
slug: knowledge-update-supersession
milestone_id: M23
created_at: 2026-07-25
goal: Make write/reflect-time supersession catch different-wording knowledge-updates so recall returns the fresh value, proven by a keyless real-strings fixture (stubbed LLM) + an honest bench re-run.
issue: 144
---

# Plan: Knowledge-update supersession that moves the real case (#144)

> **Version 1.0** — The M22 read-time `recencyCollapse` (cosine@0.9) STRUCTURALLY cannot catch same-fact-different-wording updates (empirically: the real `6a1eabeb` pair shares 0 entities, cosine 0.51). The #144-suggested entity-gate is a proven FALSE-FIX (won't fire + precision regression). The robust fix is **write/reflect-time LLM supersession** — TheMemory already has ~90% of the machinery (`LlmJudgedMergeConflictPolicy` → `persistConsolidations` sets `t_invalid` → recall filters `t_invalid IS NULL`). This plan closes the gaps: (a) the e2e-qa harness/consumer never calls `reflect`; (b) the consolidation cluster abstains when > `clusterCap` (20). Primary evidence is a keyless deterministic fixture on the REAL two sentences + real embeddings (not M22's near-identical stubs); the bench re-run is honest real-case validation.

## Goal

> "Enable write/reflect-time supersession to catch a same-fact update expressed with different wording so that recall returns the fresh value, measured by a keyless deterministic fixture (`packages/eval/src/stages/knowledge-update`) where — on the REAL two sentences + real embeddings — read-time `recencyCollapse` still returns the stale value (counter-proof) BUT `reflect({conflictResolution})` with a stubbed LLM sets `t_invalid` on the older row and recall returns the fresh value, AND a same-entity-different-attribute pair is NOT superseded."

## Context

#144 (found via the M22 mem0-LongMemEval re-run, `docs/benchmarks/m22-e2e-qa-longmemeval.md`): recall returns stale `27:12` (gold `25:50`) even with `recencyCollapse` on. Empirical DISCOVER (blueprint `knowledge-update-supersession`) proved the read-time entity fix is infeasible (0 shared entities, cosine 0.51) and identified write-time supersession as the robust path, ~90% already built. mem0 does per-write ADD/UPDATE/DELETE (`references/mem0/mem0/memory/main.py:1972-2016`); TheMemory supersedes via `t_invalid` (ADD-only, richer audit).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/conflict-resolution/llm-judged-merge.ts` | 119 | `23e97f8` (2026-07-16) | LLM-judged merge policy; abstains when cluster > `clusterCap` (20, `:95`) | Existing abstain semantics preserved unless the scale fix is applied; ADD-only |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | 1349 | `328e43c` (2026-07-24) | `recallConsolidationCandidates` (`:1177`, whole-scope, no LIMIT) + `persistConsolidations` (`:1225` sets `t_invalid`) + main recall `t_invalid IS NULL` (`:523`) | Recall `t_invalid` filter unchanged; supersession stays soft (Princípio 3) |
| `packages/core/src/infrastructure/db/reflect-orchestrator.ts` | 311 | `ed0865b` (2026-07-22) | Wires reflect → conflict policy → persist | Reflect contract unchanged |
| `packages/eval/src/stages/e2e-qa/run.ts` | 279 | `c84eba1` (2026-07-25) | e2e-qa harness (`reflectionPolicy: manual`, never reflects — `:254`) | Key-gate + SKIP unchanged; recencyCollapse stays on |
| `packages/eval/src/stages/knowledge-update/golden.ts` | 57 | `b87fb16` (2026-07-25) | M22 fixture (near-identical stub vectors) | REPLACED/extended with the REAL two sentences + real embeddings |
| `packages/eval/src/stages/knowledge-update/run.ts` + `run.test.ts` | — | `b87fb16` | M22 fixture runner/test | Extended with the 3 new deterministic cases |
| `docs/benchmarks/m23-knowledge-update.md` (NEW) | 0 | — | (evidence) | — |
| `CHANGELOG.md` | — | — | Public contract | `[Unreleased]` Fixed/Changed |

### Current callers / dependents

- `LlmJudgedMergeConflictPolicy` — consumed by `reflect-orchestrator.ts` via `reflect({conflictResolution})`. Wiring it in the harness is a consumer-side call, no API change.
- `recallConsolidationCandidates` / `persistConsolidations` (`pgvector-store.ts`) — consumed by the reflect path. Bounding the cluster is internal to the consolidation query.
- Main recall `t_invalid IS NULL` filter (`pgvector-store.ts:523`) — already excludes superseded rows; no change needed for supersession to take effect.

### Domain glossary

- **supersession** — mark an older fact `t_invalid = NOW()` (soft); recall's `t_invalid IS NULL` filter then excludes it. ADD-only: the row persists + is `asOf`-recoverable.
- **consolidation cluster** — the set of live `extracted` rows a conflict policy judges together; NOT cosine-gated (whole scope today).
- **clusterCap** — `LlmJudgedMergeConflictPolicy` abstains when the cluster exceeds this (default 20).
- **different-wording update** — same fact re-asserted with different surface text ("personal best"↔"PB") — cosine-far, so only LLM semantic judgment bridges it.

### Architecture boundaries affected

Domain (conflict policy) + infra (consolidation query / persist) in `packages/core`; consumer-side (harness) in `packages/eval`. No new DIP. Honors `rules/architecture.md` (the domain policy + the infra store are already the seam).

## Prior Art & Related Work

- **Blueprint:** `.claude/knowledge-base/discoveries/blueprints/knowledge-update-supersession-blueprint.md` (empirical feasibility, the false-fix proof, the write-time recommendation, the deterministic evidence plan).
- **Reference (mem0):** `references/mem0/mem0/memory/main.py:1972-2016` — per-write ADD/UPDATE/DELETE.
- **Our machinery:** `llm-judged-merge.ts`, `pgvector-store.ts:1177-1236,523`, `reflect-orchestrator.ts`, existing `llm-judged-merge` conflict tests (stubbed-LLM precedent).

## Objective

- [ ] Keyless deterministic fixture on the REAL two sentences + real embeddings: read-time counter-proof (still stale) + write/reflect proof (stubbed LLM → t_invalid → fresh) + precision guard (same-entity/diff-attribute NOT superseded).
- [ ] If the real cluster abstains (> clusterCap), bound the consolidation cluster (semantic top-k around the fact) so the contradiction pair reaches the judge — WITHOUT silent abstain.
- [ ] e2e-qa harness calls `reflect({conflictResolution})` (remember → reflect → recall).
- [ ] Bench re-run (real LLM): honest report whether `6a1eabeb` moves to `25:50` (changed bench outcome, not a green unit fixture).
- [ ] Full suite green; recall byte-identical when reflect does not run.

## ADRs

### D1 — Reject the read-time entity-gate; fix #144 via write/reflect-time supersession

- Decision: do NOT add an entity-gated read-time collapse; use the existing reflect/LlmJudgedMerge supersession.
- Rationale: empirical — the real pair shares 0 entities + cosine 0.51, so an entity/cosine read-time gate cannot fire, and it regresses precision (same-entity/diff-attribute). Only LLM semantic judgment bridges "personal best"↔"PB".
- Alternatives: entity-gated read-time collapse (blueprint Q2) — rejected (false-fix + precision regression, empirically shown); a brand-new per-write update DIP — rejected as first choice (YAGNI: reflect machinery exists; reuse before building).
- Consequences: supersession is reflect-triggered (the consumer must reflect) — the harness now does; durable + auditable (`t_invalid`, ADD-only).

### D2 — Bound the consolidation cluster ONLY if it empirically abstains at scale

- Decision: keep whole-scope clustering unless the real 6a1eabeb cluster exceeds `clusterCap` (20); then bound to a semantic top-k around the candidate fact (mem0 shape).
- Rationale: YAGNI — don't build the bound speculatively; the blueprint flagged the scale risk but the actual cluster size is empirical. Silent abstain is the failure mode to avoid.
- Alternatives: always bound — rejected (unneeded if cluster ≤ 20); raise clusterCap globally — rejected (a large cluster degrades LLM judgment quality).
- Consequences: if bounded, consolidation becomes semantic-local (like mem0), which is more scalable; if not needed, no change.

### D3 — Primary evidence is the keyless deterministic fixture; the bench is honest real-case validation

- Decision: the DoD gate is the keyless fixture (stubbed LLM, real strings); the bench re-run (real LLM) is reported honestly whether or not it moves.
- Rationale: the bench depends on a real LLM + scale that may not move it; the deterministic fixture proves the mechanism on the real strings without a key. NO false-fix — if the bench doesn't move, say so.
- Alternatives: gate on the bench — rejected (non-deterministic, key-required, can't gate CI).
- Consequences: CI-gateable proof; the bench is a disclosed, illustrative validation.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Real gpt-4o-mini judge doesn't catch the contradiction in the bench | Medium | Deterministic stubbed-LLM fixture is the primary gate; bench reported honestly (D3) | maintainer |
| Cluster > 20 → silent abstain → no supersession | Medium | D2: bound the cluster if empirically needed; assert no silent abstain | maintainer |
| Precision regression (superseding distinct facts about one entity) | Medium | Negative guard test (Google role vs tenure); supersession is LLM-judged not string/cosine; ADD-only preserves via asOf | maintainer |
| Reflect adds LLM cost when wired in the harness | Low | Harness only (eval tool); key-gated; per-user cluster is small | maintainer |

## Unresolved Questions

- Q1 — Is 6a1eabeb's live-extracted-fact cluster ≤ 20 (whole-scope works) or > 20 (needs the bound)? Resolve empirically in T1.
- Q2 — Does real gpt-4o-mini reliably judge "personal best 27:12" vs "PB 25:50" as an update? Resolve in the bench (T4), reported honestly.

## Dependencies

No **new** dependency (parsimony rung 4): reuses the existing reflect/conflict machinery + `@usetheo/memory` (workspace), the in-memory store, `zod`, `tsx`, `vitest`. The LLM in the bench is the already-present `OpenAILLM` via OpenRouter (key-gated); the fixture STUBS the LLM (no dep, no key).

| Dependency | Version | Ecosystem | Rule 9 justification |
|---|---|---|---|
| `@usetheo/memory` | `workspace:*` | npm | The library under test (reflect + recall). |
| `zod` / `tsx` / `vitest` | already pinned | npm | Fixture schema + runner + tests. |

No CVE surface change (no package added). `pnpm audit` before/after unchanged.

## Dependency Graph

```
T1 (empirical: cluster size + real cosine/entity — confirm approach) ──▶ T2 (deterministic fixture: real strings, stubbed LLM)
        │                                                                        │
        ▼                                                                        ▼
T3 (bound cluster IF T1 shows abstain) ──▶ T4 (wire reflect in harness + bench re-run, honest)
```

## Tasks

### Phase 1: Empirical grounding + deterministic fixture

#### T1 — Confirm cluster size + signals for the real case (empirical, keyless)

- **Objective:** determine if the real 6a1eabeb-style ingestion produces a consolidation cluster ≤ clusterCap (whole-scope works) or > 20 (needs D2 bound); confirm the two real sentences + embeddings (cos 0.51).
- **Why:** decides whether D2's bound is needed (YAGNI). Cites blueprint feasibility + `llm-judged-merge.ts:95`.
- **Files:** a probe (throwaway) OR assertions in the fixture; no production change yet.
- **TDD:** RED — a test asserting the cluster reachable by the judge contains BOTH the stale + fresh rows (fails if the whole-scope cluster is > 20 and abstains). Literal: `test_consolidation_cluster_contains_contradiction_pair`.
- **DoD:** cluster-size determination recorded; approach (whole-scope vs bounded) chosen.

#### T2 — Deterministic keyless fixture (real strings, stubbed LLM)

- **Objective:** the honest RED→GREEN the M22 fixture lacked.
- **Why:** proves the mechanism on the REAL sentences + real embeddings (not stubs). Cites blueprint evidence plan.
- **Files:** `packages/eval/src/stages/knowledge-update/golden.ts` (real sentences + real/frozen embeddings), `run.ts`, `run.test.ts` (3 cases).
- **Deep Dives:** (1) read-time counter-proof: `recall({recencyCollapse:{}})` STILL returns `27:12` (locks in read-time can't fix it); (2) write/reflect: `reflect({conflictResolution})` with a stubbed LLM returning `{kept_id:<newer>, rejected_ids:[<older>]}` → assert older `t_invalid` set AND recall returns `25:50`; (3) precision guard: "Google role vs tenure" NOT superseded.
- **TDD:** RED — the write/reflect case fails before the supersession is reachable; GREEN after T3/wiring. Literals: `test_readtime_recencycollapse_still_returns_stale`, `test_reflect_supersedes_diff_wording_update_returns_fresh`, `test_reflect_does_not_supersede_same_entity_diff_attribute`.
- **DoD:** all 3 cases green (keyless, no LLM key); runs under `pnpm --filter @usetheo/memory-eval test`.

### Phase 2: Scale fix (conditional) + harness wiring + bench

#### T3 — Bound the consolidation cluster IF T1 shows abstain (conditional, D2)

- **Objective:** ensure the contradiction pair reaches the judge without silent abstain.
- **Why:** D2 — only if empirically needed. Cites `pgvector-store.ts:1177`, `llm-judged-merge.ts:95`.
- **Files:** `pgvector-store.ts` (`recallConsolidationCandidates` bound to semantic top-k) OR `llm-judged-merge.ts` (handle large clusters) — chosen per T1.
- **TDD:** RED — a >20-row scope with a contradiction pair still supersedes (no abstain). Literal: `test_supersession_reachable_above_cluster_cap`.
- **DoD:** if needed, the bound lands + test green; if not needed (cluster ≤ 20), SKIP with a documented note.

#### T4 — Wire reflect in the e2e-qa harness + bench re-run (honest)

- **Objective:** the harness consolidates before recall; measure the real-case bench outcome.
- **Why:** the harness never reflects today (`run.ts:254`). Legitimate "measure TheMemory used well". Cites D3.
- **Files:** `packages/eval/src/stages/e2e-qa/run.ts` (call `reflect({conflictResolution})` after ingest, before recall), `docs/benchmarks/m23-knowledge-update.md`.
- **Failure scenario (external I/O — LLM):** reflect calls the LLM; on no-key the tier SKIPs (harness is key-gated); on timeout/5xx the reflect fails loudly (no fabricated supersession).
- **DoD:** harness reflects; bench re-run recorded in `docs/benchmarks/m23-knowledge-update.md` with the HONEST 6a1eabeb outcome (moved or not).

## Failure scenarios

External I/O: the LLM (reflect judge) in the bench. Fixture is keyless (stubbed LLM).

| Dependency | Failure mode | Test reproduces | Expected |
|---|---|---|---|
| LLM (reflect judge) | no key | fixture stubs the LLM; bench SKIPs without key | keyless fixture proves mechanism; bench honest SKIP |
| LLM (reflect judge) | cluster > cap | T3 >20-row test | supersession still reachable (bound) OR documented abstain |
| LLM (reflect judge) | wrong judgment | negative guard | same-entity/diff-attribute NOT superseded |

## Coverage Matrix

| Requirement | Task |
|---|---|
| deterministic real-strings fixture (3 cases) | T2 |
| cluster reachable / bound if needed | T1 + T3 |
| harness reflects | T4 |
| bench honest real-case outcome | T4 |
| precision guard | T2 |
| recall byte-identical without reflect | T2 (counter-proof) |

## Global Definition of Done

- [ ] Keyless fixture: read-time counter-proof (still stale) + reflect-supersedes (fresh, stubbed LLM) + precision guard — all green under `pnpm --filter @usetheo/memory-eval test`.
- [ ] Consolidation cluster reaches the judge for the contradiction pair (bounded if T1 shows abstain; else documented ≤ cap).
- [ ] e2e-qa harness reflects; bench re-run recorded with the HONEST 6a1eabeb outcome.
- [ ] `npm test` full suite green; `npm run typecheck` clean; recall byte-identical when reflect does not run.
- [ ] CHANGELOG `[Unreleased]` + `docs/benchmarks/m23-knowledge-update.md`.

## Final Phase: Integration Validation

- [ ] `pnpm --filter @usetheo/memory-eval test` green (the 3 fixture cases).
- [ ] `npm test` full suite green; `npm run typecheck` clean.
- [ ] Bench re-run (with key) recorded honestly.
