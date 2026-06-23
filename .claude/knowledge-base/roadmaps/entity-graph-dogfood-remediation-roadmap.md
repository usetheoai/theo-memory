# Entity-graph + dogfood remediation roadmap

**Date:** 2026-06-23
**Source:** live-test theo-cloud ↔ TheMemory v0.20.0 (API e2e 20/20 + GOAL 4/4, real OpenAI) **+** Chrome-MCP end-user dogfood of the local dev stack (Kratos + gateway + themory v0.20.0 + dashboard, real LLM/embedder).
**Theme:** evolve the existing Postgres entity-graph + close the gaps that a real end-user run surfaced. NO graph-DB backend (Item 14 stays declined per 2026-06-22).

## Honest triage of the dogfood findings

| # | Finding | Verdict | Repo(s) |
|---|---|---|---|
| ~~SN~~ | Soft-nav of the Memory sub-app does not swap the view | **RETRACTED** — user-confirmed false; was an automation artifact (clicks during initial SPA hydration). NOT a product defect. | — |
| EG-1 | `graphExpand` (v0.20.0) has NO consumer UI — end users cannot activate graph-aware recall | **REAL gap** (corrects my earlier wrong claim that it "needs no UI") | theo-cloud (gateway BFF + dashboard); TheMemory REST already done |
| EG-2 | Entity-extraction noise: fragments like `I'm`, `m reading`, `love science`, `user`, `fiction novels` are stored as entities | **REAL** (NER over-extraction) | TheMemory (core) |
| EG-3 | Metric inconsistency: Memory Overview shows "1 Distinct entities" while Entities/Graph show 10+ | **REAL** (needs root-cause: metrics source vs entities aggregation) | TheMemory metrics OR theo-cloud BFF — investigate first |
| EG-4 | LLM extraction language non-deterministic: same kind of input stored sometimes in PT (`user mora em Lisboa`) sometimes EN (`Paulo works as a software engineer`) | **REAL** (extraction prompt does not pin output language) | TheMemory (core) |
| env | `/engine/api/v1/* → 502` in the dev dashboard | **NOT a bug** — the PaaS engine is not part of the memory dev stack (expected). Excluded. | — |

Validated-working surfaces (no action): login/Kratos, Memories list, Episodes timeline (+asOf), Entities list, Graph force-directed view, Playground remember (real LLM, 2 facts) + recall (real embedder, correct semantic ranking 0.666/0.605 vs <0.2 noise).

---

## Items (proposed sequence — highest value first)

### EG-2 — Entity-extraction quality (noise filter)  ·  severity: HIGH  ·  repo: TheMemory
**Problem:** the entity extractor (compromise NER + regex fallback over LLM-extracted facts) emits fragment/stopword tokens (`I'm`, `m reading`, `love science`, `user`, `fiction novels`) as first-class entities, polluting the Entities tab + the Graph + the `distinct entities` aggregation. ~half the nodes in the dogfood were noise.
**Proposed fix (no new dep):** post-extraction filter in the entity pipeline — drop tokens that are (a) ≤ 2 chars or pure contractions (`I'm`, `m`), (b) on a stopword/pronoun list, (c) not a NOUN/PROPN per the existing POS tags compromise already provides, (d) canonicalize/dedup case + possessive. Keep it a pure, deterministic, unit-tested filter (the cheapest place is right after extraction, before persist).
**Why it leads:** it directly degrades the entity-graph (the feature we are evolving) and every downstream surface (Entities/Graph/metrics). Fixing it lifts EG-3's signal quality too.
**Cycle:** `/discover` (compromise POS API + Mem0-TS entity-filter prior art) → plan → implement → review.

### EG-3 — "Distinct entities" metric inconsistency  ·  severity: MEDIUM  ·  repo: investigate (TheMemory metrics ↔ theo-cloud BFF)
**Problem:** Overview "Distinct entities = 1" contradicts Entities/Graph = 10+ for the same scope.
**First step (root-cause, before any fix):** determine which layer computes "distinct entities" for the metrics card — TheMemory `GET /v1/metrics`/`/entities` vs the gateway BFF `/v1/dashboard/memory/metrics` aggregation. The gateway historically DERIVED some counters (honest gap noted in CLAUDE.md "Gateway-facing read endpoints"). Likely the metric counts a different thing (e.g., entities-with-edges, or attributed_to-derived) than the entities listing.
**Proposed fix:** make the metric read the SAME aggregation the Entities tab uses (single source of truth) OR relabel it to what it actually measures. Decide after root-cause.
**Cycle:** small `/to-plan` once the source is confirmed (likely a 1-file fix on either side).
**Note:** EG-2 must land first — noise inflates the "correct" count, so validate EG-3 against a clean entity set.

### EG-4 — Extraction language determinism  ·  severity: MEDIUM  ·  repo: TheMemory
**Problem:** the write-pipeline LLM extraction emits facts (and relation-edge labels) in PT or EN non-deterministically. Mixed-language storage hurts dedup, semantic recall consistency, and the Graph edge labels.
**Proposed fix (decide via ADR):** pin the extraction output language in the prompt — either (a) ALWAYS English (canonical store language), or (b) ECHO the source text's language. Recommendation: (b) preserve source language (least surprising for the user), made deterministic via an explicit instruction + a regression test with a PT input and an EN input asserting same-language output.
**Cycle:** `/to-plan` (prompt change is TDD-first: assert the prompt-output language contract) → implement → review.

### EG-1 — graphExpand consumer UI (end-to-end)  ·  severity: MEDIUM-HIGH  ·  repo: theo-cloud (+ verify TheMemory REST)
**Problem:** v0.20.0 exposes `graphExpand` over REST, but no consumer surface lets an end user turn it on. The feature is invisible to dashboard users.
**Layers:**
1. **TheMemory REST** — DONE (v0.20.0: `POST /v1/recall` accepts `graphExpand`).
2. **Gateway BFF** — pass `graphExpand` through `POST /v1/memory/recall` (SDK) + `POST /v1/dashboard/memory/recall` (BFF) to the themory recall call. (Verify whether the BFF currently forwards it; likely not.)
3. **Dashboard** — add a "Graph expand" control to the Playground recall (hops 1|2 + optional limit); surface graph-sourced hits distinctly in results. Optionally: a "recall connected" action from a node in the Graph tab.
**Cycle:** `/discover` (BFF recall passthrough shape + dashboard recall component) → plan → implement → review. Cross-repo: TheMemory unchanged; work lands in theo-cloud.
**Why last:** EG-2/EG-4 improve the graph data quality that EG-1's UI would surface — better to expose a clean graph.

---

## Cross-repo ownership summary

- **TheMemory (this repo):** EG-2 (entity noise), EG-4 (language determinism), EG-3 (if the metric source is TheMemory-side).
- **theo-cloud:** EG-1 (gateway BFF passthrough + dashboard UI), EG-3 (if the metric is BFF-derived).

## Discipline

- Each item runs the FULL project cycle (discover → plan → edge-case → deps-audit → plan-confidence → implement → code-quality → review → release), FAANG-level, real LLM (NEVER mock) for GOAL tests, no workarounds, only stop at READY_TO_MERGE.
- EG-2 → EG-3 → EG-4 → EG-1 is the recommended order (data quality before the metric that counts it, before the UI that shows it).
- Item 14 (graph-DB backend) stays DECLINED. All items evolve the existing Postgres entity-graph.
