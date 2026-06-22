# Discovery Plan: Adaptive Retrieval (Self-RAG / CRAG / Adaptive-RAG hooks)

> **Version 1.0** — Roadmap Item 13 (`memory-gaps-roadmap.md`, 4th opportunistic). Investigates how to add **adaptive-retrieval decision hooks** to TheMemory's `recall()` — a pre-retrieval gate (`shouldRetrieve`, the Self-RAG "Retrieve?" reflection) and a post-retrieval grade-and-correct step (CRAG corrective action) — as an OPT-IN DIP, default OFF (byte-unchanged), mirroring the shipped reranker/ontology opt-in-DIP pattern. The reference clones (mem0, letta) do NOT implement Self-RAG/CRAG (research patterns); the prior art is the research literature + TheMemory's OWN recall-pipeline seams. The produced blueprint must decide the DIP shape, the pipeline seam, the default heuristic impl, the fail-soft + observability contract, and the GOAL test shape.

**Slug:** `adaptive-retrieval`
**Owner:** project-owner (via /goal)
**Created:** 2026-06-22
**Time budget:** 2h (per-project breakdown in ADR D1)

## Context

`CLAUDE.md § Roadmap` Item 13 (v1.2): "Adaptive retrieval — `shouldRetrieve` + `wasRetrievalGood` decision hooks (Self-RAG / CRAG / Adaptive-RAG patterns)." Unfrozen 2026-06-21 (PRIORITY 0 freeze lift). The recall pipeline today runs unconditionally: every `recall()` embeds the query + hits pgvector + composes scores (`packages/core/src/domain/retrieval/pipeline.ts`, 293 LoC) regardless of whether the query needs memory at all, and returns whatever passes the `threshold` gate even when the top result is weak. Two SOTA patterns close this gap: Self-RAG (Asai et al. 2023, `arXiv:2310.11511`) adds a "Retrieve?" decision token BEFORE retrieval; CRAG (Yan et al. 2024, `arXiv:2401.15884`) grades retrieved evidence AFTER retrieval and triggers a corrective action when confidence is low. TheMemory already ships the opt-in-DIP precedent at the SAME `recall()` seam: the cross-encoder reranker (Item 23, `packages/core/src/domain/dip/reranker.ts`) and MMR diversify both hook Step 8.5 of the pipeline as opt-in, default-preserving, fail-soft, observable stages. This discovery decides how an adaptive-retrieval policy reuses that exact pattern. Aligns with `CLAUDE.md § Princípio 2` (priorização > volume) and `CLAUDE.md § Princípio 3` (auditability — every skip/correct decision is observable).

## Objective

Decide the contract + seam for an opt-in adaptive-retrieval policy so `cycle-plan` can implement it without re-scoping. Measurable success criteria for the blueprint:

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/` OR TheMemory's own source (resolvable paths)
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0/memory/main.py`, `docs/cookbooks/essentials/controlling-memory-ingestion.mdx` | Closest analog for any retrieval/ingestion control signal; honest baseline of what a production memory layer does (or does not) do for adaptive gating |
| `.claude/knowledge-base/references/letta/` | `letta/services/`, `letta/llm_api/` | Function-calling memory — study whether an agent-loop retrieval router exists |
| TheMemory OWN source (primary evidence) | `packages/core/src/domain/retrieval/pipeline.ts`, `packages/core/src/domain/options.ts`, `packages/core/src/domain/dip/{reranker,conflict-resolution-policy}.ts`, `packages/core/src/infrastructure/db/scoped-memory.ts`, `packages/core/src/domain/memory-event.ts`, `tests/integration/reranker.test.ts` | The opt-in-DIP + Step-8.5 seam + observable-event + fail-soft + GOAL-test patterns are ALREADY shipped; the feature reuses them. This is the load-bearing prior art. |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| LLM-driven agentic re-query / web-search fallback (full CRAG "web search" corrective) | <!-- DEFER-CORNER: techniques | the full CRAG corrective action includes an external web-search fallback; TheMemory is a memory layer, NOT an agent runtime (locked override). The in-scope corrective is bounded to memory-internal actions (threshold relaxation / re-query of the same store / honest low-confidence signal). External fallback is an agent-runtime concern (TheoKit). --> |
| Adaptive-RAG query-complexity classifier as a shipped model | The complexity router (Jeong et al. 2024) is studied for the DIP shape only; the v1 default is a key-free heuristic, not a trained classifier (mirrors the LocalTransformerEmbedder key-free-default precedent) |
| `.claude/knowledge-base/references/*/docs/` marketing, `build/`, `dist/`, `.venv/` | Not source of truth / build artifacts |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a feature without reading its source. langmem clone is absent — its procedural-memory pattern is cited from literature only, NOT as a reference-path citation. |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** TheMemory own source: 1.0h (primary evidence — the seam + DIP + test patterns are here); mem0: 0.5h; letta: 0.5h.

