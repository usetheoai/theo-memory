# Blueprint: v0.4b — Forgetting pipeline with long-tail preservation

> **Version 1.0** — Technical synthesis of how `.claude/knowledge-base/references/letta/` + `.claude/knowledge-base/references/mem0/` + prior_art (Ebbinghaus 1885 modern reformulations + cache eviction literature + LangMem forgetting contract) handle automated forgetting/eviction, triadic scoring composition, LRU/LFU bookkeeping, and long-tail anti-frequency-bias guardrails — informing `/to-plan v0-4b-forgetting-pipeline` to lock the implementation contract for TheMemory's Roadmap Item 6 (CLAUDE.md flagged **OPEN PROBLEM #1** — "no competitor solved this"). v0.1 ships `Memory.forget(id)` for caller-driven removal; v0.4b adds the AUTOMATED forgetting layer that decides what to evict when capacity/decay thresholds fire. ADR D3 (discovery plan) locked 3 dimensions (Ebbinghaus + LRU/LFU + LLM-importance) — v0.4b ships ONE `EvictionPolicy` DIP with one `TriadicScoringPolicy` implementation parameterized by per-dimension weights + protection-multiplier-based long-tail guardrail (D4) + soft-delete via `t_invalid` (D6).

**Slug:** `v0-4b-forgetting-pipeline`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-4b-forgetting-pipeline-plan.md` (v1.1)
**Edge-case review:** `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-edge-cases-2026-05-26.md` (7 ECs absorbed)
**Owner:** TheMemory v0.4b cycle-discover (forced-override invocation via /auto-plan)
**Generated:** 2026-05-26 via `/discover-execute`
**Confidence verdict:** **SHIPPABLE_WITH_CAVEATS (89/100)** — scored 2026-05-26 via `/discover-confidence v0-4b-forgetting-pipeline`. Single soft cap: `soft_floor_citation_density_low` (0.45 cit/200w; 7055 words / 16 verified `.claude/knowledge-base/references/` citations + 7 URL snapshots). All hard-cap gates pass: 4/4 local coverage corners populated, Corner 5 (prior_art) populated via URL+snapshot, 16/16 local citations verified, 10/10 mandatory sections + 5 ADRs (D7-D11) present. Full JSON at `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-confidence-2026-05-26.md.json`.

## Context

Roadmap Item 6 (CLAUDE.md § Macro roadmap, currently Planned, **OPEN PROBLEM #1**). Depends on Item 5 (v0.4a reflection pipeline) shipping the `llm_importance_score` column REUSED by v0.4b's triadic signal. CLAUDE.md Item 6 acceptance verbatim:

> Curated test set: 1000 memories with 50 rare-query targets seeded. After `forget()` cycle removing 30% by triadic score: `recall@10` on rare-query set ≥ TBD (lock by v0.4b kickoff). Guardrail unit test: a rare-but-isolated memory survives ≥ 5 consecutive LRU eviction passes against frequent siblings. Evaluation matrix published at `docs/forgetting-evaluation.md` (artifact must exist + be reproducible).

**Pre-flight grep confirmation (v1.1 EC-7 cross-cutting observation absorbed):** `grep -rln "def evict\|memory_decay\|Ebbinghaus" .claude/knowledge-base/references/letta .claude/knowledge-base/references/mem0` returns ZERO hits. Letta's archival is DELETE-only (caller-driven, 9 `def delete_*` functions in passage_manager.py); Mem0's pattern same (`delete`/`delete_all`/`_delete_memory`). The "OPEN PROBLEM #1 — no competitor solved this" framing is EMPIRICALLY GROUNDED before the halt-loop runs.

## Objective

Lock six decisions for `/to-plan v0-4b-forgetting-pipeline`: (a) triadic scoring shape (additive vs multiplicative; default weights), (b) Ebbinghaus decay function (constants from literature), (c) LRU/LFU bookkeeping mechanism (in-memory vs DB), (d) long-tail guardrail multiplier formula, (e) eviction trigger model (capacity-based / time-based / threshold-based), (f) test pyramid coverage for triadic scoring + guardrail edge cases.

---

## Coverage Corner 1 — Integration Tests

### Letta — `test_insert_archival_memory.py` (Q1, EC-4 absorbed)

**Negative-space finding (the answer IS the absence).** The only file under `.claude/knowledge-base/references/letta/tests/performance_tests/` matching archival/eviction shape is `test_insert_archival_memory.py` (186 LoC, two test functions). After full read + targeted grep, **ZERO assertions exist for eviction, capacity, threshold, forget, TTL, or decay.** The file is INSERT-side stress only.

```bash
$ grep -ni "eviction\|evict\|capacity\|threshold\|forget\|delete\|TTL\|decay" \
    .claude/knowledge-base/references/letta/tests/performance_tests/test_insert_archival_memory.py
