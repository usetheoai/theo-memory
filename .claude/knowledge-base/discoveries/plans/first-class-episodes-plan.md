# Discovery Plan: first-class-episodes (M2 / gap G3)

Version: 1.1 (edge-case MUST-FIX absorbed 2026-06-22: EC-1 fold Q6 mem0-comparison into Q3 to satisfy ≤3-per-corner; EC-2 Q2 grouping-key-source checkpoint; EC-3 message_manager-vs-passage_manager framing constraint. See `first-class-episodes-edge-cases-2026-06-22.md`.)
Slug: first-class-episodes
Owner: project-owner
Created: 2026-06-22
Cycle: cycle-discover phase 1 (→ /discover-edge-cases → /discover-plan-confidence → /discover-execute → /discover-confidence)

## Context

M2 of the memory-gaps roadmap (`.claude/knowledge-base/roadmaps/memory-gaps-roadmap.md`). The `/loop-cross-validation` vs Letta (3.58/5) flagged that Letta exposes the conversation/event history as a FIRST-CLASS, paginated + searchable tier (recall memory, `message_manager.py`), while TheMemory has the substrate — a `history` audit table, `memories.session_id`, bi-temporal `t_valid`/`t_invalid` (ADR-0006/0011), `saveMessages`/`getLastMessages` on the `HistoryManager` DIP — but NO first-class episode/event-log READ surface for the consumer. This discovery investigates HOW Letta shapes that tier so we can expose episodes over our EXISTING substrate (no new storage engine), and also closes the deferred EC-9 (skill-scope `asOf`) caveat opportunity. Per the roadmap: LOW-MEDIUM risk, mostly a read surface + hardening of v1.1.

## Objective

Produce a blueprint that answers: what is the minimal, correct shape of a first-class episodic read surface (`GET /v1/scopes/:type/:id/episodes` + episode-scoped recall) built on TheMemory's existing history + bi-temporal + session_id substrate, grounded in how Letta's `message_manager` paginates, scopes, and (optionally) semantically searches its message/recall tier — WITHOUT a new storage engine. Success: every research question answered with a `.claude/knowledge-base/references/letta/` citation + a mapping to our substrate; SHIPPABLE_WITH_CAVEATS ≥ on `/discover-confidence`.

## In-scope / Out-of-scope

### Letta (`.claude/knowledge-base/references/letta/`) — PRIMARY
- In scope: `letta/services/message_manager.py`, `letta/schemas/message.py`, `letta/schemas/passage.py`, `letta/services/passage_manager.py`, `tests/managers/test_message_manager.py`, `pyproject.toml`.
- Out of scope: the agent loop / send_message runtime (`letta/agents/**`), serialization (`serialize_schemas/**`), the LLM provider layer — episode READ surface only, not the agent runtime that produces messages.

### mem0 (`.claude/knowledge-base/references/mem0/`) — SECONDARY (comparison only)
- In scope: a single comparison check — does mem0 expose an episodic/message-log tier at all? (`mem0-ts/src/` grep).
- Out of scope: everything else (mem0 is vector-add-only; expected to have no episodic tier — negative evidence).

### TheMemory substrate (read-only reference for mapping, NOT a reference clone)
- `packages/core/src/infrastructure/db/schema.ts` (memories.session_id, history, bi-temporal), `packages/core/src/domain/dip/history-manager.ts` (saveMessages/getLastMessages). Mapping target, cited as our own code.

## ADRs

### D1 — Time budget + per-question stop conditions
Letta 3h, mem0 0.5h. Per-question stop: if a cited path's symbol is not found after 2 Grep/Read attempts, mark the question `blocked` with reason and continue (do NOT spelunk the whole agent runtime). Total budget 3.5h; on exhaustion mark remaining questions blocked and emit BLUEPRINT_BLOCKED.

### D2 — Investigation depth: READ-surface shape only, NOT the agent runtime
Investigate the message/recall LIST + SCOPE + SEARCH shape (pagination cursor, ordering, per-agent/run isolation, optional embedding search) — the read API a consumer calls. Do NOT investigate how messages are PRODUCED (agent loop, tool execution) — TheMemory already has the write substrate (history + saveMessages). Rationale: M2 is a read surface over existing data; the production path is out of scope (and is the agent-runtime concern deferred to TheoKit per the roadmap).

### D3 — DEFER-CORNER tools
`<!-- DEFER-CORNER: tools | Letta's build/test tooling + distroless fit were already investigated in the M1 discovery (agentic-skill-execution-sandbox-blueprint.md § Coverage Corner 3); the episode read surface adds NO new tooling (reuses the existing Hono REST + pg stack). No tools question needed. -->`

## Research Questions