**Rationale:** the reference clones are known-thin on Self-RAG/CRAG (they are research patterns, not productized in mem0/letta); the load-bearing prior art is TheMemory's OWN shipped opt-in-DIP pattern (reranker/ontology), so the deepest dive is our own codebase. mem0/letta get a bounded box to confirm-or-deny an adaptive signal honestly.

**Alternatives considered:** equal 3-way split (rejected — wastes budget on thin clones), our-source-only (rejected — must honestly check the clones before claiming "no prior art").

**Stop condition — per question (mandatory):** when a question's Fase A returns empty matches after 3 query-variant retries, mark it BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** when a project's time budget is exhausted with questions pending, mark them BLOCKED with reason "budget exhausted" and advance. If every remaining question across all projects is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (NOT `BLUEPRINT_COMPLETE`).

**Anti-pattern:** NEVER fabricate a Fase B answer to close a question whose Fase A was exhausted. Honest BLOCKED with reason (Unbreakable Rule 3). For the mem0/letta "does an adaptive signal exist?" questions, an honest "NOT FOUND — confirmed absent in scope X" IS the answer (not a BLOCK), because the absence is itself the finding.

**Consequences:** the blueprint will lean on TheMemory's own seams + the research literature; mem0/letta contribute a confirmed-absence baseline that justifies the design's originality.

### D2 — Investigation depth

**Decision:** Read end-to-end for TheMemory's `pipeline.ts` + `reranker.ts` DIP + `reranker.test.ts` GOAL (these are the templates the feature copies); Grep-then-Read for mem0/letta (confirm-or-deny scope).

**Rationale:** the feature is a structural mirror of the shipped reranker — its pipeline seam, DIP method-count (ADR-0008), fail-soft path, and GOAL-test shape must be read in full to copy faithfully. The clones need only a targeted confirm-or-deny.

**Alternatives considered:** Grep-only (rejected — the seam ordering + fail-soft contract require full reads), Read-all-clones (rejected — budget).

**Consequences:** the blueprint's DIP + seam recommendations are line-exact against our own source; the clone findings are honest presence/absence.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Where in the recall pipeline is the seam for a PRE-retrieval gate (skip retrieval) and a POST-retrieval grade-and-correct, and how does the shipped reranker/diversify hook the same Step 8.5? | techniques | TheMemory own | grep `Step 8\|rerank\|diversify\|threshold` in `pipeline.ts` + `scoped-memory.ts` | Read `pipeline.ts` end-to-end + the recall() call path in `scoped-memory.ts` | Ordered step list + the exact seam (before-embed for shouldRetrieve; after-threshold/before-topK for grade-correct) |
| Q2 | What is the opt-in-DIP shape (method count under ADR-0008, opt-in wiring via `createLocalMemory` + `RecallOptions`, default-OFF) that the policy must follow? | techniques | TheMemory own | grep `interface Reranker\|interface ConflictResolutionPolicy\|rerank?:\|RerankerConflict` | Read `dip/reranker.ts` + `dip/conflict-resolution-policy.ts` + the `rerank` block in `options.ts` | DIP interface proposal (≤ method cap) + opt-in `RecallOptions.adaptive` / config shape + default-OFF rule |
| Q3 | Do mem0 / letta implement ANY adaptive retrieval/ingestion gate (a `should_retrieve`, a retrieval router, an ingestion-control flag)? Honest presence/absence. | techniques | mem0, letta | grep `should_retrieve\|retrieval.?router\|adaptive\|infer=\|grade\|relevance` in mem0 `main.py` + letta `services/` | Read mem0 `controlling-memory-ingestion.mdx` + any letta retrieval router hit | Confirmed presence (with citation) OR confirmed-absent baseline (what they do instead) |
| Q4 | How is a shipped opt-in-DIP GOAL test structured (real `ankane/pgvector:v0.5.1`, opt-in vs default-byte-unchanged, the assertion that the stage actually fired)? | tests | TheMemory own | grep `describe.skipIf\|createLocalMemory\|rerank:\|expect(` in `reranker.test.ts` | Read `reranker.test.ts` end-to-end | GOAL-test skeleton for adaptive: shouldRetrieve=false ⇒ skip (empty + event); grade-correct fires on weak top-score; default unchanged |
| Q5 | What is the fail-soft + observability-event contract for an opt-in recall stage (event union, fail-soft-never-fails-recall), so adaptive skip/correct decisions are auditable (Princípio 3)? | tests | TheMemory own | grep `recall_rerank_failed\|emitEvent\|MEMORY_EVENTS\|fail-soft` in `memory-event.ts` + `pipeline.ts` | Read `memory-event.ts` event union + the reranker fail-soft catch in `pipeline.ts` | New event literals (`retrieval_skipped`, `retrieval_corrected`, `retrieval_low_confidence`) + the fail-soft wrapper pattern |