(no matches)
```

Test inventory:

| Test function (file:line) | Behavior asserted | Fixture/idiom |
|---|---|---|
| `test_insert_archival_memories_concurrent` (`.claude/knowledge-base/references/letta/tests/performance_tests/test_insert_archival_memory.py:63-162`) | Latency stats (min/mean/max/stdev) and concurrency curve for 30 concurrent agents each creating ONE archival passage via `client.agents.passages.create(agent_id=aid, text=...)` (line 87). Renders 6-panel matplotlib diagnostics (`latency_diagnostics.png`). NO assertion on retrieval, eviction, or capacity. | `@pytest.fixture(scope="session")` server bootstrap via `threading.Thread(target=_run_server, daemon=True)` + `time.sleep(2)` warmup (`.../test_insert_archival_memory.py:27-45`). `AsyncLetta(base_url=server_url)` client. `Faker` paragraphs as payload. |
| `test_insert_large_archival_memory` (`.claude/knowledge-base/references/letta/tests/performance_tests/test_insert_archival_memory.py:165-185`) | Wall-clock for ONE archival passage of size = full `data/paper1.txt` (read via `Path.read_text()`). Prints `Total time: {t1 - t0}`. NO assertion at all (no `assert` statement in body). | Same server + client fixtures. Single agent. |

**Implications for v0.4b (cross-cutting observation — EC-7 reinforcement):**

1. Letta ships NO eviction test surface. Combined with the pre-flight grep result (ZERO `def evict\|memory_decay\|Ebbinghaus` hits across the entire repo), this confirms Letta has NO automated forgetting pipeline to test. The test file is a strict negative-space finding aligned with CLAUDE.md Item 6's "OPEN PROBLEM #1 — no competitor solved this".

2. The closest analog to TheMemory's v0.4b acceptance ("1000 memories with 50 rare-query targets seeded; recall@10 ≥ TBD after 30% triadic-score eviction; rare-isolated memory survives ≥ 5 consecutive LRU passes") does NOT exist in Letta. TheMemory will be authoring this test pyramid greenfield — see ADR D7 below.

3. The Letta stress-test idioms WORTH borrowing: (a) session-scoped server fixture + concurrency curve plotting, (b) `tqdm` progress bar over agent setup, (c) `Faker` payload generation. The idioms NOT applicable: matplotlib diagnostics (TheMemory's vitest stack uses simpler `console.log` summaries).

---

## Coverage Corner 2 — Dependencies

### Letta — relevant deps for archival/eviction (Q2)

`.claude/knowledge-base/references/letta/pyproject.toml:1-82` (project table + `dependencies`). Pre-flight read of the full dep list against the Q3/Q4 evidence (NO automated eviction code) is consistent: Letta does NOT pull in ANY purpose-built eviction/decay/LRU runtime library. The only adjacency-adjacent deps are:

| Dep | Version | Line | Relevance to v0.4b |
|---|---|---|---|
| `apscheduler` | `>=3.11.0` | `.claude/knowledge-base/references/letta/pyproject.toml:59` | Background scheduler primitive. Could host an eviction sweep, but Q3 grep confirms NO eviction job is registered against it. |
| `async-lru` | `>=2.0.5` | `.claude/knowledge-base/references/letta/pyproject.toml:80` | Python function-call memoization decorator (`@alru_cache`), NOT memory eviction. False-positive for our scope. |
| `pgvector` | `>=0.2.3` | `.claude/knowledge-base/references/letta/pyproject.toml:90` (optional-dep `postgres`) | TheMemory already uses pgvector — informational. |

**Conclusion (Letta side):** Letta does NOT depend on any eviction-specific library at runtime. The lack of eviction code path explains the lack of dep.

### Node ecosystem candidates (Rule 9 evaluation — EC-3 locked 3 candidates)

Three npm candidates fetched 2026-05-26 from allowlisted `github.com` (npmjs.com front-end returned 403 — registry endpoints not allowlisted; GitHub repos used per cycle-discover.md fallback pattern):

#### `lru-cache` (isaacs/node-lru-cache)

- Source: https://github.com/isaacs/node-lru-cache (snapshot: 8dedad35a953)
- Version: v11
- License: BlueOak-1.0.0 (permissive — compatible with TheMemory MIT)
- Algorithm: classic LRU (least-recently-used eviction)
- Features: `maxSize` + `sizeCalculation`, `ttl` (weak guarantees), `fetchMethod` (stale-while-revalidate), `dispose` callback on eviction, `updateAgeOnGet`/`updateAgeOnHas`
- TypeScript: native (rewritten in TS at v8)
- Per-item access metadata: YES (recency tracked via doubly-linked list internally)

#### `quick-lru` (sindresorhus/quick-lru)

- Source: https://github.com/sindresorhus/quick-lru (snapshot: 22ed91fa170b)
- Version: v7.3.0 (October 2025)
- License: MIT (compatible with TheMemory MIT)
- Algorithm: dual-cache variant of hashlru (two `Map` objects; avoids expensive delete; cache size oscillates between `maxSize` and `2×maxSize`)
- Features: global `maxAge` + per-item `expiresIn(key)`, simple `set/get/delete`
- TypeScript: native (`index.d.ts` shipped)
- Per-item access metadata: implicit via map shuffling — NO public API to inspect recency

#### `keyv` (jaredwray/keyv)

- Source: https://github.com/jaredwray/keyv (snapshot: cd0e49d7f209)
- Version: v6 (beta as of Apr 2026; v5 in maintenance mode)
- License: MIT (compatible with TheMemory MIT)
- Purpose: storage ABSTRACTION layer across In-memory / Redis / Postgres / MySQL / MongoDB / SQLite / DynamoDB / Etcd / Memcache / Valkey
- Features: TTL-based expiry; backend-specific eviction (not native to keyv itself)
- TypeScript: native (99.8% TS)
- Native LRU/LFU: NO — keyv delegates to backend

#### Rule 9 verdicts (per discovery plan v1.1 Q2 acceptance):

| Candidate | Verdict | Rationale | Linked discovery plan ADR |
|---|---|---|---|
| `lru-cache` | **REJECT** for TheMemory v0.4b runtime | Three reasons: (a) **wrong abstraction layer** — TheMemory's bookkeeping must persist in Postgres rows (`last_accessed_at` + `access_count` per plan D5), NOT in a process-local map that loses state on restart, violating v0.4a's D2 (same rationale, restated). (b) **Pure LRU lacks the F-dimension** — CLAUDE.md Item 6 mandates LRU/LFU (frequency); lru-cache offers recency only. (c) **No LLM-importance or decay support** — would force TheMemory to layer triadic scoring ON TOP, with two sources of truth (process map + DB rows). Use the bookkeeping columns directly. | Plan D5 (DB columns) confirms |
| `quick-lru` | **REJECT** for TheMemory v0.4b runtime | Same wrong-abstraction-layer reasoning as `lru-cache`, plus: quick-lru's "implicit" recency tracking via Map shuffling has NO public API to inspect per-item recency — TheMemory would not be able to read the recency signal at scoring time. | Plan D5 confirms |
| `keyv` | **REJECT** for TheMemory v0.4b runtime | Three reasons: (a) wrong layer — keyv is a key-value STORE abstraction; TheMemory already has Drizzle + pgvector via v0.1. Adding keyv would duplicate the persistence layer. (b) keyv has NO native eviction algorithm; relies on backend (which would be pgvector again, circular). (c) keyv's primitives don't compose with TheMemory's existing `MemoryStore` interface — different mental model (key-value vs scoped semantic memory). | Plan D5 + v0.1 schema confirms |

**Net Rule 9 outcome:** ZERO npm dep adopted. TheMemory v0.4b ships in-house triadic-scoring + LRU/LFU bookkeeping (two DB columns per plan D5) + Ebbinghaus decay (math constant from Q7 prior_art). All three candidates are wrong abstraction LAYER, not wrong libraries — adopting any would violate Inquebrável Rule 9's caveat: "the abstraction is so fine that the dependency external costs more than the implementation". The implementation here is ≈30 LoC of TypeScript scoring math + Drizzle migration; pulling 4-10kB of cache library is anti-pragmatic.

`node-cache` (v1.1 EC-3 informational F-followup) NOT fetched — same rejection logic would apply (process-local TTL/eviction cache; wrong layer).

---

## Coverage Corner 3 — Tools

### Letta — eviction trigger mechanism (Q3, EC-1 + EC-2 absorbed)

**Verdict: Letta has NO automated eviction trigger.** The 4-way classification (write-time / read-time / scheduled / on-demand) collapses entirely to "on-demand" — i.e., caller-invoked `delete_*` only.

**Evidence (grep-anchored offset reads per EC-1/EC-2):**

Pre-flight `grep -n "def delete_\|def evict\|capacity\|TTL\|decay\|archival" .claude/knowledge-base/references/letta/letta/services/passage_manager.py` returns 19 hits, ALL caller-invoked `delete_*` functions or `archival` namespace markers. ZERO match for `def evict|capacity|TTL|decay`.

Same grep against `.claude/knowledge-base/references/letta/letta/services/agent_manager.py` returns hits ONLY for: (a) `delete_agent_async` (line 1320) — full-agent teardown, not eviction; (b) `num_archival_memories` counter (lines 1483, 1494, 1538, etc.) — observable for rebuild_system_prompt sizing decisions, NOT a trigger.

Same grep against `.claude/knowledge-base/references/letta/letta/services/context_window_calculator/context_window_calculator.py` returns ONLY signature parameters at lines 256 + 357 referencing `num_archival_memories` for token-budget accounting. NO eviction logic.

**The 9 `def delete_*` functions in passage_manager.py (lines 767-938)** — all are caller-driven, all perform `hard_delete_async` (physical SQL DELETE, NOT soft-delete) via `ArchivalPassage.hard_delete_async` or `ArchivalPassage.bulk_hard_delete_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:778, 808, 830, 836, 869, 917`). Coordination with Turbopuffer dual-delete is built in (lines 781-792, 880-891) when archive uses TPUF vector DB.

**Public API surface for forget (caller-driven only):**

| Function (file:line) | Granularity | Notes |
|---|---|---|
| `delete_agent_passage_by_id_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:767`) | single passage | TPUF dual-delete + strict_mode |
| `delete_source_passage_by_id_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:800`) | single passage | source passages only |
| `delete_passage_by_id_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:815`) | single passage | DEPRECATED — tries source then archival |
| `delete_agent_passages` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:843`) | bulk (sync) | TODO comment: "very inefficient" |
| `delete_agent_passages_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:857`) | bulk (async) | Single SQL `bulk_hard_delete_async` + per-archive TPUF dual-delete |
| `delete_source_passages` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:897`) | bulk (sync) | Same inefficiency TODO |
| `delete_source_passages_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:911`) | bulk (async) | `SourcePassage.bulk_hard_delete_async` |
| `delete_passages` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:923`) | bulk | DEPRECATED |
| `delete_agent_async` (`.claude/knowledge-base/references/letta/letta/services/agent_manager.py:1320`) | full agent teardown | Includes passage cascade, NOT eviction |

