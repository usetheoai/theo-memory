---
slug: stale-recall-and-abstention
milestone_id: M22
created_at: 2026-07-25
goal: Add opt-in recall-time most-recent-wins collapse so a stale ADD-only duplicate stops out-ranking the fresh value, proven by a keyless RED→GREEN eval fixture.
---

# Plan: Recall most-recent-wins collapse (#141) + harness abstention (#140)

> **Version 1.0** — Close the two weaknesses the mem0 LongMemEval counter-proof surfaced. **#141 (core):** recall ranking has no recency signal, so two live ADD-only duplicates of the same fact are ordered by relevance only and the stale value can out-rank / crowd out the fresh one. Fix = an opt-in `RecallOptions.recencyCollapse` at the post-threshold seam that collapses near-duplicate candidates keeping the newest `createdAt` (auditable recall-trace drop), never touching the score formula (no entity-boost/#127 regression), honoring ADD-only (ADR-0003). **#140 (harness + honest decline):** recall was honest — the eval-harness *answerer* over-committed; the coverage signal already exists as `MemoryItemWithScore.score`, so a dedicated core field is YAGNI + crosses the LOCKED "memory layer, not agent runtime" boundary. Fix = a deterministic coverage-gate helper in the harness; the core portion is declined with rationale.

## Goal

> "Enable TheMemory consumers to prefer the most-recent value among ADD-only duplicates at recall time so that a stale fact stops out-ranking its update, measured by `packages/eval/src/stages/knowledge-update` returning the newer value (RED without the fix, GREEN with `recencyCollapse`) AND recall being byte-identical when the option is OFF."

## Context

