---
slug: memory-gaps-roadmap
created_at: 2026-06-21
owner: project-owner
source: .claude/knowledge-base/reviews/themory-vs-letta-cross-validation-2026-06-21.md (TheMemory × Letta, 3.58/5)
status: active (P0 freeze lifted 2026-06-21 — CLAUDE.md § PRIORITY 0 Amendment 2026-06-21)
---

# Roadmap — close the memory-type gaps (TheMemory × Letta)

The `/loop-cross-validation` vs Letta scored TheMemory 3.58/5. Strengths (long-term 5.0,
semantic-graph 4.5, observability 4.5) are kept + marketed. This roadmap closes the
two gaps that are genuinely TheMemory's (G2, G3). G1 + G4 are agent-runtime concerns,
deferred to TheoKit (out of this roadmap's critical path per project-owner 2026-06-21).

Each milestone runs the full cycle: `/discover-plan → /discover-confidence → /to-plan →
/edge-case-plan → /deps-audit → /plan-confidence → /implement → /code-quality → /review →
/release`. Production-ready (Item 11) stays separately gated (dogfood + benchmark) — none
of these milestones flips the v1.0 gate.

---

## M1 — Procedural execution + injection/command sandbox (G2 · Roadmap Item 21)

**Why:** highest-value, genuinely-ours gap. Today `ScopedSkillMemory` STORES code-as-skill
(`packages/core/src/infrastructure/db/scoped-skill-memory.ts`) but never executes it.
Letta executes procedures via its agent loop + sleep-time agents
(`letta/groups/sleeptime_multi_agent_v2.py:66`, `letta/services/tool_executor/core_tool_executor.py:307`).

**Goal (SMART):** "Execute a stored skill inside a hardened sandbox, measured by an
integration test that (a) runs a benign stored skill → captured output, and (b) a malicious
skill (shell metachars / path escape / timeout / output-flood) → `ToolInvocationDeniedError`
+ OTel `tool_invocation_denied` event, with ZERO host-shell escape."

**Security-by-design (NON-NEGOTIABLE — sandbox ships WITH execution, never after):**
- reject shell metacharacters + `shlex`-style split + command whitelist
- path-confinement to allowed roots; subprocess timeout + output-cap; per-task tool-call cap
- new typed `ToolInvocationDeniedError` + OTel auditability event per denied call (Princípio 3)
- reference: `memsearch/maintenance.py:452-514` (the sandbox precedent from the prior cross-validation)

**Suggested phasing (one cycle, sandbox-first within it):**
- Slice 1 — sandbox primitives DIP (`SkillExecutor` port + `SandboxedSkillExecutor` impl) + the 6 guards + typed error + OTel event. NO executor wired yet.
- Slice 2 — wire `ScopedSkillMemory.execute(skillId, args)` through the sandbox; REST `POST /v1/scopes/skill/:repoId/skills/:id/execute` + MCP `execute_skill` tool (opt-in, gated).

**Deps:** none (skill library already shipped). **Risk:** HIGH (RCE surface) — the sandbox is the whole point; deps-audit + security review mandatory. Heavy optional dep (e2b/modal/firejail) — evaluate in `/discover`.

**Status:** ✅ **RELEASED v0.13.0 (2026-06-22, PR #59 merge `f2e030d`, tag v0.13.0).** Full cycle complete: discover (blueprint `60cfa69`, SHIPPABLE_WITH_CAVEATS 89) → plan (SHIPPABLE 93.6) → implement (9 tasks, 20 commits) → code-quality (PASS 100) → review (7 agents incl mandatory RCE security review — NO host escape; 2 HIGH + 3 MEDIUM closed inline `18cd4d3`) → release. **D3 LOCKED:** `isolated-vm` in-process default `SandboxedSkillExecutor` (async off-thread, 6 guards + bounded opts) + `SkillExecutor` DIP seam for opt-in out-of-process (e2b/modal). Shipped: `ScopedSkillMemory.execute()` (opt-in/gated, STORE-only default) + REST `POST .../skills/:id/execute` + MCP `execute_skill`. GOAL test 8/8 vs real pgvector + real isolated-vm. Followups: in-memory workspace_id parity, pre-copy output check, direct by-id skill read, consolidate_findings aggregator fix.

---

## M2 — First-class episodic / message-log tier (G3)

**Why:** Letta exposes the conversation/event history as a first-class paginated + searchable
tier (recall memory, `letta/services/message_manager.py:122`). TheMemory has the substrate
(history table + bi-temporal `t_valid`/`t_invalid` + episodic→semantic distillation
`reflect-orchestrator.ts`) but no first-class episode/event-log surface for the consumer.

**Goal (SMART):** "Expose episodes for a scope, measured by an integration test where N
remembers across a session group into a queryable episode and `recall({episode|asOf})`
returns the episode's events in temporal order against real pgvector."

**Scope:** session-as-episode grouping + a searchable event-log read surface, built on the
EXISTING bi-temporal columns + history (mostly hardening of v1.1, partly a new read surface).
NO new storage engine. Likely: `GET /v1/scopes/:type/:id/episodes` + episode-scoped recall.

**Deps:** leverages shipped bi-temporal (v1.1) + history. **Risk:** LOW-MEDIUM (read surface over existing data). **Also closes:** the deferred EC-9 skill-scope `asOf` caveat can ride here.

**Status:** ✅ RELEASED v0.14.0 (2026-06-22, PR #60 merge `41521f5`; tag + GitHub release published). Full cycle: discover (blueprint 89) → plan (96.8) → deps-audit (PASS) → implement (4 phases TDD) → code-quality (PASS 100) → review (6 agents READY_TO_MERGE; uncovered+fixed a real ASC-cursor µs/ms precision bug) → release. Shipped `ScopedMemory.episodes()` + `VectorStore.listEpisodes` (pgvector+in-memory) + REST `GET /v1/scopes/:type/:id/episodes`. EC-9 (skill-scope asOf) DEFERRED per ADR D5. Records: `first-class-episodes-plan.md`, `first-class-episodes-review-2026-06-22.md`, `roadmap-runs/M2-2026-06-22.md`, `releases/v0.14.0-release.md`.

**MCP surface completion (G3-MCP):** ✅ RELEASED v0.22.0 (2026-06-24, PR #76 merge `cfd1406`). Follow-up that closed the remaining gap — the episodic tier was SDK+REST only; v0.22.0 added the native `episodes` MCP tool (reusing the shipped `ScopedMemory.episodes()`, no core change). The episodic tier is now first-class across ALL THREE consumer surfaces (SDK + REST + MCP). `/review` 4 agents READY_TO_MERGE. Records: `mcp-episodes-tool-plan.md`, `mcp-episodes-tool-review-2026-06-23.md`, `roadmap-runs/G3-MCP-2026-06-24.md`, `releases/v0.22.0-release.md`.

---

## Deferred (NOT in this roadmap — cross-repo / TheoKit)

| Gap | Why deferred | Where it belongs |
|---|---|---|
| **G1** in-context working-memory tier (self-editable blocks) | agent-RUNTIME concern; absorbing it into TheMemory core contradicts the locked "memory layer, NOT agent runtime" override | **TheoKit** followup (`core_tool_executor.py:319` is the Letta reference) |
| **G4** context-window / token-budget accounting | runtime-adjacent; the consumer packs the prompt | **TheoKit** (optional: a token-budget-aware `recall` trim on our side, LOW priority) |

These are recorded so the cross-validation findings are not lost. Implementing them is a TheoKit-repo decision, not TheMemory's.

---

## Now-available (unfrozen, NOT gap-driven — opportunistic, post-M1/M2)

The full unfreeze also reopens these (from the cross-validation backlog + Phase V). They are
NOT gaps vs Letta; pick them up only after M1/M2 if they earn priority. **Priority order
re-ordered by project-owner 2026-06-22:**

1. ~~Item 23 — cross-encoder reranker (`Reranker` DIP)~~ ✅ **SHIPPED v0.15.0 (2026-06-22, PR #61 merge `fc98cd9`, tag v0.15.0).** Full cycle: discover (blueprint SHIPPABLE 99.7) → plan (SHIPPABLE 98.0) → deps-audit PASS (zero new deps) → implement (7 tasks TDD) → code-quality PASS 100 → review (6 agents READY_TO_MERGE; 0 BLOCKER/HIGH, 4 MEDIUM closed inline) → release. Shipped: `Reranker` DIP + `CrossEncoderReranker` (@xenova `Xenova/ms-marco-MiniLM-L-6-v2`, no new dep) wired post-threshold (Step 8.5a, opt-in `recall({rerank})`), mutually exclusive with diversify (`RerankerConflict`), fail-soft (`recall_rerank_failed`), cache-bypass, `@usetheo/memory/reranker-local` subpath. GOAL test real pgvector + real @xenova. Records: `cross-encoder-reranker-plan.md`, `cross-encoder-reranker-review-2026-06-22.md`, `releases/v0.15.0-release.md`.
2. ~~Item 15 — domain ontologies~~ ✅ **SHIPPED v0.16.0 (2026-06-22, PR #62 merge `4af021f`, tag v0.16.0).** Full cycle: discover (blueprint SHIPPABLE_WITH_CAVEATS 89) → plan (SHIPPABLE 99.2) → deps-audit PASS (zero new deps; reuses zod) → implement (5 tasks TDD) → code-quality PASS 100 → review (6 agents READY_TO_MERGE; 0 BLOCKER; 2 HIGH closed inline via ADR D5 + fail-soft test) → release. Shipped: `Ontology` DIP + `BUILTIN_ONTOLOGIES` (medical/legal/code/support) + `resolveOntology`/`validateOntology`, prompt injection + post-parse coercion (out-of-vocab→OTHER, `ontology_type_coerced` event), opt-in `MemoryConfig.ontology`, NO poly-store / NO migration (reuses `entities.type`). Entity-type persist gated on active ontology (ADR D5 — default path byte-unchanged). GOAL test real pgvector. Records: `domain-ontologies-plan.md`, `domain-ontologies-review-2026-06-22.md`, `releases/v0.16.0-release.md`.
3. ~~Item 24 — embedder registry + more providers~~ ✅ **SHIPPED v0.17.0 (2026-06-22, PR #63 merge `ff42823`, tag v0.17.0).** Full cycle: discover (blueprint SHIPPABLE_WITH_CAVEATS 89) → plan (SHIPPABLE 98.0) → deps-audit PASS (zero new deps; Node-global `fetch`) → implement (T1.1+T2.1-2.3+T3.1+T4.1 TDD) → code-quality PASS 100 → review (6 agents READY_TO_MERGE; 0 BLOCKER; 1 HIGH + 3 MEDIUM + 2 LOW closed inline) → release. Shipped: `createEmbedder(spec)` string-keyed registry (lazy dynamic-import → bundle isolation; `@usetheo/memory/embedders/registry` excludes openai/@xenova from its static graph) + 3 fetch-based adapters (`OllamaEmbedder`/`VoyageEmbedder`/`GoogleEmbedder`, ZERO new dep, injectable fetch, fail-fast on missing key) + `EmbedderUnavailableError` (install hint) + `EmbedderError` unknown-key (valid-keys list). 4 new subpaths. GOAL test real pgvector (round-trip + unknown-key) under canonical integration config. Narrows 3→6 providers (memsearch cross-validation). Records: `embedder-registry-plan.md`, `embedder-registry-review-2026-06-22.md`, `releases/v0.17.0-release.md`.
4. ~~Item 13 — adaptive retrieval (Self-RAG/CRAG hooks)~~ ✅ **SHIPPED v0.18.0 (2026-06-22, PR #64 merge `d4a7eaa`, tag v0.18.0).** Full cycle: discover (blueprint SHIPPABLE 0-caps) → plan (SHIPPABLE 97.6) → edge-case-plan (EC-1..EC-4 absorbed) → deps-audit PASS (zero new deps) → implement (T1.1→T5.1 TDD) → code-quality PASS 100 → review (6 agents READY_TO_MERGE; 0 BLOCKER; 2 HIGH + 2 MEDIUM closed inline) → release. Shipped: opt-in `AdaptiveRetrievalPolicy` DIP (`shouldRetrieve` pre-embed gate + `assess` post-threshold grade-and-correct) wired into `recall()`, DEFAULT OFF (byte-unchanged); key-free `HeuristicAdaptiveRetrievalPolicy` behind `@usetheo/memory/adaptive-local` (bundle-isolated, ZERO new dep); bounded in-memory relax corrective (no re-embed, no external fallback per memory-layer-not-runtime override), EC-1 clamp, fail-soft, 4 observable events (`retrieval_skipped`/`corrected`/`low_confidence`/`policy_failed`); `RecallOptions.adaptive` per-call tuning; wired policy bypasses the recall cache. Review fixes: removed Self-RAG/CRAG paper-names from src/** (no-paper-names rule), de-conflated policy-crash from low-confidence. GOAL test real pgvector (skip + correct + default-unchanged). Records: `adaptive-retrieval-plan.md`, `adaptive-retrieval-review-2026-06-22.md`, `releases/v0.18.0-release.md`.
5. ~~Item 14 — optional graph backend (Apache AGE / Neo4j)~~ ❌ **NOT PLANNED (project-owner 2026-06-22).** A separate graph-DB backend will NOT be built. Rationale: the existing Postgres-relational entity graph (`entities` + `entity_edges` tables + the 1–2-hop dashboard graph view, shipped via entity-relation-extraction) already covers the graph use cases without a poly-store — consistent with the "ontologies/graph WITHOUT poly-store" thesis (CLAUDE.md competitive matrix). Any future graph work EVOLVES that existing relational feature, not a new AGE/Neo4j adapter. Item stays in history (not deleted) per roadmap discipline.
   - ➕ **Evolution SHIPPED in lieu of Item 14: graph-aware recall — v0.19.0 (2026-06-22, PR #65 merge `732d9c1`, tag v0.19.0).** Full cycle: discover (blueprint SHIPPABLE 0-caps) → plan (SHIPPABLE 95.6) → edge-case-plan (EC-1 dedup + EC-2 cross-scope isolation absorbed) → deps-audit PASS (zero new deps, NO migration) → implement (7 tasks TDD) → code-quality PASS 100 → review (6 agents READY_TO_MERGE; 0 BLOCKER; 4 HIGH doc/idiom closed inline) → release. Shipped: opt-in `GraphExpansionStore` DIP + pipeline Step 8.7 pool-expansion over the EXISTING entities/memory_entities/entity_edges tables (1-hop default / 2-hop opt-in, JOINs only, NO graph DB), `PgGraphExpansionStore` auto-wired by the factory, `RecallOptions.graphExpand` (default OFF/byte-unchanged), graph hits banded below genuine semantic hits, scope-isolated, fail-soft + 2 events. GOAL 2/2 vs real pgvector. This IS the "evolve the existing entity-graph" direction. Records: `graph-aware-recall-plan.md`, `graph-aware-recall-review-2026-06-22.md`, `releases/v0.19.0-release.md`.
6. **Item 25 — ingest robustness (poison-record skip, deterministic chunker fallback)** ← NEXT

## Sequencing

1. **M1 (G2)** first — highest value, genuinely ours, but HIGH risk → do it carefully with security review.
2. **M2 (G3)** second — low risk, leverages shipped substrate, closes a real Letta-parity gap + the EC-9 caveat.
3. Opportunistic items only after M1/M2 ship + a `/dogfood` re-check. Order (project-owner 2026-06-22): **Item 23 (reranker) → Item 15 (domain ontologies)** → Item 24 → Item 13 → ~~Item 14~~ (NOT planned — evolve the existing Postgres entity-graph instead) → Item 25.

> Governance: each milestone is one full cycle ending in a `develop→main` release PR (human-gated). `production-ready` is NOT claimed until Item 11's dogfood + benchmark gates close — independent of this roadmap.