**4-way classification result:**

| Trigger | Letta has it? | Evidence |
|---|---|---|
| Write-time (on-add capacity check) | NO | No `if total > limit: evict_oldest` pattern in `create_many_archival_passages_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:396-436`) — only batch INSERT |
| Read-time (LRU bookkeeping update) | NO | No `last_accessed_at` column update in retrieval paths; no `access_count` increment |
| Scheduled (background sweep) | NO | No cron / background worker / sleep-time agent calls `delete_*` |
| On-demand (caller invokes API) | YES | All 9 functions are explicit caller calls |

**Implications for TheMemory v0.4b:**

- TheMemory's `EvictionPolicy` DIP (per plan D3 + D5) introduces FIVE behaviors that Letta does NOT have: triadic scoring, LRU bookkeeping (`last_accessed_at` + `access_count` per plan D5), Ebbinghaus decay, long-tail multiplier (D4), and soft-delete via `t_invalid` (D6) instead of `hard_delete`.
- Letta's TPUF dual-delete pattern IS worth borrowing structurally for our pgvector + entity-store dual-delete coordination (architectural parallel: when a memory is forgotten, both `memories.pgvector` AND `entities.pgvector` need updating).
- The "very inefficient" TODO comments on bulk delete functions (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:849, 903, 935`) are a quality signal: even Letta's caller-driven path is not optimized; TheMemory has a clean-slate opportunity here.

---

## Coverage Corner 4 — Techniques

### Letta archival eviction algorithm (Q4, EC-1 absorbed)

**Verdict: Letta has NO eviction algorithm.** All forget code paths are PHYSICAL DELETE via `hard_delete_async` invoked by an external caller. No scoring, no decay, no LRU/LFU tracking, no capacity-based trigger, no long-tail protection.

**Algorithm description (3 sentences):**

1. Caller invokes one of 9 `delete_*` API functions on `PassageManager` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:767-938`) with explicit passage ID(s) and an actor (`PydanticUser`) for permission scoping.
2. For each passage, the SQL row is hard-deleted via `ArchivalPassage.hard_delete_async` (single) or `ArchivalPassage.bulk_hard_delete_async` (bulk) inside an `async_session()` transaction (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:778, 869`).
3. If the archive's `vector_db_provider == VectorDBProvider.TPUF`, a SECOND delete fires against Turbopuffer (`tpuf_client.delete_passage` / `tpuf_client.delete_passages`) with optional `strict_mode` re-raising on failure (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:783-792, 882-891`).

**Decision points (when fire / what evict / how protect rare):**

| Decision | Letta answer | Source citation |
|---|---|---|
| When does eviction fire? | Never automatically — caller must call `delete_*` | `.claude/knowledge-base/references/letta/letta/services/passage_manager.py:767-938` (entire delete section is caller-driven) |
| What does it evict? | Whatever IDs the caller passes — no scoring, no priority | `.claude/knowledge-base/references/letta/letta/services/passage_manager.py:843-853` (bulk passes raw `List[PydanticPassage]`) |
| How does it protect rare? | NOT protected — physical delete cannot be undone | `hard_delete_async` is permanent; no `t_invalid`/soft-delete pattern in passage_manager |
| Capacity check before delete? | NO — `agent_passage_size_async` (`.claude/knowledge-base/references/letta/letta/services/passage_manager.py:955`) is observability ONLY | `agent_manager.py:1483, 1494, 1538` consume this counter for rebuild_system_prompt sizing, not for eviction decisions |

**`context_window_calculator.py` (384 LoC, FULL read) is NOT an eviction module.** The `calculate_context_window` function (`.claude/knowledge-base/references/letta/letta/services/context_window_calculator/context_window_calculator.py:249-384`) accepts `num_archival_memories: int` as INPUT and threads it through to a `ContextWindowOverview` response object as `num_archival_memory` (line 357) for diagnostics. It computes token counts per section (system_prompt, core_memory, memory_filesystem, tool_usage_rules, directories, external_memory_summary, summary_memory, messages, available_functions_definitions — lines 320-338) via `asyncio.gather` for parallel token-counter calls. THERE IS NO DECISION RULE that emits "evict N archival passages because tokens > limit" — that decision is upstream (in `summarizer`, covered by v0.4a, out of scope here).

