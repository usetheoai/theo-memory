# Blueprint: First-class episodic / message-log tier (M2 / gap G3)

Version: 1.0
Slug: first-class-episodes
Owner: project-owner
Date: 2026-06-22
Source plan: `.claude/knowledge-base/discoveries/plans/first-class-episodes-plan.md` (v1.1, SHIPPABLE 99.7)
Edge-case review: `.claude/knowledge-base/reviews/first-class-episodes-edge-cases-2026-06-22.md` (EC-1..EC-3 absorbed)

## Context

M2 closes gap G3: Letta exposes the conversation/event history as a first-class, paginated + (text-)searchable tier; TheMemory has the substrate (history audit table, `memories.session_id`, bi-temporal `t_valid`/`t_invalid`, `HistoryManager.saveMessages`/`getLastMessages`) but no first-class episode READ surface. This blueprint maps Letta's `message_manager` list/scope/search shape onto TheMemory's EXISTING substrate so the implementation plan reuses, not rebuilds (roadmap constraint: no new storage engine). mem0 has no episodic tier (negative evidence) — Letta is the sole reference.

## Objective

Recommend the minimal correct shape of a first-class episodic read surface (`GET /v1/scopes/:type/:id/episodes` + episode-scoped recall) over the existing substrate, grounded in Letta's `message_manager`.

---

## Coverage Corner 1 — Integration Tests

### Letta
`.claude/knowledge-base/references/letta/tests/managers/test_message_manager.py` is the GOAL-test shape to mirror:
- `test_message_listing_basic` (:491) — list returns the agent's messages.
- `test_message_listing_cursor` (:500) — after/before cursor pagination edges.
- `test_message_listing_filtering` (:539) — scope/group filtering.
- `test_message_listing_text_search` (:549) — `query_text` partial-text filter.
- `test_soft_deleted_message_excluded_from_list_and_getters` (:329) — soft-deleted rows excluded from list + getters.

**Borrowed test shape for our GOAL test** (`tests/integration/episodes.test.ts`, real pgvector):
1. N remembers in a session → `GET .../episodes` lists them in temporal order.
2. cursor pagination (after/before + limit) returns correct page + edge.
3. scope isolation — session-A episode not visible from session-B / cross-workspace → 404/empty.
4. bi-temporal `asOf` — `recall({ asOf })` returns the episode state valid at an instant (closes EC-9).
5. soft-deleted (forgotten / `t_invalid`-set) rows excluded from the episode list.

### mem0
Negative evidence: grep `episod|message.?log|conversation.?history` in `.claude/knowledge-base/references/mem0/mem0-ts/src` matched only `prompts/index.ts` (a prompt template, not a tier). mem0 has NO episodic/message-log tier — confirms Letta is the sole reference.

---

## Coverage Corner 2 — Dependencies

### Letta
`message_manager.py` imports are stdlib (`json`, `uuid`, `datetime`, `typing`) + `sqlalchemy` (`.claude/knowledge-base/references/letta/letta/services/message_manager.py:1-6`) — NO new runtime dependency for the message/recall list; it reuses the existing Postgres/SQLAlchemy store. The semantic archival tier (`passage_manager.py`) is the only one that pulls an embedding client (`get_openai_embedding_async`, `passage_manager.py:35-40`) — and that tier is OUT of M2 scope.

**Mapping:** TheMemory's episode read surface needs NO new dependency — it reads the existing `memories` / `history` tables via the existing `pg` + drizzle stack. Protects the roadmap "no new storage engine" constraint.

---

## Coverage Corner 3 — Tools

DEFER-CORNER (ADR D3): Letta's build/test tooling + distroless fit were investigated in the M1 discovery (`agentic-skill-execution-sandbox-blueprint.md § Coverage Corner 3`). The episode read surface adds NO new tooling — it reuses the shipped Hono REST + pg + vitest stack.

---

## Coverage Corner 4 — Techniques

### Technique 1 — Cursor pagination + ordering (Letta `list_messages`)
`message_manager.list_messages(agent_id, after, before, query_text, limit=50, ascending=True, group_id, run_id)` (`.claude/knowledge-base/references/letta/letta/services/message_manager.py:895`):
- **Cursor:** `after`/`before` are message IDs; rows are filtered by **`sequence_id`** relative to the cursor (`:927`). `NoResultFound` if the cursor id doesn't exist.
- **Ordering:** `ascending` sorts by `sequence_id` (monotonic insertion order) — NOT by created_at (avoids same-timestamp ties).
- **Limit:** default 50.

**Mapping → TheMemory:** episode list paginates by `(created_at, id)` cursor (our `memories` has `created_at` + a UUID id + a `memories_session_id_idx`); `after`/`before` + `limit` + `ascending`. We have no monotonic `sequence_id` — use `(created_at, id)` composite cursor for tie-stable ordering (a follow-up could add a sequence column if needed).

### Technique 2 — Scope/group boundary (the "episode")
Letta scopes by `agent_id` (primary, indexed: "leveraging the index on messages.agent_id", `:913`) + optional `group_id` + `run_id` filters (`:903-913`). The retrievable unit = messages sharing an `agent_id` (+ optional finer group/run).

**Mapping → TheMemory:** the episode boundary = our **`session_id`** (the Session tier already models a conversation/run) within a `(workspace_id, user_id?)` scope. `GET /v1/scopes/session/:id/episodes` lists the session's events; the existing `memories_session_id_idx` backs it (same index-leveraged pattern as Letta's agent_id). No new column needed for the boundary.

