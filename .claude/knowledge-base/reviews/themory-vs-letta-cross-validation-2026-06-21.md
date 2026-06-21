# Cross-validation report — TheMemory × Letta (memory engine)

**Date:** 2026-06-21
**Target:** `@usetheo/memory` (TheMemory) — TS/pnpm + Postgres/pgvector + Hono (24,866 LOC)
**Reference:** Letta / MemGPT — Python FastAPI + SQLAlchemy + pgvector (249,171 LOC)
**Scope:** memory engine (scope tiers + write/recall + reflection/distillation + skill library) vs Letta memory tiers (core/archival/recall + sleep-time + context-window).
**Lens:** the "5 AI memory systems" taxonomy (short-term, long-term, episodic, semantic, procedural).

---

## 1. Executive summary

**Overall: 3.58 / 5 (weighted).** TheMemory is a strong **memory persistence + retrieval LAYER**; Letta is an **agent RUNTIME** whose memory tiers are wired into the loop. They sit at different layers — which explains the score shape precisely:

- **TheMemory WINS** on the persistence/retrieval axis (long-term 5.0, semantic-graph 4.5, observability 4.5).
- **TheMemory TRAILS** on the agent-runtime axis (short-term/working 2.0, procedural execution 2.0, episodic tier 3.0) — because those are runtime concerns TheMemory delegates to the consumer (TheoKit). Letta owns the loop, so it owns those tiers.

**Top 3 gaps (all FROZEN under PRIORITY 0):**
1. **No in-context working-memory tier** (HIGH) — Letta `core_memory_append/replace` (`letta/services/tool_executor/core_tool_executor.py:319`). TheMemory has only Session-scoped storage.
2. **Procedural EXECUTION absent** (HIGH) — Letta agent loop + sleep-time agents (`letta/groups/sleeptime_multi_agent_v2.py:66`). TheMemory STORES skills (`scoped-skill-memory.ts`) but never executes them. This is the one gap that is genuinely TheMemory's roadmap (Item 21), not runtime.
3. **No first-class episodic/message-log tier** (MEDIUM) — Letta recall memory (`letta/services/message_manager.py:122`). TheMemory has the substrate (history + bi-temporal + distillation) but no first-class episode surface.

---

## 2. Score card

```
Long-term (vector)        ##########  5.0  ▲ target stronger
Observability             #########.  4.5  ▲ target stronger
Semantic (entity graph)   #########.  4.5  ▲ target stronger
Architecture (DIP)        ########..  4.0  = parity
Error handling            ########..  4.0  = parity
API/contract design       ########..  4.0  = parity
Testing                   #######...  3.5  = parity-
Episodic (events/history) ######....  3.0  ▽ substrate only
Short-term / working      ####......  2.0  ▽ gap (runtime)
Procedural (execution)    ####......  2.0  ▽ gap (Item 21)
                          ----------
Weighted average          3.58 / 5
```

---

## 3. Gap analysis (prioritized, with reference citations)

| # | Gap | Sev | Reference (file:line) | Target location | Ownership |
|---|---|---|---|---|---|
| G1 | In-context working-memory tier (self-editable blocks) | HIGH | `letta/services/tool_executor/core_tool_executor.py:319` (`core_memory_append`) | `packages/core/src/domain/scope.ts` | Runtime (TheoKit) — FROZEN |
| G2 | Procedural EXECUTION (skills store-only) | HIGH | `letta/groups/sleeptime_multi_agent_v2.py:66` (`step`) | `packages/core/src/infrastructure/db/scoped-skill-memory.ts` | **TheMemory (Item 21 + sandbox)** — FROZEN |
| G3 | First-class episodic / message-log tier | MEDIUM | `letta/services/message_manager.py:122` (`MessageManager`) | `packages/core/src/infrastructure/db/reflect-orchestrator.ts` | TheMemory (part hardening v1.1) — FROZEN |
| G4 | Context-window / token-budget accounting | MEDIUM | `letta/services/context_window_calculator/context_window_calculator.py:249` | `packages/core/src/infrastructure/db/retrieval-pipeline.ts` | Runtime-adjacent — FROZEN |

---

## 4. Detailed comparisons (per dimension)