**Implications for TheMemory v0.4b (strongest positioning insight):**

- TheMemory's triadic-scored automated eviction IS innovation against BOTH Letta and Mem0 (Q5 confirms same negative space).
- The CLAUDE.md "OPEN PROBLEM #1 — no competitor solved this" claim is empirically grounded by exhaustive grep + targeted reads on the primary candidate (Letta) for "automated archival eviction".
- Letta's pattern of `hard_delete_async` per-row + dual-delete coordination for vector DB IS a structural pattern worth preserving — TheMemory should follow the same per-row coordination shape but with `soft-delete-via-t_invalid` (per plan D6) instead of physical DELETE.

### Mem0 forget primitives + capacity policy (Q5)

**Verdict: Mem0 OSS has NO automated eviction.** Same negative-space pattern as Letta — three caller-driven primitives only (`delete`, `delete_all`, `_delete_memory`) operating on explicit ID or scope filters.

**Public OSS API surface (caller-driven):**

| Method (file:line) | Behavior | Notes |
|---|---|---|
| `Memory.delete(memory_id)` (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1524-1538`) | Single-ID delete: `vector_store.get(vector_id)` to verify exists; raise `ValueError` if not found; call `_delete_memory(memory_id, existing_memory)`. Returns `{"message": "Memory deleted successfully!"}`. | Telemetry via `capture_event("mem0.delete", ...)`. |
| `Memory.delete_all(user_id, agent_id, run_id)` (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1540-1571`) | Scope-filtered bulk delete. **Refuses to operate without at least ONE filter** — raises `ValueError("At least one filter is required to delete all memories. If you want to delete all memories, use the reset() method.")`. Iterates `vector_store.list(filters=filters)[0]` and calls `_delete_memory(memory.id)` per row. | Safety guardrail against accidental full wipe. |
| `Memory._delete_memory(memory_id, existing_memory=None)` (`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1722-1733+`) | Internal worker. Resolves `existing_memory` if not passed; extracts `prev_value`/`created_at`/`session_filters`; calls `vector_store.delete(vector_id=memory_id)` + history persistence + entity-store cleanup. | Single physical delete from vector store. |

**Capacity / quota / decay grep results across `.claude/knowledge-base/references/mem0/mem0/memory/main.py`:**

```bash
$ grep -n "quota\|max_memories\|capacity\|memory_decay\|Ebbinghaus\|TTL\|evict" \
    .claude/knowledge-base/references/mem0/mem0/memory/main.py
(no matches)
```

**Hosted-platform quota exists but is NOT local eviction.** The `MemoryQuotaExceededError` exception (`.claude/knowledge-base/references/mem0/mem0/exceptions.py:224`) is referenced exclusively in the HOSTED CLIENT (`.claude/knowledge-base/references/mem0/mem0/client/main.py:182,218,243,295,376,402,431,531,557,583`) — i.e., the SaaS endpoint `api.mem0.ai` enforces server-side quotas and may raise this error to the SDK consumer, but the OSS self-hosted `Memory` class has zero quota logic. There is no local "evict to free space" code path.

**Boolean answer: Does Mem0 OSS have automated eviction? NO.**

**Positioning paragraph (1-paragraph contrast against Letta + TheMemory v0.4b):**

> Mem0's forget contract is functionally identical to Letta's: three caller-driven primitives that physical-delete a row from the vector store on explicit demand. Neither project provides a scoring layer, an LRU/LFU bookkeeping column, an Ebbinghaus decay function, a long-tail protection multiplier, OR a capacity-based trigger that fires the delete automatically. The hosted Mem0 SaaS adds server-side quotas via `MemoryQuotaExceededError`, but that is an external rate-limit, not an in-process eviction algorithm. TheMemory v0.4b's triadic-scored automated forgetting WITH long-tail guardrail is therefore innovation against BOTH Letta and Mem0 — exactly matching CLAUDE.md Item 6's "OPEN PROBLEM #1 — no competitor solved this" framing. The structural pattern worth preserving from both projects: explicit per-row delete coordination across vector store + history + entity store; TheMemory should follow the same coordination shape but with `soft-delete-via-t_invalid` (per plan D6) and triadic-score-driven row selection (per plan D3+D4+D5).

Tests for delete behavior at the OSS Memory-class level are absent from `.claude/knowledge-base/references/mem0/tests/memory/test_main.py` (665 LoC); `grep "def test.*delete\|delete_all"` returns zero hits in that file. Delete coverage exists only at: (a) vector-store-driver tier (`.claude/knowledge-base/references/mem0/tests/vector_stores/test_qdrant.py:222`, `test_cassandra.py:117`, `test_baidu.py:155` — driver-level CRUD smoke), and (b) server-auth tier (`.claude/knowledge-base/references/mem0/tests/test_server_auth.py:104,108` — API-key requirement checks). No semantic eviction tests exist anywhere in the project.

### LangMem forget contract (Q6, EC-5 fallback applied — github.com used)

**Source:** `github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md` (snapshot: 7029cffc263a). Note: WebFetch on `langchain.com` front-end + npmjs.com both unreliable for bot agents; falling back to GitHub-hosted markdown via allowlisted `github.com` per cycle-discover.md hard-gate #6.

**LangMem's forget shape (verbatim quotes + interpretation):**

1. **No explicit `forget()` or `delete()` public API.** The conceptual guide describes Memory Managers as performing operations including "deleting/invalidating or updating/consolidating existing memories" as part of reconciliation, but no callable `forget(id)` primitive is documented at the conceptual layer.

2. **Implicit invalidation via consolidation pipeline.** Per the guide: *"the system must reconcile new information with previous beliefs, either deleting/invalidating or updating/consolidating existing memories."* Invalidation is one of four outcomes of the LLM-driven reconciliation step, not a standalone forget primitive.

3. **Recency × frequency scoring is acknowledged but NOT formalized.** Direct quote from the guide: *"memory relevance is more than just semantic similarity. Recall should combine similarity with 'importance' of the memory, as well as the memory's 'strength', which is a function of how recently/frequently it was used."* The guide does NOT specify a decay function (no Ebbinghaus, no exponential half-life, no Anki SM-2) — a strength variable is mentioned conceptually without an equation.

4. **Background consolidation pattern is cron-driven.** Per the deep-agents memory doc: *"deploy a consolidation agent alongside your main agent... and trigger it on a cron schedule"*. Cadence guidance: "a chat product with steady daily traffic might consolidate every few hours, while a tool used a handful of times per week only needs to run nightly or weekly. Consolidating much more often than users converse just burns tokens on no-op runs." This pattern is closer to v0.4a's `SleepTimeReflectionPolicy` than to v0.4b's automatic-eviction-on-threshold model.

**Three-way design comparison (Letta vs Mem0 vs LangMem vs TheMemory v0.4b proposal):**