## Coverage Matrix

| Question | Corner | Method (Fase A) | Method (Fase B) | Status |
|---|---|---|---|---|
| Q1 | techniques | grep pipeline steps | Read pipeline.ts + scoped-memory.ts | planned |
| Q2 | techniques | grep DIP interfaces | Read reranker + conflict-resolution DIP + options.ts | planned |
| Q3 | techniques | grep adaptive signals in clones | Read mem0 ingestion-control + letta | planned |
| Q4 | tests | grep GOAL-test shape | Read reranker.test.ts | planned |
| Q5 | tests | grep event union + fail-soft | Read memory-event.ts + pipeline.ts | planned |
| (deps) | deps | — | — | DEFER-CORNER (zero new dep) |
| (tools) | tools | — | — | DEFER-CORNER (no new tooling) |

**Coverage: 4/4 corners covered (100%)** — techniques + tests populated; deps + tools explicitly DEFER-CORNER'd below.

<!-- DEFER-CORNER: deps | the v1 default adaptive policy is a KEY-FREE HEURISTIC (top-score threshold for grade-correct; a marker/length signal or always-true for shouldRetrieve) — ZERO new dependency, mirroring the LocalTransformerEmbedder key-free-default + the reranker/ontology zero-dep precedent. An optional LLM-judged policy reuses the EXISTING LLM client (no new dep). A formal deps-audit runs in cycle-plan regardless. -->

<!-- DEFER-CORNER: tools | the feature is a DIP + a pipeline-seam wiring + an opt-in RecallOptions field; it adds NO new build/test/lint tooling (reuses vitest + the existing pgvector integration harness + the existing `@usetheo/memory/*` subpath build). No tooling question to investigate. -->

Question budget: 5 total. Per-corner: techniques ×3 (Q1, Q2, Q3), tests ×2 (Q4, Q5). deps + tools DEFER-CORNER'd. All within 5 ≤ N ≤ 10 and ≤ 3/corner; every non-deferred corner ≥ 1.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every cited path (`.claude/knowledge-base/references/{...}` OR `packages/core/...`) exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted" (for Q3 clone-absence questions, a confirmed-absent finding is the ANSWER, not a BLOCK) |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation | Re-iterate Qx (1 retry) |
| Mid-loop sanity | Citations ≥ N / 200 words of prose | Add citations to under-cited paragraphs (1 retry) |
| Before promising complete | All 4 corners have populated sections (deps/tools satisfied by the DEFER-CORNER rationale) | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason (Q3 absence is an answer)
- [ ] All four coverage corners have populated sections in the blueprint (deps/tools via DEFER-CORNER rationale)
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` OR `packages/core/...` path
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (DIP shape; seam; default heuristic; fail-soft + events; GOAL test)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/adaptive-retrieval-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered (or DEFER-CORNER'd)
- [ ] ADRs reference at least one principle from project rules (KISS/YAGNI/DIP) or a rule file (architecture.md, testing.md) — and CLAUDE.md Princípio 2 + Princípio 3
