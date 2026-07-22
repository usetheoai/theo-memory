---
slug: intelligent-memory-routing
generated_by: roadmap-feature
date: 2026-07-21
status: completed
milestones_added: [M8, M9, M10, M11]
---

# Grill — Intelligent (agent/policy-driven) memory routing & lifecycle

## Trigger

Raised after the Claude Code ⇄ theo-memory integration (M6/M7) was proven to dump
**every** write into the `user` tier, leaving `session`/`agent`/`repo` empty (and their
Entities/Graph dashboard tabs empty). The user asked: *"ele deveria decidir onde gravar,
o que você acha? COMO SUA MEMORIA FUNCIONA?"* and pointed at
`github.com/akitaonrails/ai-memory` as prior art.

## Prior art consulted (this session)

- **Claude Code native memory** (the assistant's own): file-based, each fact carries a
  semantic `type` (user / feedback / project / reference) that the agent CHOOSES at write
  time. Recall by relevance. → routing IS agent-decided, by meaning.
- **akitaonrails/ai-memory** (MIT): explicit scopes `_global` (durable user/team context),
  `project` (per-repo), `session` (ephemeral, consolidated at session-end). The agent/LLM
  decides scope on `memory_write_page --scope` (default project, can be global); lifecycle
  hooks auto-route session observations; humans override via `.ai-memory.toml`. Recall unions
  project + global.
- **theo-memory today**: tiers (user/session/agent/repo) = tenancy/lifetime partitions;
  `category` (TECHNICAL/WORK/…) = semantic classification the LLM already assigns at write.
  So category-routing exists; **tier-routing does not** — the tier is whatever the caller's
  scope is, and the integration hardcodes `user`.

## Design forks resolved (AskUserQuestion, 2026-07-21)

| Fork | Options | Decision |
|---|---|---|
| Routing authority | hybrid / pure-agent / pure-rules | **Hybrid** — deterministic rules first, LLM durability/scope signal on ambiguity, explicit agent/caller override wins. Mirrors ai-memory + native memory. |
| Scope reach | user↔session / +project / all-4+global | **All 4 tiers + a new `global` tier** — maximum reach; `global` = durable cross-project context (ai-memory `_global` analog). |
| Milestone set | full M8–M11 / core M8+M10 / just M8 | **Full M8–M11** — user directive: "da forma mais FAANG possível, não importa o esforço". |

## Standard grill (Q1–Q4), answered under the delegation

**Q1 — What & why now:** intelligent placement + lifecycle of memory — the system decides
WHERE (which scope tier) and HOW LONG (promotion/decay) each fact lives, instead of dumping
everything in `user`. Why now: the M6/M7 integration made the gap concrete (empty
session/agent/repo tiers; noisy `user` full of raw per-turn dumps). This is the difference
between a durable memory and a dumb append log.

**Q2 — Dependencies:** M6 + M7 (the Claude Code write paths being routed) are the base;
M9/M10/M11 chain off M8. All of M0–M7 are `[x]`, so M8 is immediately eligible.

**Q3 — DoD:** captured per-milestone in ROADMAP.md (each milestone has a verifiable,
integration-tested DoD anchored on real `ankane/pgvector:v0.5.1`).

**Q4 — Top new risks:** the load-bearing new risk is the **locked-name change** — adding a
`global` fifth tier mutates the locked "Memory tiers: User·Session·Agent(+Repo)" contract and
requires **owner sign-off + CLAUDE.md amendment + strategic review** (same gate RepoScope /
ADR-0010 went through). Shipped behind a backward-compat default so nothing breaks pre-sign-off.
Second: LLM-in-the-write-path cost/latency/nondeterminism (mitigated by rules-first +
ambiguity-only LLM + fact-hash cache + deterministic override).

## SOTA delta

Added `akitaonrails/ai-memory` (MIT) to the ROADMAP `## State-of-the-art references` table as
a **conceptual peer** (not cloned — matches the existing not-cloned-peer convention), supporting
M8–M11. Clone via a future `/roadmap-feature` Step 5 delta if line-level study is needed.