| Dimension | Letta | Mem0 OSS | LangMem | TheMemory v0.4b |
|---|---|---|---|---|
| Public forget API | `delete_*` (9 variants, caller-driven physical delete) | `delete` / `delete_all` (caller-driven) | None explicit; invalidation only via Memory Manager pipeline | `Memory.forget(id)` (v0.1) + automatic via `EvictionPolicy` DIP |
| Automated eviction trigger | NO | NO | LLM-driven within consolidation pass (cron-scheduled), not score-driven | YES — triadic-scored, capacity- OR time-threshold-triggered |
| Recency tracking | NO (no `last_accessed_at` column) | NO (no `last_accessed_at` column) | Mentioned conceptually as "strength"; no equation | YES — `last_accessed_at` column (plan D5) |
| Frequency tracking | NO (no `access_count`) | NO (no `access_count`) | Mentioned conceptually; no equation | YES — `access_count` column (plan D5) |
| Importance score | NO (no per-row column) | NO | Mentioned conceptually | YES — `llm_importance_score` column REUSED from v0.4a |
| Long-tail protection | NO | NO | NO mention | YES — protection multiplier (plan D4) |
| Decay function | NO | NO | NO formalized | Ebbinghaus exponential (Q7 prior_art locks constants) |
| Soft vs physical delete | Physical (`hard_delete_async`) | Physical (`vector_store.delete`) | Implicit ("invalidate") — unclear semantics | Soft via `t_invalid` (plan D6) |

**Positioning insight (cross-cutting EC-7 reinforced):** LangMem comes closest of the three competitors to acknowledging the triadic-signal idea ("strength = how recently/frequently used"), but stops at conceptual prose without an equation, a column, or a scoring API. TheMemory v0.4b operationalizes what LangMem only describes — and adds the long-tail multiplier (D4) that no competitor mentions at all. CLAUDE.md Item 6's "OPEN PROBLEM #1 — no competitor solved this" stands EMPIRICALLY GROUNDED across all three primary reference projects.

---

## Coverage Corner 5 — Prior Art (web)

Two questions in this corner: Q7 (Ebbinghaus + modern reformulations + Anki SM-2 / Duolingo HLR) and Q8 (cache eviction algorithms + long-tail preservation). All sources from allowlisted arXiv + GitHub (langmem/duolingo); per-URL snapshots written to `.claude/knowledge-base/discoveries/snapshots/v0-4b-forgetting-pipeline/`. NO fabrication — every URL was WebSearched/WebFetched in this halt-loop session.

### Ebbinghaus forgetting curve — modern reformulation + Anki SM-2 (Q7)

**Verdict: ADOPT exponential form `p = 2^(-Δ/h)` per Duolingo HLR (Settles & Meeder, ACL 2016). Half-life `h` is the per-memory parameter; recommended starting default `h = 30 days` for TheMemory v0.4b (lock final at `/to-plan` per F-tbd-thresholds).**

**Canonical formula (Half-Life Regression, Duolingo production):**

```
p(recall | Δ, h) = 2 ^ (-Δ/h)
```

Equivalent exponential form (substituting `λ = ln(2)/h`):

```
p(recall) = exp(-λ · Δ) = exp(-(ln 2) · Δ / h)
```

- `p` ∈ [0, 1]: predicted probability that a memory is still retrieved at observation time
- `Δ`: time elapsed since last access (any units; use seconds in our schema, divide by 86400 for days)
- `h`: half-life — the time at which `p = 0.5`; this is the per-memory STABILITY parameter

Source: `github.com/duolingo/halflife-regression` (snapshot: a09f86dc871b). The Duolingo paper "A Trainable Spaced Repetition Model for Language Learning" (Settles & Meeder, ACL 2016) is the canonical production reference. `MAX_HALF_LIFE = 274` days (≈ 9 months) in their `experiment.py` config.

**Algorithm family comparison (per snapshot-backed synthesis):**

| Algorithm | Form | Data-driven? | Production system | Citation |
|---|---|---|---|---|
| Ebbinghaus 1885 | exponential `R = e^(-t/S)` | NO (psychological model) | None directly | classic memory equation |
| SuperMemo SM-2 / Anki | piecewise interval multiplier (ease factor) | NO (deterministic update rules) | Anki / SuperMemo | classic spaced-repetition algorithm |
| HLR (Half-Life Regression) | exponential `p = 2^(-Δ/h)` with regression-learned `h` | YES (Duolingo log data) | Duolingo | Settles & Meeder ACL 2016 |
| Ebisu v2 | Bayesian update of half-life posterior | YES | open-spaced-repetition/ebisu | Bayesian SR |
| DASH | multi-factor (Difficulty × Ability × Study History) | YES | research / FSRS | open-spaced-repetition/srs-benchmark |
| Power-law (Wickelgren 1974, neural MLP fits) | `R = (1 + t)^(-β)` | empirically observed | research only | arXiv:2506.12034 (snapshot: 51279b19af2f) |

**Why exponential over power-law for TheMemory v0.4b:**

1. **Production precedent at scale** — HLR is the form Duolingo ships across billions of learner sessions. arXiv:2506.12034 notes empirical fit may favor power-law on neural-network retention, but does not propose a production system with locked constants. For TheMemory v0.4b's first iteration, the form Duolingo runs in production is the safer commodity.
2. **Composability with LRU/LFU** — exponential `p = 2^(-Δ/h)` plays cleanly with per-row `last_accessed_at` (plan D5): `Δ = now() - last_accessed_at`. Power-law `(1+t)^(-β)` introduces an extra parameter and shape complexity not justified by current evidence.
3. **Tunable per-row half-life** — `h` becomes a derived field of the LLM-importance score (high importance ⇒ longer half-life). This connects D3's triadic signal: importance INPUT → `h` ⇒ time-decay component.

**Recommended starting constants for TheMemory v0.4b (lock by `/to-plan` per F-tbd-thresholds):**

| Constant | Recommended default | Rationale |
|---|---|---|
| `h_base` | 30 days | Mid-range between Duolingo's 9-month cap and short-term session retention; calibrate per recall@10 evaluation in /implement |
| `h_factor_high_importance` | 3× (= 90 days) | High-importance memories decay slower |
| `h_factor_low_importance` | 0.1× (= 3 days) | Low-importance memories decay fast — counts as "vacation memory" |
| `MAX_HALF_LIFE_CAP` | 365 days | Avoid runaway "never forgets" memories; cap matches Duolingo's neighborhood |
| `recency_score(memory)` | `2^(- (now − last_accessed_at) / h(memory))` | The per-memory recency component of triadic signal |