M21's mem0 LongMemEval counter-proof (`docs/benchmarks/m21-e2e-qa-longmemeval.md`) surfaced two failures: **#141** (knowledge-update returned 27:12 instead of the updated 25:50) and **#140** (answerer hallucinated instead of abstaining). The discovery blueprint (`.claude/knowledge-base/discoveries/blueprints/stale-recall-and-abstention-blueprint.md`) established: #141 is a genuine core defect (recall ranking is recency-blind — `scoring.ts:119`); #140 is NOT core-actionable (recall was honest; the coverage signal already exists as `MemoryItemWithScore.score` — a core field is YAGNI). mem0 avoids #141 by mutating in place (`references/mem0/mem0/memory/main.py:1972-2016`); TheMemory is ADD-only (ADR-0003) and reconciles via reflect — the gap is nothing reconciles un-reflected duplicates at read time.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/options.ts` | 364 | `5699de6` (2026-07-23) | `RecallOptions` public surface (topK/asOf/diversify/rerank/scopes) | Additive only; ADR-0008 method-count cap; existing options unchanged |
| `packages/core/src/domain/retrieval/pipeline.ts` | 292 | `4d50bdc` (2026-07-24) | The recall pipeline; post-threshold seam (diversify/rerank/scopes) + `RerankerConflict` guard (`:186`) + `DroppedCandidate` recall-trace (`:110`) | Score formula untouched; default path byte-identical; mutual-exclusion guard extended, not weakened |
| `packages/core/src/domain/retrieval/stages/threshold-filter.ts` | 91 | `4d50bdc` (2026-07-24) | Owns `DroppedCandidate` + `dropReason` union + `recordDrop` helper | Add a `dropReason` literal; existing reasons unchanged |
| `packages/core/src/infrastructure/db/scoped-retrieval.ts` | 205 | `7ee2f2b` (2026-07-25) | Recall entry + recall-cache; cache-bypass list for re-ordering options | `recencyCollapse` MUST join the cache-bypass list (re-orders the pool) |
| `packages/core/src/domain/scoring.ts` | 121 | `5c484b6` (2026-07-24) | Additive score (semantic+bm25+entity) — READ-ONLY here (root cause reference, NOT modified) | NOT modified — the fix is post-combine, not a score term |
| `packages/eval/src/stages/knowledge-update/{run.ts,golden.ts}` (NEW) | 0 | — | (deterministic keyless #141 fixture) | — |
| `packages/eval/src/stages/knowledge-update/run.test.ts` (NEW) | 0 | — | (RED→GREEN assertion) | — |
| `packages/eval/src/stages/e2e-qa/coverage-gate.ts` (NEW) | 0 | — | (#140 harness abstention helper) | — |
| `packages/eval/src/stages/e2e-qa/coverage-gate.test.ts` (NEW) | 0 | — | (pure-function unit test, no key) | — |
| `packages/eval/src/stages/e2e-qa/run.ts` | ~250 | `3e3a1af` (2026-07-25) | e2e-qa answerer | Wire the coverage-gate before the LLM answer call; SKIP behavior unchanged |
| `docs/benchmarks/m22-recency-collapse.md` (NEW) | 0 | — | (deterministic evidence) | — |
| `CHANGELOG.md` | — | — | Public contract | `[Unreleased]` gets Added + Fixed entries |

### Current callers / dependents

- **Symbol:** `RecallOptions` in `options.ts` — consumed by `scoped-retrieval.ts`, `pipeline.ts`, REST (`packages/api`), MCP (`packages/mcp`). Adding an optional field is backward-compatible; no caller breaks.
- **Symbol:** `DroppedCandidate.dropReason` union in `threshold-filter.ts` — consumed by `pipeline.ts:264-278` (recall-trace). Adding a literal is additive.
- **Symbol:** `runPipeline` in `pipeline.ts` — the post-threshold seam (`:182-221`) hosts diversify/rerank/scopes; `recencyCollapse` slots there. `grep -rln 'recencyCollapse'` = absent (new).

### Domain glossary

- **ADD-only** — writes never mutate/delete; an update is `remember(new)` (+ optional `forget(old)`); reconciliation is reflect-time (ADR-0003).
- **near-duplicate collapse** — among candidates with cosine ≥ τ, keep one representative; here keep the newest `createdAt`.
- **post-threshold seam** — the pipeline stage after the semantic gate + score combine and before topK, where diversify/rerank/scopes already act.
- **recall-trace drop** — a `DroppedCandidate` with a `dropReason`, surfaced for auditability (Princípio 3).
- **most-recent-wins** — Princípio 1 recency: the latest asserted value of a fact is authoritative.

### Architecture boundaries affected

Domain-only change in `packages/core/src/domain/retrieval/` + `options.ts`; infra touch in `scoped-retrieval.ts` (cache-bypass). No new DIP interface, no schema change. The `packages/eval` changes are consumer-side (the eval tool). Honors `rules/architecture.md` (domain defines the option; the pipeline stage is pure).

## Prior Art & Related Work

- **Blueprint:** `.claude/knowledge-base/discoveries/blueprints/stale-recall-and-abstention-blueprint.md` (root causes, the 3 weighed options, the deterministic evidence plan).
- **Reference (mem0):** `references/mem0/mem0/memory/main.py:1972-2016` — mutate-in-place (the rejected write-time option c).
- **Reference (graphiti):** `references/graphiti/graphiti_core/edges.py:271-277` — bi-temporal edge invalidation.
- **Our precedent:** `packages/core/src/domain/conflict-resolution/last-write-wins.ts:33-39` (reflect-time most-recent-wins), `pipeline.ts:182-221` (post-threshold opt-in stages), `packages/eval/src/stages/extraction/run.ts` (deterministic keyless eval pattern).

## Objective

- [ ] `RecallOptions.recencyCollapse?: { threshold?: number }` — opt-in; default OFF ⇒ byte-identical recall.
- [ ] Pipeline post-threshold stage collapses near-duplicate candidates keeping newest `createdAt`; dropped older row is a `superseded_recency` recall-trace drop.
- [ ] `recencyCollapse` in the `RerankerConflict` mutual-exclusion set + the recall cache-bypass list.
- [ ] Deterministic keyless `packages/eval/src/stages/knowledge-update/` fixture: RED without the fix, GREEN with it.
- [ ] `#140` harness coverage-gate helper (pure, unit-tested, no key) wired before the answerer LLM call; strengthened abstention rule.
- [ ] `#140` core portion (dedicated `coverage` field) declined explicitly with rationale (commented on the issue).
- [ ] Full suite green; recall byte-identical with the option OFF (non-regression test); benchmark doc.

## ADRs

### D1 — Fix #141 with a recall-time most-recent-wins collapse, NOT a score term and NOT write-time supersession

- Decision: add an opt-in post-threshold `recencyCollapse` stage that collapses near-duplicate candidates keeping the newest `createdAt`.
- Rationale: the score formula (`scoring.ts:119`) must not gain a recency term (it would perturb ALL ranking → precision regression, and risk the M18/#127 numerator-only invariant). Acting only on near-duplicate clusters after combine leaves non-update queries untouched. Honors ADD-only (both rows persist; older recoverable via `asOf`).
- Alternatives considered: (a) global recency score weight — rejected (precision regression, regresses tuned scoring); (b) write-time supersession like mem0/graphiti — rejected (oversized new write-pipeline LLM pass, contradicts minimal ADD-only ADR-0003; TheMemory already delegates this to reflect); (c) recency-only tiebreak — rejected as insufficient (never flips a stale row with higher semantic similarity).
- Consequences: opt-in (byte-identical default); a new τ knob (conservative default ≥ 0.9); read-time only (does not fix the write side — reflect must still run for durable supersession; disclosed honestly).

### D2 — Decline #140's core "coverage" field; fix abstention in the harness

- Decision: do NOT add a core coverage/confidence field; fix the answerer abstention in `packages/eval` with a deterministic coverage-gate helper.
- Rationale: recall was honest; the coverage signal already exists (`MemoryItemWithScore.score`, `memory-item.ts:138-141`). A new field duplicates it (DRY) and crosses the LOCKED "memory layer, NOT agent runtime" override. The defect is answerer discipline, which lives in the eval harness.
- Alternatives considered: a core `coverage`/`confidence` API — rejected (YAGNI + boundary); do nothing — rejected (the abstention failure is real and harness-fixable).
- Consequences: #140 resolved at the harness layer; the honest decline is recorded on the issue. No core surface growth.

### D3 — recencyCollapse joins the cache-bypass + mutual-exclusion sets

- Decision: `recencyCollapse` is added to the `RerankerConflict` mutual-exclusion guard and the recall cache-bypass list.
- Rationale: it re-orders the candidate pool (like diversify/rerank/scopes); a cached plain result would poison a collapse request (`scoped-retrieval.ts:150-160`).
- Alternatives considered: allow combining with rerank/diversify — rejected (undefined interaction; follow the existing exclusion convention).
- Consequences: recencyCollapse cannot be combined with rerank/diversify (documented); cache is bypassed when it is set.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Precision regression from re-ordering | High | Acts ONLY on near-duplicate clusters after combine; opt-in (OFF default byte-identical, proven by a non-regression test); conservative τ ≥ 0.9 | maintainer |
| Cache poisoning (cached plain result served for a collapse request) | Medium | recencyCollapse in the cache-bypass list (D3) | maintainer |
| τ threshold is a new un-tuned knob | Medium | conservative default; opt-in first; validated on the fixture; not default-on this milestone | maintainer |
| Read-time only — write-side stale duplicate persists | Medium | Honest disclosure: durable supersession still needs reflect; this is a read-time mitigation (documented in CHANGELOG + benchmark doc) | maintainer |
| Over-abstention in the harness coverage-gate | Low | τ conservative; helper is opt-in in the harness; unit-tested both ways | maintainer |

## Unresolved Questions

- Q1 — Is `createdAt` monotonic on sequential in-memory-store writes, or must the fixture inject a clock? (Resolve in T2.1 — inject a clock to guarantee distinct ordering; blueprint flagged this fixture risk.)
- Q2 — Should the near-duplicate signal be cosine-only, or also identical normalized entity+attribute link? (Resolve at implementation: cosine-only is the minimal KISS choice; entity-link is a follow-up if cosine proves insufficient on the fixture.)

## Dependencies

No **new** runtime or dev dependency (parsimony ladder rung 4). The core fix is a pure pipeline stage reusing existing candidate embeddings; the eval fixtures reuse `@usetheo/memory` (workspace), the in-memory store, `zod`, `tsx`, `vitest` — all already declared.

| Dependency | Version | Ecosystem | Rule 9 justification |
|---|---|---|---|
| `@usetheo/memory` | `workspace:*` | npm | The library under test (in-memory store + recall). |
| `zod` / `tsx` / `vitest` | already pinned | npm | Fixture schema + runner + tests (established `packages/eval` pattern). |

No CVE surface change (no package added). `pnpm audit` before/after unchanged.

## Dependency Graph

```
Phase 1 (core recencyCollapse) ──▶ Phase 2 (keyless RED→GREEN fixture)
        │                                    │
        ▼                                    ▼
Phase 3 (#140 harness coverage-gate) ──▶ Phase 4 (benchmark + integration validation)
```

Phase 1 blocks Phase 2 (the fixture asserts the new option). Phase 3 is independent (harness-only). Phase 4 is terminal.

---

## Phase 1: Core recall-time most-recent-wins collapse

**Objective:** an opt-in `recencyCollapse` post-threshold stage; default OFF ⇒ byte-identical recall.

### T1.1 — Non-regression guard first (RED): recall byte-identical with the option absent/OFF

#### Objective
Lock the invariant that adding the option does not change default recall.

#### Why this step
1. Add a test asserting that a recall WITHOUT `recencyCollapse` returns the exact same ordered ids before and after the feature lands.
2. TDD RED-first + the #1 risk (precision regression) is guarded before any pipeline change. Cites D1 + Drawbacks row 1.

#### Evidence
`pipeline.ts:127` pure score sort; the opt-in convention `options.ts:167-277`.

#### Files to edit
```
packages/core/src/domain/retrieval/pipeline.test.ts (or a new recency-collapse.test.ts) — RED: default recall unchanged
```

#### TDD
```
RED: assert a fixed candidate set recalls in identical order with no recencyCollapse → passes today, must keep passing
GREEN: (after T1.2) the option OFF path is byte-identical
```
Test literal: `test_recall_byte_identical_when_recency_collapse_off`.

#### Acceptance criteria
- The non-regression test passes with the option OFF after T1.2.

#### DoD
- [ ] Non-regression test present and green.

### T1.2 — Implement `recencyCollapse` option + pipeline stage + `superseded_recency` drop

#### Objective
Collapse near-duplicate candidates keeping newest `createdAt`; record the drop.

#### Why this step
1. Add `RecallOptions.recencyCollapse?: { threshold?: number }` (`options.ts`); add a post-threshold stage in `pipeline.ts` (in the `RerankerConflict` guard set); add a `superseded_recency` literal to `DroppedCandidate.dropReason` (`threshold-filter.ts`).
2. The minimal in-scope fix (D1). Runs after combine → cannot regress scoring.

#### Evidence
the blueprint (option b); `pipeline.ts:110,182-187,264-278`; `threshold-filter.ts:32,50`; `scope-reweight.ts:38-48` (`createdAt` available).

#### Files to edit
```
packages/core/src/domain/options.ts — add recencyCollapse?: { threshold?: number } + JSDoc + mutual-exclusion note
packages/core/src/domain/retrieval/stages/threshold-filter.ts — add 'superseded_recency' to dropReason union
packages/core/src/domain/retrieval/stages/recency-collapse.ts (NEW) — pure stage: cluster by cosine ≥ τ, keep newest createdAt, emit drops
packages/core/src/domain/retrieval/pipeline.ts — wire the stage at the post-threshold seam + RerankerConflict guard
packages/core/src/domain/retrieval/recency-collapse.test.ts (NEW) — unit: near-dups collapse to newest; non-dups untouched; EDGE equal createdAt deterministic; NEGATIVE combined with rerank → RerankerConflict
```

#### Deep Dives
- Algorithm: over the post-threshold candidate pool, for each pair with cosine(emb) ≥ τ, keep the one with max `createdAt`, drop the other with `dropReason='superseded_recency'`. Reuse the MMR-path embeddings (`pipeline.ts:251-259`). Bound O(k²) by `topPool`.
- Invariant: OFF ⇒ stage is a no-op (byte-identical). ADD-only: dropped rows are recall-ordering only, still persisted + `asOf`-recoverable.
- Edge: equal `createdAt` → deterministic tiebreak (e.g. keep higher score, then id). Negative: `recencyCollapse` + `rerank`/`diversify` → `RerankerConflict`.

#### TDD
```
RED: recency-collapse.test.ts — 4 cases (collapse-to-newest / non-dup-untouched / equal-createdAt-deterministic / rerank-conflict) fail (stage absent)
GREEN: implement the stage + option + drop literal + guard
REFACTOR: extract the cosine cluster helper
```
Test literal: `test_recency_collapse_keeps_newest_and_drops_older`.

#### Acceptance criteria
- Near-duplicates collapse to the newest; non-duplicates untouched; OFF path byte-identical (T1.1); combining with rerank/diversify throws `RerankerConflict`.

#### DoD
- [ ] Option + stage + drop literal + guard; unit tests green; T1.1 non-regression green.

### T1.3 — Cache-bypass wiring

#### Objective
`recencyCollapse` bypasses the recall cache.

#### Why this step
1. Add `recencyCollapse` to the cache-bypass condition in `scoped-retrieval.ts` (like `scopes`/`diversify`/`rerank`).
2. Prevents cache poisoning (D3, Drawbacks row 2).

#### Evidence
`scoped-retrieval.ts:150-160`.

#### Files to edit
```
packages/core/src/infrastructure/db/scoped-retrieval.ts — add recencyCollapse to the bypass list
packages/core/src/infrastructure/db/scoped-retrieval.test.ts (or existing) — RED: a set recencyCollapse bypasses the cache
```

#### TDD
```
RED: assert recall with recencyCollapse does NOT read a stale cached plain result → fails (not in bypass list)
GREEN: add to bypass list
```
Test literal: `test_recency_collapse_bypasses_recall_cache`.

#### DoD
- [ ] Bypass wired + test green.

---

## Phase 2: Deterministic keyless evidence (#141)

**Objective:** a RED→GREEN keyless fixture proving the stale value stops winning.

### T2.1 — `packages/eval/src/stages/knowledge-update/` fixture

#### Objective
An LLM-free eval that fails without `recencyCollapse` and passes with it.

#### Why this step
1. `createLocalMemory` with the in-memory store + a stub embedder mapping the two fixture texts to near-identical deterministic vectors; `remember(text,{infer:false})` for old→new with an INJECTED clock (distinct createdAt); assert `recall(q,{recencyCollapse:{}})` returns the newer.
2. Deterministic evidence the issues recommend; runs in CI (no key). Cites the blueprint deterministic-evidence section, `extraction/run.ts:1-60`, `options.ts:14-20` (`infer:false`).

#### Files to edit
```
packages/eval/src/stages/knowledge-update/golden.ts (NEW) — the 2-memory fixture (old value → new value) + injected clock
packages/eval/src/stages/knowledge-update/run.ts (NEW) — runs it, emits a StageScore-like result
packages/eval/src/stages/knowledge-update/run.test.ts (NEW) — RED without recencyCollapse (older or missing), GREEN with it; asserts the superseded_recency drop
```

#### Deep Dives
- Fixture risk (Q1): inject a clock so createdAt is strictly increasing (old < new); a same-ms stamp would test only the tiebreak.
- Stub embedder: near-identical vectors so the two rows are near-duplicates (cosine ≥ τ) and the collapse (not raw relevance) decides — isolates the recall-ranking claim (blueprint caveat).

#### TDD
```
RED: run.test.ts — without recencyCollapse the newer value is NOT guaranteed first (or is crowded out); assertion fails
GREEN: with recencyCollapse:{} the newer value is returned + older is a superseded_recency drop
```
Test literal: `test_knowledge_update_recency_collapse_returns_newer_value`.

#### Acceptance criteria
- RED→GREEN demonstrated; the older row appears as a `superseded_recency` recall-trace drop.

#### DoD
- [ ] Keyless fixture RED→GREEN green; runs under `pnpm --filter @usetheo/memory-eval test`.

---

## Phase 3: #140 harness abstention (coverage-gate)

**Objective:** the answerer abstains on thin coverage; core portion declined.

### T3.1 — Coverage-gate helper + unit test + wire into the answerer

#### Objective
A pure helper `shouldAbstain(recalled, τ)` and its use before the LLM answer call.

#### Why this step
1. Add `packages/eval/src/stages/e2e-qa/coverage-gate.ts` (`shouldAbstain(items, τ) = items.length===0 || max(score) < τ`), unit-test it (no key), and call it in `run.ts` before the answerer — abstaining deterministically when coverage is thin; strengthen the prompt abstention rule.
2. The honest in-scope fix for #140 (D2). The coverage signal is `MemoryItemWithScore.score` — no core change.

#### Evidence
`memory-item.ts:138-141` (`score`); `e2e-qa/run.ts` answerer; `e2e-qa/prompts.ts:31` (existing abstention rule); the blueprint #140 analysis.

#### Files to edit
```
packages/eval/src/stages/e2e-qa/coverage-gate.ts (NEW) — pure shouldAbstain()
packages/eval/src/stages/e2e-qa/coverage-gate.test.ts (NEW) — empty → abstain; all scores < τ → abstain; one ≥ τ → answer
packages/eval/src/stages/e2e-qa/run.ts — call shouldAbstain before the LLM answer; abstain path returns the honest "I don't have that information"
```

#### TDD
```
RED: coverage-gate.test.ts — 3 cases (empty/low/high) fail (helper absent)
GREEN: implement shouldAbstain + wire it
```
Test literal: `test_coverage_gate_abstains_on_empty_or_low_score`.

#### Acceptance criteria
- Pure helper unit-tested (no key); wired before the answerer.

#### DoD
- [ ] Helper + test green; wired; abstention rule strengthened.

### T3.2 — Decline #140's core portion explicitly (honesty)

#### Objective
Record the honest decision that no core coverage field ships.

#### Why this step
1. Comment on #140 with the rationale (coverage signal already exists as `score`; a new field is YAGNI + crosses "memory layer not agent runtime"); the harness coverage-gate is the fix.
2. Rule 3 honesty + Rule 11 YAGNI. Cites D2.

#### Files to edit
```
(no source) — GitHub issue #140 comment + CHANGELOG note
```

#### DoD
- [ ] #140 comment posted with rationale; CHANGELOG records the harness fix + core-decline.

---

## Failure scenarios

External I/O touched: none in the core fix (pure pipeline stage). The eval fixtures use the in-memory store (no DB) + no LLM. The e2e-qa re-validation (LLM) is key-gated and OPTIONAL evidence.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| recencyCollapse + rerank/diversify | invalid combination | unit test combines them | `RerankerConflict` thrown (fail-fast) |
| recall cache | stale plain result for a collapse request | cache-bypass test | bypass — no stale served |
| in-memory clock | equal createdAt | fixture with injected clock | deterministic tiebreak, no flake |

## Coverage Matrix

| Requirement | Task(s) |
|---|---|
| recencyCollapse option, default OFF byte-identical | T1.1 + T1.2 |
| collapse near-dups keep newest + superseded_recency drop | T1.2 |
| mutual-exclusion + cache-bypass | T1.2 + T1.3 |
| keyless RED→GREEN #141 fixture | T2.1 |
| #140 harness coverage-gate + test | T3.1 |
| #140 core decline (honest) | T3.2 |
| non-regression (recall unchanged OFF) | T1.1 |
| benchmark evidence | Final Phase |

## Global Definition of Done

- [ ] `RecallOptions.recencyCollapse?` opt-in; OFF ⇒ byte-identical recall (non-regression test green).
- [ ] Near-duplicates collapse to newest; older = `superseded_recency` recall-trace drop.
- [ ] recencyCollapse in RerankerConflict set + cache-bypass list.
- [ ] Keyless `knowledge-update` fixture RED→GREEN green under `pnpm --filter @usetheo/memory-eval test`.
- [ ] #140 harness coverage-gate helper + pure unit test green; wired.
- [ ] #140 core decline commented on the issue.
- [ ] Full contract suite green (no recall regression); `npm run typecheck` clean.
- [ ] CHANGELOG `[Unreleased]` Added (recencyCollapse) + Fixed (#141) updated.
- [ ] `docs/benchmarks/m22-recency-collapse.md` — the RED→GREEN deterministic evidence.

## Final Phase: Integration Validation

- [ ] `npm test` full suite green (recall byte-identical with the flag OFF).
- [ ] `pnpm --filter @usetheo/memory-eval test` green (knowledge-update fixture GREEN + coverage-gate test).
- [ ] `npm run typecheck` clean.
- [ ] Benchmark doc committed with the RED→GREEN numbers.