### Technique 3 — Text filter is NOT semantic search (EC-3 — the load-bearing finding)
Letta's MESSAGE log `query_text` is a **partial text match** (ilike-style content filter), NOT embedding search (`message_manager.py:921` "filter messages whose text content partially matches"). Semantic/vector search lives in the SEPARATE `passage_manager.py` archival tier (`get_openai_embedding_async` + pgvector, `:35-40,148`).

**Mapping → TheMemory (CRITICAL constraint):** the episode tier is a **temporal/bi-temporal LIST** (+ optional text filter), NOT a new semantic tier. TheMemory ALREADY has semantic `recall()` (the 9-step search). Episode-scoped recall = our existing `recall()` constrained to a session + `{ asOf }` over the existing bi-temporal `t_valid`/`t_invalid` columns. **Do NOT introduce a second vector store** (roadmap "no new storage engine"). This is the EC-3 framing, confirmed against the code.

### Technique 4 — Soft-delete exclusion + bi-temporal asOf
Letta excludes soft-deleted messages from list + getters (`test_soft_deleted_message_excluded`, `:329`). TheMemory already has the null-safe bi-temporal predicate (`(t_valid IS NULL OR t_valid <= asOf) AND (t_invalid IS NULL OR t_invalid > asOf)`, ADR-0011). Episode list reuses it: exclude `t_invalid IS NOT NULL` rows by default; honor `{ asOf }` for historical replay (this also closes the deferred EC-9 skill-scope `asOf` opportunity in the same shape).

---

## Cross-cutting Comparison

| Dimension | Letta (reference) | TheMemory (target M2) |
|---|---|---|
| Episode tier | first-class `message_manager` list | NEW read surface over existing memories/history |
| Cursor | after/before by `sequence_id` | after/before by `(created_at, id)` |
| Boundary | agent_id (+ group/run) | `session_id` within workspace/user scope |
| Search | message log = text filter; passages = semantic (separate) | episode = temporal list + text filter; semantic = existing `recall()` |
| asOf / history | soft-delete exclusion | existing bi-temporal predicate (closes EC-9) |
| New storage | passages tier has its own | NONE — reuse memories/history/pg |
| New dep | none for message log | none |

---

## ADRs

### D1 — Time budget + stop conditions
Letta-focused (3h), mem0 0.5h. No question blocked; all symbols found + quoted with line numbers. mem0 negative evidence confirmed in one grep.

### D2 — Investigation depth: read-surface only
Investigated the list/scope/search shape, not the agent runtime that produces messages (TheMemory already has the write substrate). Did NOT read Letta's agent loop.

### D3 — RECOMMENDATION for TheMemory (owner review): episode tier = temporal/bi-temporal read surface over existing substrate, NO new storage
- **Boundary:** `session_id` is the episode (Session tier). `GET /v1/scopes/session/:id/episodes` (+ generalizable to user/agent).
- **Shape:** cursor pagination `(after|before, limit, ascending)` by `(created_at, id)`; default exclude `t_invalid IS NOT NULL`; honor `{ asOf }` (bi-temporal replay, closes EC-9).
- **Search:** episode list = temporal + optional text filter; semantic = the EXISTING `recall()` constrained by session — NO second vector store.
- **Storage:** reuse `memories` (+ `history` for the audit/event view); NO new table required for v1 (a `sequence_id` column is a future tie-break optimization, NOT required — `(created_at, id)` is sufficient).
- **No new dependency.**
- Alternatives rejected: (a) a dedicated `episodes`/`messages` vector tier (= the passage_manager shape) — REJECTED: duplicates the existing store + violates "no new storage engine"; (b) sequence_id column now — DEFERRED: `(created_at, id)` cursor suffices for v1.

---

## Recommendations for TheMemory

1. New REST `GET /v1/scopes/:type/:id/episodes` — cursor list (`after`/`before`/`limit`/`order`) over `memories` filtered by scope + `t_invalid IS NULL` (default), with `?asOf=` bi-temporal replay.
2. SDK: `ScopedMemory.episodes(opts?)` (or `recall({ asOf })` extension) — temporal list over the existing substrate; reuse `composeFilters` for isolation (same as recall/forget).
3. NO new vector store, NO new dependency, NO new table for v1 (`(created_at, id)` cursor). Optional `sequence_id` is a documented follow-up.
4. Close EC-9 (skill-scope `asOf`) by reusing the same bi-temporal predicate in the episode/recall path.
5. GOAL test mirrors `test_message_manager.py`: list + cursor + scope isolation + asOf + soft-delete exclusion, against real pgvector.

## Blocked questions
None. Q1-Q5 answered + mem0 negative-evidence confirmed.

## Halt-loop progress (audit trail)
| Q | Corner | Status | Key citation |
|---|---|---|---|
| Q1 cursor/order | techniques | done | `message_manager.py:895-927` |
| Q2 boundary | techniques | done | `message_manager.py:903-913` (agent_id/group_id/run_id) |
| Q3 text-vs-semantic | techniques | done | `message_manager.py:921` (text) + `passage_manager.py:35-40` (semantic, separate) |
| Q4 tests | tests | done | `tests/managers/test_message_manager.py:329-549` |
| Q5 deps | deps | done | `message_manager.py:1-6` (sqlalchemy+stdlib, no new dep) |
| mem0 (Q3 sub) | — | done | grep `mem0-ts/src` → only prompts/index.ts (no episodic tier) |

## Related
- Roadmap: `.claude/knowledge-base/roadmaps/memory-gaps-roadmap.md` § M2
- Closes opportunity: EC-9 (skill-scope `asOf`) deferred caveat
- Next: `/discover-confidence first-class-episodes` → `/to-plan first-class-episodes --milestone M2`
