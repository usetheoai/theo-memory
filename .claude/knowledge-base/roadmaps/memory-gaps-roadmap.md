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
NOT gaps vs Letta; pick them up only after M1/M2 if they earn priority:

- Item 23 — cross-encoder reranker (extends the long-term lead)
- Item 24 — embedder registry + more providers
- Item 13 — adaptive retrieval (Self-RAG/CRAG hooks)
- Item 14 — optional graph backend (Apache AGE / Neo4j)
- Item 15 — domain ontologies
- Item 25 — ingest robustness (poison-record skip, deterministic chunker fallback)

## Sequencing

1. **M1 (G2)** first — highest value, genuinely ours, but HIGH risk → do it carefully with security review.
2. **M2 (G3)** second — low risk, leverages shipped substrate, closes a real Letta-parity gap + the EC-9 caveat.
3. Opportunistic items only after M1/M2 ship + a `/dogfood` re-check.

> Governance: each milestone is one full cycle ending in a `develop→main` release PR (human-gated). `production-ready` is NOT claimed until Item 11's dogfood + benchmark gates close — independent of this roadmap.