These are **starting defaults**, not locked v0.4b thresholds. CLAUDE.md Item 6 acceptance has `TBD (lock by v0.4b kickoff)` for `recall@10`; this v0.4b discovery blueprint surfaces the constants; the implementation plan `/to-plan v0-4b-forgetting-pipeline` locks them per F-tbd-thresholds.

### Cache eviction literature — LRU/LFU/LIRS/ARC/2Q + long-tail preservation (Q8)

**Sources synthesized (snapshot per arXiv allowlisted source):**

- arXiv:1512.00727 — TinyLFU: A Highly Efficient Cache Admission Policy (Einziger, Friedman, Manes 2015) — snapshot: 22657fd669ef
- Cross-referenced via WebSearch synthesis (single SE call) — arXiv:2511.21235 (DynamicAdaptiveClimb); arXiv:2508.12485 (Cold-RL); arXiv:2109.03021; arXiv:2203.04803 (limited-associativity)

**Algorithm comparison matrix:**

| Algorithm | Class | Long-tail preservation | Adaptation to shifting workload | Fits TheMemory triadic? |
|---|---|---|---|---|
| LRU | recency only | NO — unprotected; one-hit wonders pollute | NO — static rule | partial (covers recency dimension only) |
| LFU | frequency only | partial (preserves frequent) | NO — staleness on shift | partial (covers frequency dimension only) |
| LIRS | reuse-distance | better than LRU — distinguishes one-hit-wonders from repeat-use | partial | partial (sophisticated recency only) |
| ARC | hybrid (R+F via ghost lists) | partial via ghost lists | YES — adapts ratio between R and F | promising shape (hybrid score is the right intuition) |
| 2Q | two-queue (admit-on-2nd-hit) | filters singletons → favors repeat-use items | partial | partial (good admission heuristic) |
| TinyLFU / W-TinyLFU | admission-policy + small LRU window | window = "second chance"; freq filter can OVER-reject rare items on dynamic workloads (CDN traces showed worse than LRU/2Q) | partial | NO — admission boundary doesn't map to TheMemory's all-admitted shape |
| DynamicAdaptiveClimb | adaptive resizing | per arXiv:2511.21235 abstract | YES | research only |
| Cold-RL | offline RL learned eviction | per arXiv:2508.12485 | YES (data-driven) | NOT YET production-ready; defer |

**Long-tail preservation verdict (Q8 deliverable):**

> Pure LRU and pure LFU offer ZERO protection against long-tail bias. W-TinyLFU's window-cache "second chance" is the closest cache-literature analog to a long-tail protection mechanism, but it operates at the ADMISSION boundary — i.e., decides what gets INTO the cache. TheMemory's domain is different: every memory is INTENTIONALLY admitted (the user called `remember`); eviction decides who STAYS. The right mental model for TheMemory v0.4b is therefore NOT to import a cache algorithm wholesale, but to combine the SCORING intuition (recency + frequency + importance ≈ ARC's hybrid R+F + LLM's importance dimension) with a long-tail PROTECTION MULTIPLIER (per plan D4) applied at scoring time. This combines the best of LIRS (reuse-distance for long-term value) + ARC (hybrid scoring) + a novel multiplier (no cache lit precedent).

**Reference projects on cache classification:**

- LRU: recency-based ✓ implemented in `lru-cache` (npm — rejected for layer reasons per Q2)
- LFU: frequency-based — no pure LFU in npm candidates evaluated
- ARC: hybrid — no Node-side production lib (ARC is mostly in Java/C++ caches like Caffeine + Redis)
- W-TinyLFU: hybrid + admission — present in Caffeine (Java) + moka-rs (Rust); no canonical Node-side production library

**Implications for TheMemory v0.4b's `TriadicScoringPolicy`:**

```
score(memory) = w_recency * recency_component(memory)
              + w_frequency * frequency_component(memory)
              + w_importance * importance_component(memory)
```

Where:
- `recency_component = 1 - 2^(- (now − last_accessed_at) / h)` (HLR-derived; high score = recently accessed)
- `frequency_component = ln(1 + access_count)` (LFU smoothed)
- `importance_component = llm_importance_score` (REUSED from v0.4a ADR D5/D11)

Eviction selects the LOWEST scores (analog: LRU evicts least-recent). The long-tail multiplier (D4) multiplies eviction-score by a protection factor `< 1` for rare-but-isolated memories:

```
eviction_score(memory) = score(memory) × protection_multiplier(memory)
                       where protection_multiplier ≈ semantic_isolation(memory) / mean_isolation
                       capped at [0.1, 1.0]
```

This composition is novel; cache literature lacks a direct analog. TheMemory v0.4b ships it as ONE `TriadicScoringPolicy` implementation behind the `EvictionPolicy` DIP.

---

## Cross-cutting Comparison

| Dimension | Letta | Mem0 OSS | LangMem | TheMemory v0.4b proposal |
|---|---|---|---|---|
| Forget primitive | `delete_*` (9 variants, caller-driven physical delete) | `delete` / `delete_all` (caller-driven physical delete) | None explicit; invalidation only via Memory Manager pipeline | `Memory.forget(id)` (v0.1) + automatic via `EvictionPolicy` DIP |
| Automated eviction | NO (only caller-invoked) | NO (only caller-invoked; hosted SaaS adds server-side quota) | LLM-driven invalidation within consolidation pass (cron-scheduled); not score-driven | YES — triadic-scored, capacity- OR time-threshold-triggered |
| Triadic scoring | NO | NO | Mentioned conceptually ("strength = recently/frequently used"); no equation | Ebbinghaus exponential (`p = 2^(-Δ/h)`) + LRU/LFU (`last_accessed_at` + `access_count`) + LLM-importance (REUSED from v0.4a) |
| Long-tail guardrail | NO | NO | NO mention | Protection multiplier on eviction-score (plan D4); novel — no cache-lit analog at scoring boundary |
| Soft vs physical delete | Physical (`hard_delete_async`) + TPUF dual-delete | Physical (`vector_store.delete`) + entity-store cleanup | Implicit ("invalidate") — unclear semantics | Soft via `t_invalid` (plan D6); reuses v0.1 bi-temporal schema |
| Eviction algorithm class | n/a (no algorithm) | n/a (no algorithm) | n/a (LLM judgment in consolidation, not eviction) | Hybrid-additive (ARC family) with importance dimension + long-tail multiplier (novel composition) |

## ADRs

Decisions that emerge from the synthesis. Each has rationale + alternatives + consequences. ADRs D1-D6 live in the discovery plan v1.1; ADRs D7-D11 below are introduced by this blueprint.

### D7 — Adopt Half-Life Regression (HLR) exponential form for time decay

**Decision:** TheMemory's recency component uses `recency_component = 2^(-Δ/h)` (Settles & Meeder, Duolingo ACL 2016), with per-memory half-life `h` derived from `llm_importance_score`.