| Qid | Question | Corner | Fase A (locate) | Fase B (analyze) | Expected answer shape |
|---|---|---|---|---|---|
| Q1 | How does Letta's `message_manager` paginate + order the message list (cursor after/before, limit, ascending)? | techniques | Grep `def list_messages\|list_user_messages_for_agent` in `.claude/knowledge-base/references/letta/letta/services/message_manager.py` | Read `list_messages` (~:895) + `list_user_messages_for_agent_async` (:870-895) | Cursor model (after/before id + limit + order_by/ascending) → mapping to a `GET /episodes` pagination contract |
| Q2 | What is Letta's "episode" boundary — how are messages scoped/grouped into a retrievable unit (agent_id / run_id / session)? | techniques | Read `.claude/knowledge-base/references/letta/letta/schemas/message.py` (scope fields) + the list filters in `message_manager.py` | Identify the grouping key(s) | The scope/group key Letta uses → mapping to our `session_id` (Session tier) as the episode boundary |
| Q3 | Does Letta expose semantic SEARCH over the message/recall log, and how (embedding filter)? **(EC-3 framing: keep message_manager TEMPORAL log distinct from passage_manager SEMANTIC archival — do NOT propose a 2nd vector store.)** | techniques | Grep `embed\|search\|query` in `message_manager.py` + Read `.claude/knowledge-base/references/letta/letta/services/passage_manager.py` | Determine if recall = list-only OR list + embedding search. **EC-1 sub-bullet: also grep `episod\|message.*log\|conversation` in `.claude/knowledge-base/references/mem0/mem0-ts/src` to confirm mem0 has NO episodic equivalent (negative evidence → Letta is the sole reference).** | Whether episode-scoped recall needs embedding search vs pure temporal/bi-temporal list → our `recall({episode\|asOf})` shape; + mem0 negative-evidence note |
| Q4 | How does Letta test the message list — pagination, ordering, per-agent isolation? | tests | Read `.claude/knowledge-base/references/letta/tests/managers/test_message_manager.py` | Extract the assertion shape (cursor edges, ordering, isolation) | The GOAL-test shape for our episodes endpoint |
| Q5 | Does Letta's message/recall layer pull any new runtime dep beyond pg/sqlalchemy, or reuse the store? | deps | Grep imports in `message_manager.py` + `.claude/knowledge-base/references/letta/pyproject.toml` | Confirm reuse vs new dep | Confirmation that the episode tier needs NO new dep (reuses pg) — protects our "no new storage engine" constraint |

## Coverage Matrix

| Corner | Questions | Status |
|---|---|---|
| techniques | Q1, Q2, Q3 | mapped (≤3; Q6 mem0-comparison folded into Q3 Fase B per EC-1) |
| tests | Q4 | mapped |
| deps | Q5 | mapped |
| tools | (none) | DEFER-CORNER per ADR D3 |

> Budget: 5 questions total (within 5-10); techniques = 3 (≤3 honored). The mem0 negative-evidence check rides inside Q3's analysis (EC-1 fold), not as a 4th techniques question.

## Halt-loop checkpoints (for /discover-execute)
- Before marking Q1-Q3 done: the cited `message_manager.py` symbol must be found + quoted with a line number.
- **EC-2:** before Q2 maps Letta's grouping key → our `session_id`, confirm the scope field's SOURCE: if `schemas/message.py` declares it, cite there; if the grouping lives only in the manager's list-filter args, cite `message_manager.py`. Do NOT assert a mapping from an absent field.
- **EC-3:** Q3 must keep `message_manager` (temporal log) distinct from `passage_manager` (semantic archival); the blueprint must NOT recommend a second vector store (roadmap "no new storage engine").
- Before marking Q4 done: the test file's assertion shape must be quoted.
- Q3 mem0-comparison sub-check: a single grep result (presence or empty) is sufficient.

## Acceptance Criteria
- Every question answered OR honestly blocked with reason.
- Every `.claude/knowledge-base/references/` citation resolves on disk.
- All 4 corners populated OR DEFER-CORNER marked (tools).
- Blueprint maps each Letta finding → a TheMemory substrate element (history / memories.session_id / bi-temporal) so the implementation plan can reuse, not rebuild.
- ≥ 1 ADR in the blueprint recommending the episode read-surface shape (pagination + scope boundary + list-vs-search) for owner review.

## Global Definition of Done
Per `.claude/rules/discover-blueprint-golden-rule.md` + `discover-plan-golden-rule.md`: 4 corners (or DEFER-CORNER), no fabricated citations, ≥2 ADRs, methods present on every question, verdict ≥ SHIPPABLE_WITH_CAVEATS on `/discover-confidence`.