- **Long-term (5.0):** target hybrid 9-step (semantic+BM25+entity) + triadic forgetting + bi-temporal `asOf` + semantic cache (`retrieval-pipeline.ts`) vs Letta plain archival vector (`archive_manager.py:25`). Target clearly ahead.
- **Observability (4.5):** target 24 typed `MEMORY_EVENTS` OTel union + audit tables + Princípio-3 (`memory-event.ts`) vs Letta logging + token accounting (`context_window_calculator.py:249`).
- **Semantic (4.5):** target Postgres entity+relation graph (`pg-memory-graph-store.ts`) vs Letta Block/Memory model with no dedicated entity-relation graph (`schemas/memory.py:68`).
- **Architecture / Error / API (4.0):** parity — DIP ports vs service-managers; typed errors both sides; locked-verb contract + OpenAPI vs FastAPI.
- **Testing (3.5):** both test vs real backends; target pyramid is integration-heavy (CLAUDE.md flags 95:10 inversion).
- **Episodic (3.0):** substrate present (history + bi-temporal + distillation) but no first-class episode/message-log tier like Letta recall memory (`message_manager.py:122`).
- **Short-term (2.0):** Letta core memory = editable in-context blocks self-edited via tools (`core_tool_executor.py:319`) + token-budget calc. Target: only Session storage.
- **Procedural (2.0):** Letta executes (agent loop + sleep-time `sleeptime_multi_agent_v2.py:66`). Target stores skills only (`scoped-skill-memory.ts`), no executor.

---

## 5. Improvement roadmap (prioritized; ALL gated by P0 freeze)

| Pri | Item | Effort | Roadmap | Notes |
|---|---|---|---|---|
| 1 | **Procedural execution + injection/command sandbox** | L | Item 21 | The only gap genuinely TheMemory's. Ship WITH sandbox (reject shell metachars, whitelist, path-confinement, timeout, `ToolInvocationDeniedError` + OTel). HIGH once unfrozen. |
| 2 | First-class episodes (session-as-episode + searchable event log) | M | new (part v1.1 hardening) | Leverage EXISTING `t_valid`/`t_invalid`. Partly closes G3. |
| 3 | Cross-encoder reranker | M | Item 23 | Extends the long-term lead. |
| 4 | Working-memory block surface (get/append/replace + token-budget render) | M | new (likely TheoKit) | Closes G1+G4 — but probably a RUNTIME feature, not core memory. |
| 5 | Domain ontologies | M | Item 15 | Extends semantic lead. |

**Honest constraint:** under PRIORITY 0, Items 13/14/15/21 + any net-new feature are FROZEN. None of the above may start without explicit project-owner unfreeze (Inquebrável Rule 10). What CAN proceed now is observability hardening + closing existing caveats (e.g. skill-scope `asOf`) — not new tiers.

---

## 6. Areas where TARGET excels over reference

- **Principled forgetting** — triadic eviction (Ebbinghaus + LRU + LLM-importance) with long-tail preservation (`eviction/`). Letta has NO forgetting; archival grows unbounded.
- **Bi-temporal `asOf`** — point-in-time queries (`t_valid`/`t_invalid`). Letta has none.
- **Entity+relation graph in Postgres** (no graph DB) — `pg-memory-graph-store.ts`. Letta has no dedicated entity-relation graph.
- **Typed observability/audit** — 24 typed OTel events + audit tables. Letta logs but has no typed audit-event union.
- **Layer purity** — TheMemory is consumable by ANY agent (DIP); Letta's memory is coupled to its own loop.

---

## 7. What was NOT analyzed (honesty)

- **Single reference (Letta).** Zep/Graphiti (bi-temporal episodic graph) and Cognee (ontologies + poly-store) were requested but are **NOT cloned locally** — only `letta` and `mem0` are under `.claude/knowledge-base/references/`. Episodic-vs-Zep and semantic-ontology-vs-Cognee comparisons need a separate license-gated clone + run.
- **Letta's broader agent framework** (LLM providers, tool registry, multi-agent groups, streaming) was out of the memory-engine scope and not scored.
- **File inventory** was scoped to the memory-relevant subset (15 anchor files persisted; the full 826-file scoped inventory was attempted but the background batch hit a PATH issue — anchors cover the analyzed surface).
- **Scores are layer-relative:** a 2.0 on short-term/procedural is NOT "broken" — it reflects that TheMemory deliberately sits below the agent runtime where those tiers live. Read scores with the layer caveat.
- Single-analyst (no independent second LLM jury on the scores).