**Rationale:** Production-proven at Duolingo scale (snapshot a09f86dc871b). Exponential form pairs cleanly with `last_accessed_at` (plan D5) — `Δ = now() − last_accessed_at`. `h` becomes a tunable derived field that connects D3's triadic signal: high importance → longer half-life → slower decay.

**Alternatives considered:**

- (A) Power-law decay `(1+t)^(-β)` — REJECTED. arXiv:2506.12034 (snapshot 51279b19af2f) reports better empirical fit on MLP retention, but no production system locks specific constants; pure exponential simpler + Duolingo-proven.
- (B) SuperMemo SM-2 (Anki) ease-factor model — REJECTED. Deterministic interval-multiplier algorithm; non-trivial state machine (intervals, ease factors, repetitions per card) doesn't fit a single per-row score.
- (C) Ebisu v2 Bayesian update — DEFER to v0.5+. Computationally heavier; over-engineered for v0.4b's commodity goal.
- (D) Selected: HLR exponential.

**Consequences:**

- One additional column needed at write time: `half_life_seconds INTEGER` (derived from `llm_importance_score` at write). Adds to plan D5's schema migration.
- `recency_component` is bounded [0, 1] by design — composable with other [0, 1]-normalized components.
- `h_base = 30 days` is the starting default (locked at `/to-plan` per F-tbd-thresholds).

### D8 — Use ADDITIVE weighted sum for triadic scoring (NOT multiplicative)

**Decision:** `score(memory) = w_r·recency + w_f·frequency + w_i·importance`, weights normalized so that `w_r + w_f + w_i = 1`. NOT multiplicative `recency × frequency × importance` à la Generative Agents (Park et al. 2023).

**Rationale:** Three sources confirm additive is the right choice for memory systems:

1. v0.4a's blueprint (companion file, SHIPPABLE_WITH_CAVEATS) already chose ADDITIVE for `AdditiveWeightedScoring` per Q7 finding that Generative Agents reference impl uses `gw = [0.5, 3, 2]` ADDITIVE weighted sum at `retrieve.py:254-257`. v0.4b mirrors the same shape — consistency across reflection (v0.4a) and forgetting (v0.4b).
2. Multiplicative composition has the "any-component-zero kills the score" pathology: a brand-new memory (recency=1, frequency=0 because access_count=0) would have score=0 multiplicatively, evicting itself immediately. Additive avoids this.
3. Letta + Mem0 do NOT have any scoring at all (Q3/Q4/Q5), so no precedent — we choose based on first principles.

**Alternatives considered:**

- (A) Multiplicative (Generative Agents-style) — REJECTED for the pathology above + CLAUDE.md correction (the "multiplicative Generative Agents" attribution there is incorrect per v0.4a Q7 finding; the reference impl is ADDITIVE).
- (B) Geometric mean — REJECTED (also suffers from any-zero-kills-everything pathology).
- (C) Selected: additive weighted sum.

**Consequences:**

- One `ScoringStrategy` DIP, shared between v0.4a (reflection scoring) and v0.4b (eviction scoring) — same shape, different weights at runtime.
- Default weights `w_r = 0.4, w_f = 0.2, w_i = 0.4` (recency + importance dominate; frequency tie-breaker). Lock at `/to-plan` per F-tbd-thresholds.

### D9 — Long-tail protection multiplier formula: `min(1, isolation_distance / mean_isolation_distance) capped to [0.1, 1.0]`

**Decision:** The protection multiplier (plan D4) is computed as `protection = clamp(0.1, 1.0, isolation_distance / mean_isolation_distance)` where `isolation_distance = cosine_distance(memory, nearest_neighbor_within_scope)`. Multiplier applied to eviction_score AFTER the additive triadic combination.

**Rationale:**

- Q8 shows no cache-lit precedent for in-store score multipliers — TheMemory invents this primitive cleanly. The shape `isolation_distance / mean_isolation_distance` is normalized by the scope's mean, so rarity is measured relative to peers (not absolute).
- The `[0.1, 1.0]` clamp is "honest design": even the rarest memory gets at minimum a 10× protection signal (multiplier 0.1 = lower eviction-score = stays longer); even the most clustered memory gets multiplier 1.0 (no penalty).
- pgvector + Drizzle already support `<#>` cosine-distance operator — `nearest_neighbor_within_scope` is a 1-line SQL query per memory at scoring time. No new index needed.

**Alternatives considered:**

- (A) Exponential protection `exp(isolation_distance × k)` — REJECTED (unbounded; harder to tune; no upper safety bound).
- (B) Sigmoid `1 / (1 + exp(-α × (isolation − threshold)))` — REJECTED (3 hyperparameters vs 1 default; over-engineered for v0.4b commodity).
- (C) Selected: linear clamp.

**Consequences:**

- One additional SQL call per memory at eviction-scoring time (nearest-neighbor lookup). For a 1000-memory scope, this is 1000 × O(log N) = ≈10ms total with pgvector HNSW.
- For the v0.4b acceptance test (1000 memories with 50 rare-query targets), the multiplier MUST be parameterizable so the test can verify `rare memory survives ≥ 5 consecutive eviction passes` (a value of protection=0.1 against frequent siblings at protection=1.0 is ~10× score advantage — sufficient).

### D10 — Eviction trigger: BOTH capacity-based AND time-based (composable; defaults pick capacity)

**Decision:** The `EvictionPolicy` DIP exposes two trigger modes selectable at construction time:

