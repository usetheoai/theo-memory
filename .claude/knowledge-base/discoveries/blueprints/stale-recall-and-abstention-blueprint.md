---
slug: stale-recall-and-abstention
milestone_id: M22
kind: discovery-blueprint
date: 2026-07-25
issues: [141, 140]
verdict: SHIPPABLE
references:
  - packages/core/src/domain/scoring.ts (no recency signal — root cause #141)
  - packages/core/src/domain/retrieval/pipeline.ts (post-threshold seam)
  - .claude/knowledge-base/references/mem0/mem0/memory/main.py (mutate-in-place contrast)
  - .claude/knowledge-base/references/graphiti/graphiti_core/edges.py (bi-temporal edge invalidation)
---

# Blueprint — #141 stale-recall + #140 abstention (minimal in-scope fixes)

Deep-research output. Every claim cites `file:line` or a reference path. No code.

## Executive summary

| Issue | Core bug? | Minimal in-scope fix | Milestone verdict |
|---|---|---|---|
| **#141 knowledge-update** | **YES** — recall ranking has zero recency signal; two live ADD-only duplicates order by relevance only, so the stale value can outrank the fresh one. | **Recall-time most-recent-wins collapse over near-duplicate candidates** (opt-in), auditable via the existing recall-trace drop. Reject a recency *score term* (precision regression) and reject write-time supersession (mem0/graphiti architecture — oversized, contradicts ADD-only ADR-0003). | **M22 — real core milestone.** |
| **#140 abstention** | **NO** — recall was honest; the *answerer* (eval harness) over-committed. The coverage signal a consumer needs already exists as `MemoryItemWithScore.score`. | Harness-only answerer-abstention discipline in `packages/eval`. A dedicated core "coverage" field is YAGNI + crosses the LOCKED "memory layer, NOT agent runtime" boundary. | **NOT a core milestone — decline core portion (honest), fix harness.** |

## #141 — root cause (cited)

- The composite score is purely relevance, no recency term: `scoring.ts:119` (`sum = semantic + bm25 + entityBoostScore`), documented "dumb arithmetic" `scoring.ts:107-110`.
- Final order is a pure score sort, no age tiebreak: `retrieval/pipeline.ts:127` (`sort((a,b)=>b.score-a.score)`), top-K at `pipeline.ts:283`. Recall SQL orders by vector distance only: `pgvector-store.ts:556,563`.
- Both duplicates are live: default temporal predicate `t_invalid IS NULL` (`temporal-where.ts:35`); recall already excludes superseded (`superseded_by IS NULL`, `pgvector-store.ts:262-263`, `scope-filters.ts:55,59`) — **but nothing marked either row superseded** because reflect/consolidation did not run.
- **Honest caveat:** the e2e-qa harness ALREADY re-sorts newest-first (`e2e-qa/run.ts:143-150`) and the prompt says "most-recent wins" (`e2e-qa/prompts.ts:29`) — yet it failed. The newer memory most likely fell below `topK=10` and was never presented. The fixture (below) must isolate the recall-ranking claim so the fix is not over-credited.

## #141 — the fix (weighed)

Constraints: ADD-only (ADR-0003), don't regress M18 entity-boost/#127 numerator-only (`scoring.ts:58-97`), KISS/YAGNI.

- **(a) recency tiebreak** at final sort — too weak: only flips near-equal scores; a stale row with higher semantic similarity never flips. Keep as a secondary determinism guard, not the fix.
- **(b) recall-time most-recent-wins collapse** — among near-duplicate candidates (cosine ≥ τ over the already-embedded pool), keep the newest `createdAt`, drop the older as an auditable recall-trace drop (`dropReason: 'superseded_recency'`). Reuses: MMR batch-embed (`pipeline.ts:251-259`), `createdAt` already surfaced (`scope-reweight.ts:38-48`), post-threshold seam + `RerankerConflict` mutual-exclusion (`pipeline.ts:182-187`), recall-trace `DroppedCandidate` (`pipeline.ts:110,264-278`). Runs AFTER combine → cannot regress entity-boost/#127. Honors ADD-only (both rows persist; only ordering changes; older recoverable via `asOf`). **RECOMMENDED.**
- **(c) write-time supersession** — what mem0 (`references/mem0/mem0/memory/main.py:1972-2016`, UPDATE event `:2022`) and graphiti (`references/graphiti/graphiti_core/edges.py:271-277`) do. Oversized: a new write-pipeline LLM contradiction pass, contradicts minimal ADD-only. TheMemory already delegates this to reflect (`last-write-wins.ts:33-39,99`) — the gap is only that reflect must run. **Reject as this milestone's fix.**

**Shape:** a new `RecallOptions.recencyCollapse?: { threshold?: number }` at the post-threshold seam (`pipeline.ts:182-221`), in the `RerankerConflict` mutual-exclusion set + the cache-bypass list (`scoped-retrieval.ts:153-160`, since it re-orders). Default OFF ⇒ byte-identical recall (project opt-in convention, `options.ts:167-277`). Additive, backward-compatible, ADR-0008 method-count preserved (one optional param, zero new methods).

## #141 — deterministic evidence (no LLM key)

Mirror the extraction stage (LLM-free, real numbers, Zod, fail-closed — `extraction/run.ts:1-60`). New sub-stage `packages/eval/src/stages/knowledge-update/`:
1. `createLocalMemory` with the **in-memory store** (`in-memory-store.ts`) + a **stub embedder** mapping the two fixture texts to near-identical deterministic vectors (isolates the ranking claim per the caveat).
2. `remember(text, { infer: false })` (`options.ts:14-20`) for "PB is 27:12" then "PB is now 25:50", with distinct monotonic `createdAt` (inject a clock or verify the in-memory store stamps increasing — **fixture risk to flag**).
3. Assert `recall("charity 5K personal best", { recencyCollapse: {} })` returns the newer ("25:50") ahead of/instead of the older. **RED today** (recency-blind order can surface the older), **GREEN after (b)**; the dropped older row appears as a `superseded_recency` recall-trace drop.

## #140 — root cause + YAGNI verdict

Recall was honest (`docs/benchmarks/m21-e2e-qa-longmemeval.md:36-38`); the answerer already has an abstention rule (`e2e-qa/prompts.ts:31`) and handles empty recall (`run.ts:145`). The failure is `gpt-4o-mini` prompt-adherence when recall returns related-but-insufficient memories — not a memory-layer defect. The coverage signal already exists: `MemoryItemWithScore.score` in [0,1] (`memory-item.ts:138-141`) — a consumer abstains via `results.length===0 || results[0].score < τ`. A dedicated core `coverage` field is YAGNI (Rule 11) + DRY violation + crosses "memory layer, not agent runtime". **Decline the core portion explicitly.**

**Harness-only fix:** a deterministic pre-answer **coverage-gate helper** in `packages/eval/src/stages/e2e-qa/` that abstains when `recalled.length===0 || max(score) < τ` before the LLM call — a pure function over `MemoryItemWithScore[]`, unit-testable with no key. Plus a strengthened answerer abstention rule.

## Bottlenecks / risks

- **Precision regression (#141):** a global recency weight would perturb all ranking — option (b) acts only on near-duplicate clusters, so non-update queries are untouched. Default τ conservative (≥ 0.9, true paraphrases only), opt-in first.
- **τ tuning:** new knob; validate on a fixture set before any default-on.
- **Cache poisoning:** recencyCollapse MUST bypass the recall cache (`scoped-retrieval.ts:150-160`) or a cached plain result poisons a collapse request.
- **Read-time only:** does not fix the write side (reflect still won't auto-run) — honest disclosure required.
- **Over-abstention (#140):** a τ that abstains too eagerly tanks the non-abstention buckets; N=12 is too small to tune τ with confidence — treat τ as provisional.

## Milestone scoping

- **M22 = #141 core fix (recall-time most-recent-wins collapse) + #140 harness abstention fix + explicit decline of #140's speculative core field.** One milestone, one cycle. Honest labeling: #141 is core; #140 is harness + a documented decline (the coverage signal already exists).

## Reference appendix (architectural contrast)

- **mem0** mutates in place (`references/mem0/mem0/memory/main.py:1972-2016`) → one current value → #141 impossible, at the cost of history + an LLM call per write.
- **graphiti** invalidates prior edges on write (`references/graphiti/graphiti_core/edges.py:271-277`, `edge_operations.py:512-535`).
- **TheMemory** owns every ingredient (bi-temporal, supersession filter, reflect-time LWW, `createdAt` surfaced) — the gap is these are write/reflect-time; nothing reconciles un-reflected ADD-only duplicates at read time. Option (b) fills exactly that gap.