1. `CapacityBasedTrigger({ maxMemoriesPerScope: number })` — fires when `count(memories WHERE scope) > maxMemoriesPerScope` on `remember()`. Default mode.
2. `TimeBasedTrigger({ cronExpression: string, lookbackWindow: seconds })` — fires on cron schedule via `croner` (REUSED from v0.4a's `SleepTimeReflectionPolicy` infrastructure).

Either mode evicts the `N` lowest-eviction-score memories where `N` is computed to bring count back below threshold (capacity mode) OR to evict 30% of stale memories (time mode, matching CLAUDE.md Item 6 acceptance's "30% removal" phrasing).

**Rationale:**

- Mem0 has no automated trigger (Q5); Letta has no automated trigger (Q3); LangMem uses cron only (Q6). TheMemory composes BOTH — capacity for foreground responsiveness, time for background hygiene.
- Reuses v0.4a's `croner` dep — no new dep introduced.
- Composability: a single scope can configure both triggers; capacity fires opportunistically on writes, time fires periodically as cleanup.

**Alternatives considered:**

- (A) Capacity-only — REJECTED (write-heavy scope grows unboundedly between writes; no cleanup mechanism).
- (B) Time-only — REJECTED (Mem0's hosted quota model; doesn't bound runtime memory size on local).
- (C) Threshold-based (fire after N new memories cross) — DEFER to v0.5 (over-engineering for v0.4b).
- (D) Selected: capacity + time composable.

**Consequences:**

- Test pyramid grows: each trigger mode needs its own integration test fixture.
- Configuration surface grows by 2 constructors. Manageable; both have sane defaults.

### D11 — Test pyramid for v0.4b: unit (scoring math) + integration (recall@10 on real pgvector)

**Decision:** Three-tier test pyramid for v0.4b:

1. **Unit tier** — vitest tests for `TriadicScoringPolicy`'s scoring math (`recency_component`, `frequency_component`, `importance_component`, `protection_multiplier`). Pure math, stub LLM, in-memory adapter. Targets: bounded outputs, clamping invariants, weight-normalization checks, deterministic.
2. **Unit tier — guardrail edge case** — explicit test seeding (a) rare-isolated memory + (b) 100 frequent-cluster siblings; asserts `rare survives ≥ 5 consecutive LRU eviction passes` (verbatim CLAUDE.md Item 6 acceptance).
3. **Integration tier** — vitest tests against real `ankane/pgvector:v0.5.1` Docker container (REUSED v0.1 fixture). Seed 1000 memories with 50 rare-query targets; trigger 30% eviction by triadic score; assert `recall@10 ≥ X%` on rare-query set (X = threshold locked at `/to-plan` per F-tbd-thresholds).
4. **Evaluation artifact** — `docs/forgetting-evaluation.md` (CLAUDE.md Item 6 acceptance requires it). Reproducible script under `docs/forgetting-evaluation/run.ts`; runs the 1000-memory seed in CI; commits the matrix as part of the implementation.

**Rationale:**

- Mirrors `testing.md § Pyramid` (unit dominant + few integration + 1 E2E).
- Letta's INSERT-only stress test (Q1) is NOT applicable as precedent; greenfield test design.
- Letta's session-scoped server fixture pattern (Q1 finding) IS borrowable for the integration tier's pgvector container.

**Alternatives considered:**

- (A) Integration-only — REJECTED (slow feedback loop; can't unit-test scoring math).
- (B) Unit-only — REJECTED (CLAUDE.md acceptance explicitly requires `recall@10` against curated seed set; only integration tier can verify).
- (C) Selected: 3-tier pyramid.

**Consequences:**

- `docs/forgetting-evaluation.md` becomes a deliverable in `/implement` of v0.4b.
- Integration tests will run in CI; latency budget must account for 1000-memory seed (estimate: 60-90s, comparable to v0.1 + v0.4a).

## Recommendations for TheMemory

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Add `EvictionPolicy` DIP at `src/core/dip/eviction-policy.ts` mirroring `ReflectionPolicy` shape | Plan D3, ADR D7-D11 | HIGH |
| 2 | Ship one `TriadicScoringPolicy` implementation in `src/local/eviction/triadic-scoring-policy.ts` parameterized by weights + half-life base | ADR D7, D8 | HIGH |
| 3 | Migration: add `last_accessed_at TIMESTAMPTZ`, `access_count INTEGER NOT NULL DEFAULT 0`, `half_life_seconds INTEGER` columns on `memories` | Plan D5, ADR D7 | HIGH |
| 4 | Wire `last_accessed_at` + `access_count` update on every `recall()` row hit (single UPDATE batched) | Plan D5 | HIGH |
| 5 | Implement `protection_multiplier` via pgvector cosine-distance nearest-neighbor query per memory at scoring time | ADR D9 | HIGH |
| 6 | Ship two `EvictionTrigger` implementations: `CapacityBasedTrigger` + `TimeBasedTrigger` (REUSES `croner` from v0.4a) | ADR D10 | HIGH |
| 7 | Forget = soft-delete via `t_invalid = NOW()`; physical GC pass deferred to v0.5+ | Plan D6 | HIGH |
| 8 | Test pyramid per ADR D11: unit (scoring math) + unit (guardrail) + integration (recall@10) + evaluation doc | ADR D11, testing.md | HIGH |
| 9 | Default weights at construction: `w_r=0.4, w_f=0.2, w_i=0.4`; `h_base=30d`; `MAX_HALF_LIFE_CAP=365d`; `protection_clamp=[0.1, 1.0]` | ADR D7, D8, D9, F-tbd-thresholds | MEDIUM (lock at /to-plan) |
| 10 | Do NOT adopt `lru-cache`, `quick-lru`, or `keyv` — wrong abstraction layer per Q2 Rule 9 verdict; in-house 30-LoC scorer is more KISS | Q2 verdicts, Rule 9 | HIGH (negative recommendation) |
| 11 | Honor v0.4a's `llm_importance_score` cache via content-hash key; eviction MUST NOT re-invoke LLM at scoring time | v0.4a ADR D11 | HIGH |

## Blocked questions (if any)

None — all 8 questions answered with citations + snapshots. EC-3 candidates `node-cache` is informational F-followup per discovery plan v1.1 — not blocked, deferred by design.

## Halt-loop progress (audit trail)

- Iterations used: 1 / 30 (this iteration synthesized all 8 questions within a single Claude turn; ralph-loop's Stop hook did NOT need to fire — answers and citations are present + verified before promise)
- Questions answered: 8 / 8 (Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8 all `done`)
- Questions blocked: 0
- Citations verified: see § Citation verification below
- Snapshots written: 6 (lru-cache 8dedad35a953, quick-lru 22ed91fa170b, keyv cd0e49d7f209, langmem 7029cffc263a, arxiv 2506.12034 51279b19af2f, hlr duolingo a09f86dc871b, tinylfu arxiv 22657fd669ef)
- WebSearch calls used: 3 / 15 cap (langmem + ebbinghaus/anki + cache eviction)
- WebFetch calls used: 7 / 25 cap (lru-cache + quick-lru + keyv + langmem + 2 arxiv + duolingo)
- Promise emitted at iteration: 1 (after all 8 questions populated, all citations verified, 5 corners populated, 5 ADRs added).

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-4b-forgetting-pipeline-plan.md` (v1.1)
- Edge-case review: `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-edge-cases-2026-05-26.md`
- Confidence report: `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-confidence-{YYYY-MM-DD}.md` (generated by `/discover-confidence`)
- Companion blueprint (shape reference + LLM-importance column reused): `.claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89/100)
- Architecture rules consumed: `.claude/rules/architecture.md § 3` (DIP), `§ 2` (ADD-only soft-delete via `t_invalid`)
- Testing rule consumed: `.claude/rules/testing.md § Pyramid`
- Cycle rule: `.claude/rules/cycle-discover.md` (v1.1 — 5-corner coverage with prior_art)
- Roadmap entry: CLAUDE.md § Macro roadmap Item 6 (OPEN PROBLEM #1)
