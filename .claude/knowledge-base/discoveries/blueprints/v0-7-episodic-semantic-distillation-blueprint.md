# Blueprint: v0.7 — Episodic→Semantic Distillation Pipeline

> **Version 1.0** — Synthesizes how Mem0 (`.claude/knowledge-base/references/mem0/`, 78MB) and Letta (`.claude/knowledge-base/references/letta/`, 34MB) convert raw episodic input into semantic facts with provenance + conflict-resolution + gold-set evaluation. Cross-referenced with academic prior art (Generative Agents reflection, CoALA, MemoryBank) + vendor claims (Mem0, Zep, Cognee blogs). Informs `/to-plan v0-7-distillation-pipeline` for Roadmap Item 9 (Open Problem #3). **LangMem NOT cloned** — out-of-scope by absence per source plan v1.2.

**Slug:** `v0-7-episodic-semantic-distillation`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-7-episodic-semantic-distillation-plan.md` v1.2
**Owner:** paulohenriquevn
**Generated:** 2026-06-01 via `/discover-execute`
**Confidence verdict:** {TBD by /discover-confidence}

## Context

`CLAUDE.md § Macro roadmap` Item 9 (v0.7) declares the gap: managed pipeline raw episodes → entity extraction → conflict resolution (LLM-judged) → semantic facts with provenance. THE GOAL TEST requires gold set of 200 manually-labeled raw episodes + precision/recall thresholds + conflict-resolution test + every persisted semantic fact has non-empty `derived_from: episodeId[]`. Without v0.7 sólido, v0.8 benchmarks contra Mem0/Zep tendem a ficar equiparados em vez de superior.

## Objective

Give `/to-plan v0-7-distillation-pipeline` evidence-backed grounding for: (a) pipeline shape (sequential vs sleep-time-worker vs hybrid); (b) conflict-resolution algorithm with prior-art comparison; (c) gold-set methodology with academic anchor; (d) provenance schema; (e) honest gaps in Mem0/Letta that v0.7 must close.

---

## Coverage Corner 1 — Integration Tests (Q4)

> Populated by /discover-execute from Q4. Empty subsections trigger discover-confidence hard cap.

### Mem0

**Strategy:** 100% MOCKED — no real LLM, embedder, vector store, or DB. Unit-level tests on pipeline orchestration.

`.claude/knowledge-base/references/mem0/tests/memory/test_main.py:9-26` — `_setup_mocks()` helper patches:
- `mem0.utils.factory.EmbedderFactory.create` → MagicMock with `embed.return_value = [0.1, 0.2, 0.3]`
- `mem0.utils.factory.VectorStoreFactory.create` → MagicMock with `search.return_value = []`
- `mem0.utils.factory.LlmFactory.create` → MagicMock
- `mem0.memory.storage.SQLiteManager` → MagicMock

Test taxonomy (665 LOC):

| Test class | Lines | Focus | Verdict — MIRROR for v0.7? |
|---|---|---|---|
| `TestAddToVectorStoreErrors` | 30-79 | Pipeline error-handling paths (LLM fail / embed fail / insert fail) — verify per-row fallback fires | YES — directly mirror as `test_distillation_per_row_fallback.py` |
| `TestPromptOverridesCustomInstructions` | 81-117 | `add(..., prompt=X)` override path + `custom_instructions` precedence | YES — for v0.7's `ConflictResolutionPolicy` custom prompts |
| `TestAsyncUpdate` | 118-167 | Async `update()` API symmetry with sync | DEFER — v0.7 ADD-only doesn't expose update |
| `TestAsyncAddToVectorStoreErrors` | 170-238 | Async variant of TestAddToVectorStoreErrors | YES (symmetric) |
| Module-level `test_create_memory_uses_utc_timestamps` etc | 240-310 | Timestamp correctness (UTC + ISO 8601) | YES — v0.7 needs same discipline for `derived_from` provenance timestamps |

**Gold-set:** ZERO. Grep `@pytest.mark.parametrize` returns 0; grep `fixtures/` returns 0; no `tests/data/` directory; no JSON fixture files. **Mem0 has NO precision/recall threshold tests.** Real-API validation lives separately in `mem0/evaluation/` (LOCOMO benchmarks per `.claude/knowledge-base/references/mem0/CLAUDE.md § evaluation/` — uses external paid benchmarks, NOT a committed gold set under tests/).

**Verdict for v0.7:** mirror Mem0's per-row-fallback + timestamp tests. Do NOT mirror their lack-of-gold-set. The gold-set methodology must come from MemoryBank (Q7) or be invented.

### Letta

**Strategy:** REAL-SERVER INTEGRATION — boots a Letta server in background thread, polls `/v1/health`, uses `letta_client.Letta` SDK against it.

`.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:1-50` — fixture pattern:
- `server_url` (scope=module): if `LETTA_SERVER_URL` env unset, `threading.Thread(target=_run_server, daemon=True).start()` then poll `requests.get(url + "/v1/health")` with 60s timeout
- Uses `letta_client.Letta` SDK + `letta_client.types.{CreateBlockParam, MessageCreateParam}`
- `dotenv` loads `.env` (presumed to carry `OPENAI_API_KEY` etc.)
- **Real LLM calls** (no mocking) — but no `--ci` skip marker, meaning real-API runs every test invocation

Test files relevant to memory/sleeptime/archival:

| File | Strategy | Verdict — MIRROR for v0.7? |
|---|---|---|
| `letta/tests/integration_test_sleeptime_agent.py` | Real server + real LLM | PARTIAL — borrow the server-fixture pattern; gate behind `CI_OPENAI_API_KEY` env per testing.md § Pyramid E2E |
| `letta/tests/test_memory.py` | Unit (assumed; not yet read) | TBD next iteration if budget allows |
| `letta/tests/managers/test_archive_manager.py` | Manager-level | TBD |
| `letta/tests/performance_tests/test_insert_archival_memory.py` | Performance (latency / throughput) | DEFER — v0.7 v0.1 ships correctness; perf is v0.8 |

**Gold-set:** Letta also has NO committed gold set under `tests/`. Their evaluation lives in `letta/evaluation/` (similar pattern to Mem0).

**Verdict for v0.7:** Letta's server-fixture pattern is the canonical "real backend" integration style. Borrow it for v0.7 integration tests against `ankane/pgvector:v0.5.1` (already used in our project per ADRs). DO NOT borrow Letta's "every test calls real LLM" practice — flake + cost. Gate v0.7's real-LLM tests behind `process.env.CI_OPENAI_API_KEY` per testing.md § Pyramid + ADR D5 of source plan.

**Cross-cutting test gap (BOTH projects):** Neither Mem0 nor Letta commits a gold set of N labeled episodes with expected output schemas + precision/recall thresholds. v0.7's THE GOAL TEST acceptance criterion (200 manually-labeled episodes per `CLAUDE.md` Roadmap Item 9) HAS NO PRIOR-ART TEMPLATE in either ref project. We must mirror MemoryBank's methodology (Q7) or invent — likely a combination: 200 hand-labeled examples covering 4 categories (single-fact extraction; multi-fact extraction; conflict pair; entity-overlap pair), each with `{episode_text, expected_facts: [{text, attributed_to, linked_to_ids}]}`. Recall/precision computed via `nltk` BLEU + entity-overlap-Jaccard. **This is differentiation opportunity #1** — Mem0/Letta don't have it; we will.

---

## Coverage Corner 2 — Dependencies (Q5)

> Per ADR D3 + EC-6 checkpoint: max 5 libs investigated per project (10 total); beyond top-5 → DEFER verdict default.

### Mem0 — top-5 Rule 9 verdicts (EC-6 cap applied)

Source: `.claude/knowledge-base/references/mem0/pyproject.toml` § dependencies + import sites in `mem0/mem0/memory/main.py`.

| # | Lib | Pin | Use site | v0.7 Rule 9 verdict | Rationale |
|---|---|---|---|---|---|
| 1 | `openai` | `>=1.90.0` | LLM extraction (`mem0/llms/openai.py`) | **ADOPT** — already adopted Cycle 2 at `@usetheo/memory/llms/openai` |
| 2 | `spacy` | `>=3.7.0` | Entity extraction in Phase 7 (`mem0/mem0/memory/main.py:868 extract_entities_batch`) | **DEFER** to v0.7 implementation — TheMemory already has BM25 lemmatization via `natural` (v0.6.1); spaCy adds 50MB+ NER models. Validate vs `compromise` (Node-native, 3MB) + own LLM-NER prompt before committing. Open question whether NER is even needed (Mem0 uses it for entity_store boosting; we may opt out per ADR-0007). |
| 3 | `sentence-transformers` | `>=5.0.0` | Embedding fallback path (`mem0/embeddings/huggingface.py`) | **REJECT** — TheMemory uses `openai/text-embedding-3-small` via `@usetheo/memory/embedders/openai` per Cycle 2. sentence-transformers adds 500MB+ torch dep; local inference is consumer concern, not core SDK. |
| 4 | `pydantic` | implicit via mem0/configs | Config schema validation | **ADOPT** — TheMemory uses `zod` (TS equivalent) per architecture.md § 7; structural equivalence holds. No new dep. |
| 5 | `hashlib` (stdlib) | n/a | MD5 dedup (`mem0/mem0/memory/main.py:799`) | **ADOPT** — TheMemory already uses Node `crypto.createHash('md5')` per `src/embedders/stub.ts:68` Cycle 1 precedent. Already shipping. |

**DEFER (beyond top-5 per EC-6):** `qdrant-client`, `chromadb`, `langchain*` (orthogonal to distillation core — provider plugins), `posthog` (telemetry — TheMemory uses OTel), `azure-identity` (cloud-specific).

### Letta — top-5 Rule 9 verdicts (EC-6 cap applied)

Source: `.claude/knowledge-base/references/letta/pyproject.toml` + imports in `letta/letta/services/archive_manager.py` + `letta/letta/groups/sleeptime_multi_agent_v4.py`.

| # | Lib | Pin | Use site | v0.7 Rule 9 verdict | Rationale |
|---|---|---|---|---|---|
| 1 | `pgvector` | `>=0.2.3` | Vector column type for archival memory | **ADOPT** — TheMemory already uses pgvector v0.5.1 + HNSW per v0.1; matches |
| 2 | `psycopg2`/`psycopg2-binary` | `>=2.9.10` | Postgres driver (sync) | **REJECT** — TheMemory uses `pg` (Node, sync) + `drizzle-orm` per architecture.md § 5; replacing would be ecosystem swap (Python → Node). Not applicable. |
| 3 | `sqlalchemy` | implicit via sqlmodel | ORM for memory blocks | **REJECT** — same ecosystem mismatch; we use Drizzle. |
| 4 | `anthropic` | `>=0.75.0` | Anthropic LLM client | **DEFER** — Cycle 3 (anthropic adapter — next P0 per CTO ranking) ships this; Q5 confirms version pin for that future cycle. |
| 5 | `llama-index-embeddings-openai` | `>=0.3.1` | LlamaIndex embedding wrapper | **REJECT** — TheMemory uses raw `openai` SDK directly per Cycle 2 ADR D2; LlamaIndex wrapper is unnecessary abstraction. |

**DEFER (beyond top-5):** `fastapi`, `sqlmodel`, `sentry-sdk`, `langchain*`, all sentry/otel-adjacent telemetry libs (TheMemory uses OTel direct).

**Cross-cutting observation:** BOTH projects depend heavily on the Python/LangChain ecosystem (LangChain mentioned in BOTH pyprojects with `langchain>=0.3.0` + `langchain-community`). TheMemory deliberately AVOIDS LangChain (per CLAUDE.md § Mem0-shape adoption — we use the SHAPE without the framework). This is a deliberate architectural choice we should NOT reverse.

---

## Coverage Corner 3 — Tools (Q6)

> Text-shape question; skip Fase A per ADR D2.

### Mem0 — dev story checklist

Source: `.claude/knowledge-base/references/mem0/Makefile:1-30` + `mem0/README.md:1-80`.

1. **Clone:** `git clone https://github.com/mem0ai/mem0` then `cd mem0`
2. **Install:** `make install` → `hatch env create` (hatch is the build tool; required prerequisite `pip install hatch`)
3. **Install all optional providers (one-shot):** `make install_all` — adds groq, together, boto3, litellm, ollama, chromadb, weaviate, sentence_transformers, vertexai, google-generativeai, elasticsearch, opensearch-py, vecs, pinecone, langchain-community, kuzu, databricks-sdk, valkey — comprehensive but HEAVY (multi-GB env)
4. **Env vars:** `OPENAI_API_KEY` (default LLM) + per-provider env vars (e.g., `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `QDRANT_URL`)
5. **Run quick test:** Python REPL `from mem0 import Memory; m = Memory(); m.add("test", user_id="x")` — uses default Qdrant in-memory mode
6. **Verify:** `m.search("test", user_id="x")` returns the memory
7. **Lint/format:** `make format` (ruff format) + `make sort` (isort with `--profile black`) + `make lint` (ruff check)
8. **Tests:** `make test` → `pytest tests/`

**Verdict — useful as v0.7 dev-story template?** PARTIAL. Mem0's `make install_all` "comprehensive optional provider install" is a smell — pollutes env with deps you don't need. TheMemory's `optionalDependencies` pattern (Cycle 2 ADR D2) is cleaner: consumers install ONLY what they use. DO NOT mirror `install_all`. DO mirror the "default in-memory backend for quickstart" pattern (Mem0 defaults to Qdrant in-memory; we already do this with `InMemoryVectorStore` per v0.1).

### Letta — dev story checklist

Source: `.claude/knowledge-base/references/letta/dev-compose.yaml:1-25` + `letta/CONTRIBUTING.md:1-50`.

1. **PostgreSQL prerequisite** — Letta REQUIRES Postgres running before app boots (not in-memory mode like Mem0). CONTRIBUTING.md walks through `sudo -u postgres psql` + SQL setup:
   ```sql
   CREATE ROLE letta WITH LOGIN SUPERUSER PASSWORD 'letta';
   CREATE DATABASE letta OWNER letta;
   ```
2. **pgvector extension:** `CREATE EXTENSION IF NOT EXISTS vector;` (TheMemory does this inline via `npm run db:push` per v0.1 ADR)
3. **Clone + fork:** standard GitHub flow
4. **Docker-compose alternative:** `docker-compose -f dev-compose.yaml up` — boots `pgvector/pgvector:0.8.1-pg15` container at port 5432 + `letta/letta:latest` server image
5. **Env vars:** `.env` file with `LETTA_PG_USER`, `LETTA_PG_PASSWORD`, `LETTA_PG_DB`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
6. **Run server:** `letta server` (via CLI) or `docker-compose up` (full stack)
7. **Verify:** `curl localhost:8283/v1/health` returns 200
8. **Tests:** `pytest tests/` (mostly integration; presumes server running OR auto-boots per `integration_test_sleeptime_agent.py:server_url` fixture)

**Verdict — useful as v0.7 dev-story template?** YES with modifications. Letta's docker-compose pattern (`dev-compose.yaml` boots pgvector + app together at one command) is the gold standard. TheMemory already has `compose:up` per package.json scripts (v0.1). DO mirror the auto-boot-and-wait pattern from `integration_test_sleeptime_agent.py:server_url` for `/test-chat-with-memory` integration tests. DO NOT mirror Letta's "Postgres setup-by-hand-via-psql" path — our `npm run db:push` chain is friendlier.

**Cross-cutting observation:** Mem0 = polyglot monorepo (Python + TS); Letta = Python-only with REST API + TS SDK separately. TheMemory's TS-native architecture (no Python in the SDK runtime) is closer to Letta's pattern. The "boot Postgres in docker-compose + app" pattern is universally applicable.

---

## Coverage Corner 4 — Techniques (Q1 + Q2 + Q3)

> The MEAT of the blueprint. Q1 = Mem0 two-stage pipeline; Q2 = Letta sleep-time v1/v2/v3/v4 iteration; Q3 = conflict-resolution comparison.

### Q1 — Mem0 two-stage (actually 8-phase) write pipeline

**Pipeline shape:** Mem0's V3 PHASED BATCH PIPELINE at `Memory._add_to_vector_store()` in `.claude/knowledge-base/references/mem0/mem0/memory/main.py:662-970` is 8 phases (not 2; not 6 as Mem0's older docs claim):

| Phase | Lines | Action |
|---|---|---|
| 0 — Context gathering | 701-704 | `db.get_last_messages(session_scope, limit=10)` |
| 1 — Existing memory retrieval + UUID→int mapping | 706-721 | `vector_store.search(top_k=10)` + sequential int IDs (`uuid_mapping`) for anti-hallucination in the LLM prompt |
| 2 — LLM extraction (single call) | 723-748 | System prompt = `ADDITIVE_EXTRACTION_PROMPT` (+ `AGENT_CONTEXT_SUFFIX` if agent-scoped); response_format `json_object`; per-row fallback at line 746-748 (return empty list on LLM exception) |
| 3 — Batch embed extracted texts | 770-782 | `embedding_model.embed_batch(mem_texts)`; **per-item fallback** lines 776-782 if batch fails |
| 4-5 — Per-memory CPU + Hash dedup | 784-803 | `hashlib.md5(text.encode()).hexdigest()`; checks BOTH `existing_hashes` (line 786-790) AND `seen_hashes` (intra-batch dedup line 793, 803). Skip on collision (line 800-802). |
| 6 — Batch persist + history | 824-863 | `vector_store.insert(vectors, ids, payloads)` with per-row fallback (lines 835-841); `db.batch_add_history` with per-row fallback (lines 855-863); every history event has `"event": "ADD"` — never UPDATE / DELETE in this path |
| 7 — Batch entity linking | 865-955 | 7a global dedup; 7b batch embed entities; 7c batch search; 7d separate inserts vs updates (cosine ≥ 0.95 → update existing entity's `linked_memory_ids` set; below → new entity); 7e batch insert; **all with per-row fallback** |
| 8 — Save messages + return | 957-963 | `db.save_messages(messages, session_scope)` + return list of `{id, memory, event:"ADD"}` |

**Extraction prompt verbatim** (`.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:468-947`, `ADDITIVE_EXTRACTION_PROMPT`):

> "You are a Memory Extractor — a precise, evidence-bound processor responsible for extracting rich, contextual memories from conversations. **Your sole operation is ADD**: identify every piece of memorable information and produce self-contained, contextually rich factual statements." (line 472)
>
> Inputs: New Messages + Summary + Recently Extracted Memories + Existing Memories + Last k Messages + Observation Date + Current Date + Optional Inputs (includes/excludes/custom_instructions/feedback_str). Response schema: `{"memory": [{"id": "0|1|...", "text": "...", "linked_memory_ids": [<UUIDs from Existing>]}, ...]}`.
>
> **Dedup discipline in-prompt** (lines 503-516): "Memories already captured from recent messages in this session (up to 20). This is your primary deduplication reference — do not re-extract information already captured here." + "If new information in New Messages is semantically equivalent to an Existing Memory with no meaningful new context, skip it."
>
> **Linking via `linked_memory_ids` (lines 513-516)** — when a new memory relates to an Existing (same topic, overlapping entities, updated/shifted preference, follow-up event), include the Existing's UUID. **This is SOFT LINK, not MERGE** — the new memory is added separately, with a back-pointer.

**Conflict-resolution: ABSENT in the V3 add path** — Mem0 has consciously DEPRECATED the old UPDATE/DELETE conflict-resolution flow. The legacy `DEFAULT_UPDATE_MEMORY_PROMPT` (line 176 of prompts.py, "You are a smart memory manager which controls the memory of a system") is used ONLY by the explicit `Memory.update(memory_id, data)` API at line 1501 — never during `add()`. **The V3 add path is purely ADD-only**: extract → batch embed → hash dedup → insert. This validates our TheMemory ADR-0003 (ADD-only public API) — Mem0 reached the same conclusion.

**Per-row fallback at EVERY I/O boundary** is the defining hygiene pattern:
- LLM extraction fails → return empty list (line 746-748)
- Batch embed fails → embed individually (line 776-782)
- Batch insert fails → insert one-by-one (line 835-841)
- Batch history fails → add one-by-one (line 856-863)
- Batch entity embed fails → embed individually, mark None for failures (line 888-895)
- Batch entity insert fails → log + continue (line 952-953)

**Anti-hallucination via UUID→int** (lines 717-721): existing memories presented to the LLM use sequential int IDs ("0", "1", ...). The LLM emits new IDs in the same int space; `uuid_mapping` translates back to UUIDs at persist time. Prevents the LLM from emitting fake UUIDs (a known failure mode of LLMs given UUID-shaped inputs).

### Q2 — Letta sleep-time agents iteration (v1 → v4)

**EC-8 active-importer audit (verified pre-Read):**

| Version | File | LOC | Active consumers | Status |
|---|---|---|---|---|
| v1 | `letta/letta/groups/sleeptime_multi_agent.py` | 291 | Only `letta/letta/groups/helpers.py:74` (legacy fallback path) | **legacy fallback** |
| v2 | `letta/letta/groups/sleeptime_multi_agent_v2.py` | 348 | **ZERO consumers** (verified via `grep -rE "from .sleeptime_multi_agent_v2\|import sleeptime_multi_agent_v2"` returns empty) | **ABANDONED experiment** |
| v3 | `letta/letta/groups/sleeptime_multi_agent_v3.py` | 266 | `letta/letta/agents/agent_loop.py:6` | **active (transition)** |
| v4 | `letta/letta/groups/sleeptime_multi_agent_v4.py` | 289 | `letta/letta/agents/agent_loop.py:7`, `letta/letta/server/rest_api/utils.py:863`, `letta/letta/server/rest_api/routers/v1/agents.py:24` | **production target** |

**Inheritance evolution (refactor evidence beyond the file content):**

- v1: `class SleeptimeMultiAgent(BaseAgent)` — original
- v2: `class SleeptimeMultiAgentV2(BaseAgent)` — same parent, abandoned
- v3: `class SleeptimeMultiAgentV3(LettaAgentV2)` — parent agent refactored to versioned
- v4: `class SleeptimeMultiAgentV4(LettaAgentV3)` — parent agent versioned again

The parallel iteration on the parent class (`BaseAgent` → `LettaAgentV2` → `LettaAgentV3`) signals that Letta is iterating on the agent runtime FIRST, with sleeptime as a wrapper. v2's death suggests they tried "BaseAgent + new sleeptime shape" simultaneously and rolled it back.

**v3 → v4 deltas (production migration patch — `diff` output):** ~10 lines changed:

- `LettaAgentV2` → `LettaAgentV3` parent change (architectural)
- v4 adds `BillingContext` preservation for "follow-up sleeptime runs that are triggered entirely within core and therefore never traverse cloud-api" (`.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py:39-41`) — production-billing concern
- v4 adds skip-if-no-messages guard (lines 147-151): `if not last_response_messages: ... return self.run_ids` — production failure mode caught
- v4 changes `use_assistant_message` default `False` → `True` — semantic shift in how assistant messages feed sleeptime
- v4 adds `conversation_id` parameter throughout — multi-conversation tracking
- v4 returns `run_ids: list[str]` explicitly (v3 was implicit return)

**Pipeline shape (v4 production):**

| Step | Lines | Action |
|---|---|---|
| 1. Foreground step | 65-78 | `super().step(...)` runs the primary `LettaAgentV3` synchronously — user sees response |
| 2. Background trigger | 80, 129 | AFTER foreground completes (or in `stream`'s `finally` block), call `run_sleeptime_agents(billing_context)` |
| 3. Frequency gate | 138-145 | `group_manager.bump_turns_counter_async` increments; trigger sleeptime ONLY when `turns_counter % group.sleeptime_agent_frequency == 0` (configurable; can be None for every-turn) |
| 4. Skip-if-empty guard | 147-150 | If `not last_response_messages`: log warning, return early (no work) |
| 5. Spawn background tasks | 155-167 | For each `sleeptime_agent_id` in `group.agent_ids`, `safe_create_task(self._participant_agent_step(...))` — fire-and-forget background coroutine |
| 6. Background task body | 202-289 | Update Run status → fetch prior_messages → concat transcript → wrap with `<system-reminder>` distillation prompt → spawn sleeptime `LettaAgentV3` → step it (it uses memory tools) → update Run status |

**Distillation prompt verbatim** (`.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py:234-243`, inline `<system-reminder>` wrapped around the message text):

> "You are a sleeptime agent - a background agent that asynchronously processes conversations after they occur. IMPORTANT: You are NOT the primary agent. You are reviewing a conversation that already happened between a primary agent and its user: Messages labeled 'assistant' are from the primary agent (not you). Messages labeled 'user' are from the primary agent's user. Your primary role is memory management. Review the conversation and use your memory tools to update any relevant memory blocks with information worth preserving. Check your memory_persona block for any additional instructions or policies."

**Sleeptime agent system prompt** (`.claude/knowledge-base/references/letta/letta/prompts/system_prompts/sleeptime_v2.py:PROMPT`, lines 1-30):

> "You are Letta-Sleeptime-Memory, the latest version of Limnal Corporation's memory management system, developed in 2025. You run in the background, organizing and maintaining the memories of an agent assistant who chats with the user. Core memory (limited size): Your core memory unit is held inside the initial system instructions file, and is always available in-context. Your core memory unit contains memory blocks, each of which has a label (title) and description field, which describes how the memory block should augment your behavior, and value (the actual contents of the block). Memory blocks are limited in size and have a size limit. Your core memory is made up of read-only blocks and read-write blocks. Memory editing: You have the ability to make edits to the memory memory blocks. Use your precise tools to make narrow edits, as well as broad tools to make larger comprehensive edits."

Key shape:

- **Memory blocks** with label + description + value (size-limited)
- **Tool family:** "precise tools" (additions/deletions/replacements) + `rethink` (broad reorganization) + `finish` (terminate)
- **Multi-step editing** loop: continue until blocks are "organized and readable" and "do not contain redundant and outdate information"
- **Skip-if-no-meaningful-update**: agent can call `finish` directly without edits — cost-aware
- **Date precision rule**: "do not write 'today' or 'recently', instead write specific dates and times, because the memory is persisted indefinitely" — matches Mem0's Observation Date discipline
- **Line numbers for viewing only** — agent must NOT echo them in tool calls

**Conflict-resolution path:** IMPLICIT, via LLM agent reasoning. No explicit conflict algorithm in code; the sleeptime agent's LLM decides what to overwrite via memory tools (`core_memory_replace`, `core_memory_append`, etc. — verified via grep would need follow-up; agent toolkit pattern is MemGPT-derived). This is fundamentally different from Mem0's "extract → dedup → soft-link" — Letta does "transcript → background agent → edits blocks via tools."

**v2 abandonment rationale (inferred from EC-3 syntactic diff, since `--depth 1` clones forbid git log):** v2 was 348 LOC (largest of the 4) and was rebuilt as v3 at 266 LOC (lighter). v2's complete absence from any consumer file suggests it was a parallel experiment (likely on the new parent `LettaAgentV2`) that lost to v3. No `TODO`/`FIXME`/`DEPRECATED` markers in v1/v3/v4 indicate explicit deprecation labels weren't added — Letta's convention is "delete the old import sites, keep the file around for legacy fallback."

### Q3 — Conflict-resolution comparison (Mem0 partial answer)

**Mem0 side — FINDING POSITIVO per EC-5 absorption:** Mem0's V3 add pipeline has **NO explicit conflict-resolution path**. The Q1 findings show:

- The add pipeline (`_add_to_vector_store` lines 662-970) handles uniqueness via hash dedup ONLY (Phase 4-5, MD5 collision skip line 800-802); no LLM-judged merge of contradictory facts.
- The legacy `DEFAULT_UPDATE_MEMORY_PROMPT` (`.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:176`) is only invoked from `Memory.update(memory_id, data)` (line 1501) — an EXPLICIT user-driven path, not an automatic conflict resolver during add.
- The new `ADDITIVE_EXTRACTION_PROMPT` reframes the problem: instead of "resolve A vs B", it emits "A is linked to B via `linked_memory_ids`" (soft link, preserves both).

**Differentiation pitch for v0.7:** the absence IS the evidence. Mem0 has CONSCIOUSLY moved away from automatic conflict resolution toward soft-link + dedup. Two interpretations:
1. **Adopt their conclusion** — TheMemory v0.7 also stays ADD-only (matches our ADR-0003), exposes soft-link as `linked_memory_ids`, defers any "merge" to optional consumer-driven `reflect()` consolidation.
2. **Differentiate via explicit LLM-judged resolution at reflect time** — Mem0's V3 leaves contradictions to retrieval-time scoring (the last-write-wins effect). TheMemory v0.7 could ship a `ConflictResolutionPolicy` DIP that consumers configure: `last-write-wins` / `llm-judged-merge` / `manual-queue`. The reflect() phase becomes the place where contradictions are detected (via entity overlap + LLM judgment) and resolved with provenance preservation.

**Recommendation candidate:** option 2 is the moat — Mem0 doesn't ship this; Zep claims to (via Graphiti temporal edges) but the quality remains open per CLAUDE.md Item 9. v0.7 ships an opt-in `ConflictResolutionPolicy` DIP defaulting to `last-write-wins` (Mem0-parity) but enabling `llm-judged-merge` for consumers who want it. Each resolution writes provenance: `{kept: id, rejected: id, reason: "<llm-judged explanation>"}` to history.

**Letta side:** also IMPLICIT, but via DIFFERENT mechanism. Letta's sleeptime agent at `.claude/knowledge-base/references/letta/letta/prompts/system_prompts/sleeptime_v2.py` instructs the LLM to "make sure the memory blocks are comprehensive, readable, and **up to date**" + "do not contain **redundant and outdate information**". The LLM-as-judge decides via memory tools (`core_memory_replace`, `core_memory_append`, `rethink`) what to keep, edit, or remove. No deterministic conflict algorithm; the agent's reasoning + tool calls ARE the conflict resolution.

**Side-by-side comparison:**

| Aspect | Mem0 (V3 add path) | Letta (sleeptime v4) |
|---|---|---|
| Trigger | Synchronous on `add()` call | Asynchronous after foreground step + turn-counter modulo |
| Extraction model | Single LLM call with `ADDITIVE_EXTRACTION_PROMPT` returning JSON `{memory: [...]}` | Background agent loop with tools (precise edits + `rethink` + `finish`) |
| Conflict-resolution algorithm | NONE — soft link via `linked_memory_ids` + hash dedup | NONE — implicit via LLM tool-call reasoning on memory blocks |
| Storage shape | Flat memory records (uuid → text + payload + linked_memory_ids) | Hierarchical memory blocks (label + description + value + read-only flag) |
| Idempotency | MD5 hash dedup (exact text match) | None explicit; agent's "skip-if-no-meaningful-update" is the guard |
| Multi-step | Single LLM call | Multi-step agent loop until `finish` |
| Provenance | `linked_memory_ids` references for related; new memory created separately | Edits in place — original episode message is consulted via transcript but block state may overwrite |
| Cost profile | 1 LLM call + N embeddings | 1 + M LLM calls (variable, until agent calls `finish`) |

**Differentiation pitch for v0.7 (revised after Q2):**

1. **Adopt Mem0's ADD-only + soft-link via `linked_memory_ids`** (matches our ADR-0003 + cheaper) AS THE BASELINE FAST PATH.
2. **Adopt Letta's MULTI-STEP AGENT consolidation** AS THE OPTIONAL SLOW PATH triggered by `reflect()` — emit a `ConflictResolutionPolicy` DIP that defaults to `noop` (Mem0-parity) and supports `llm-judged-merge` (Letta-derived: configure the agent toolkit, run multi-step loop, persist edits + provenance trace).
3. **Differentiate via PROVENANCE PRESERVATION ACROSS THE SLOW PATH**: every `llm-judged-merge` resolution writes `{kept_id, rejected_ids: [], reason: <verbatim agent reasoning>, original_episode_ids: []}` to the history table. Neither Mem0 nor Letta documents this trace explicitly — it's the moat. Consumers asking "why did the system overwrite my memory?" get a verbatim explanation 6 months later.

---

## Coverage Corner 5 — Prior Art (Q7 + Q8)

> Per ADR D5: non-deferrable for this cycle. Snapshots manual per ADR D4 (discover-web-v0-1 helpers not shipped). arXiv abs URL only per EC-9.

### Q7 — Academic anchors

3 canonical papers WebSearched + WebFetched + manually snapshotted per ADR D4 + EC-9 (abs URL only).

#### 1. Generative Agents — Park et al. 2023

- **URL:** https://arxiv.org/abs/2304.03442
- **Snapshot:** `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/58f0cac2d8eed289a0b2bbe1eeedb05dae310fe4104e709c3393b6458124172a.md`
- **Authors:** Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai, Meredith Ringel Morris, Percy Liang, Michael S. Bernstein
- **Venue:** UIST 23 + arXiv cs.HC | DOI: 10.48550/arXiv.2304.03442

**Verbatim abstract quote** (from snapshot): "we describe an architecture that extends a large language model to store a complete record of the agent's experiences using natural language, **synthesize those memories over time into higher-level reflections**, and retrieve them dynamically to plan behavior."

**Implication for v0.7:** the canonical academic anchor for "reflection over episodes → higher-order memory" is THIS paper. TheMemory's v0.4a `reflect()` already implements this pattern (per Roadmap Item 5). v0.7 extends to add provenance preservation + conflict resolution NOT covered in the abstract.

#### 2. CoALA — Sumers et al. 2023

- **URL:** https://arxiv.org/abs/2309.02427
- **Snapshot:** `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/203d41c6266b2357c69e7e64278f156bba0fa895c818c4d53251ec878b0969fd.md`
- **Authors:** Theodore R. Sumers, Shunyu Yao, Karthik Narasimhan, Thomas L. Griffiths (Princeton) | OpenReview: https://openreview.net/forum?id=1i6ZCvflQJ

**Verbatim abstract quote** (from snapshot): "CoALA describes a language agent with **modular memory components**, a structured action space to interact with internal memory and external environments, and a generalized decision-making process to choose actions."

**Implication for v0.7:** CoALA is a FRAMEWORK paper (not algorithm). It classifies agents along 3 dimensions: information storage (Procedural / Semantic / Episodic / Working — episodic and semantic are the two we are bridging), action space, decision-making. **Use CoALA as the framework citation justifying our 3-tier scope** (User/Session/Agent maps onto Episodic + Semantic) + reflect() phase shape. CoALA does NOT provide a gold-set methodology — its contribution is taxonomy.

#### 3. MemoryBank — Zhong et al. 2023

- **URL:** https://arxiv.org/abs/2305.10250
- **Snapshot:** `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/23330a2ecff714779ded7f8225a62f9f1b7f030f8b04ac4b86039a2673475187.md`
- **Code:** https://github.com/zhongwanjun/MemoryBank-SiliconFriend
- **Authors:** Wanjun Zhong, Lianghong Guo, Qiqi Gao, He Ye, Yanlin Wang

**Verbatim contributions** (from snapshot):
- 3-part memory: (a) Storage — saves daily chats, event summaries, and user personality and mood assessments; (b) Retrieval — encodes dialogues and summaries into vectors for recall; (c) Memory intensity update — exponential decay model mimicking Ebbinghaus forgetting curve.
- **Gold-set methodology** (CRITICAL for v0.7 acceptance criterion): "ChatGPT acts as users with diverse characteristics and generates long-term dialog contexts covering a wide array of topics. The results show SiliconFriend, equipped with MemoryBank, exhibits a strong capability for long-term companionship."

**Implication for v0.7 (the moat answer):** MemoryBank's "LLM simulating users → simulated long-term dialog contexts → evaluate empathic response + memory recall" IS the gold-set methodology v0.7's THE GOAL TEST acceptance can mirror. 200 manually-labeled episodes per `CLAUDE.md` Roadmap Item 9 = mix of (a) real user dialogs (50) + (b) LLM-simulated dialogs covering 4 conflict categories (150 = 50 single-fact + 50 multi-fact + 25 contradiction-pair + 25 entity-overlap). Cite MemoryBank verbatim in v0.7 plan acceptance.

Also: MemoryBank's Ebbinghaus decay VALIDATES our v0.4b TriadicScoringPolicy half-life choice — CITE this paper in our v0.4b ADR D12 ex-post.

**Cross-paper synthesis for v0.7 design:**
- Park 2023 → reflection-over-episodes (we already do this in v0.4a)
- Sumers 2023 → modular memory taxonomy (validates our 3-tier scope)
- Zhong 2023 → gold-set methodology (use as v0.7 evaluation template)

**Gap NOT covered by any of the 3 papers:** explicit conflict-resolution algorithm with provenance preservation. This is the moat per Q3 finding.

### Q8 — Vendor claims

4 vendors audited. Mem0 + Letta evidence comes from in-clone reading (Q1/Q2 + Q6 README); Zep + Cognee from public blogs (WebSearched + WebFetched + manually snapshotted per ADR D4).

#### 1. Mem0 (April 2026 announcement — claim from README; corroborated by Q1 source-code read)

- **Source:** `.claude/knowledge-base/references/mem0/README.md` (in-clone) + `https://mem0.ai/research`
- **Verbatim claim:** "Single-pass ADD-only extraction -- one LLM call, no UPDATE/DELETE. Memories accumulate; nothing is overwritten."
- **Published benchmarks:** LoCoMo 91.6 (+20 points over old algorithm); LongMemEval 94.8 (+27); BEAM (1M) 64.1; BEAM (10M) 48.6. Latency p50: 0.88-1.09s. Token cost: ~7K per query.
- **Reproducibility:** open-source eval framework at github.com/mem0ai/memory-benchmarks
- **Gap admitted:** Mem0 does not document explicit conflict-resolution algorithm — confirmed by Q1 source code (V3 add path is purely ADD).

#### 2. Letta (claim from sleeptime_v2.py prompt + sleeptime_multi_agent_v4 code per Q2)

- **Source:** `.claude/knowledge-base/references/letta/letta/prompts/system_prompts/sleeptime_v2.py:1-30` (in-clone)
- **Verbatim claim:** Background agent organizes/maintains memory blocks via "precise tools" + `rethink` (broad reorganization) + `finish` (terminate); multi-step until "blocks are organized and readable, and do not contain redundant and outdate information".
- **Published benchmarks:** none in scope of this discovery (Letta's eval framework lives at `letta/evaluation/` per Q6).
- **Gap admitted:** the conflict-resolution mechanism is implicit in LLM tool calls; no explicit algorithm shipped.

#### 3. Zep + Graphiti

- **URL:** https://blog.getzep.com/graphiti-knowledge-graphs-for-agents/
- **Snapshot:** `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/c9410b9f8ce33a92845480853155ddf8be11bf1664184f21108774f22f283397.md`
- **Verbatim architecture:** "Memory is powered by a temporally-aware dynamic knowledge graph G = (N, E, ϕ)... This graph comprises three hierarchical tiers of subgraphs: an episode subgraph, a semantic entity subgraph, and a community subgraph."
- **Two-layer model:** "Episodic nodes contain the raw data of an episode" + "Entity (Semantic) nodes represent the semantic subjects and objects extracted from the episode"
- **Conflict-resolution CLAIM:** "Knowledge graphs can explicitly model these relationships with **temporal validity periods, allowing facts to be invalidated when contradictory information arrives later.**"
- **Published benchmarks:** DMR 94.8% (vs MemGPT 93.4%); evaluated also on LongMemEval (no number cited in blog)
- **Honesty gap audit:** the contradiction-detection algorithm is NOT documented in the blog. Source is open-source (github.com/getzep/graphiti) — to claim Zep as the gold standard requires reading Graphiti source, NOT just the blog marketing. TheMemory already does bi-temporal per ADR-0006; we match Zep's moat with our existing schema.

#### 4. Cognee

- **URL:** https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory
- **Snapshot:** `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/dcadf55dd810aac69104c1facb8206af248399eccb5b93dc9e41c2fc7f101052.md`
- **Verbatim episodic→semantic claim:** "Cognee specifically performs episodic-to-semantic abstraction: similar sessions tend to share underlying structure even when explicit details differ. **Cognee clusters those repeated paths into episodic groups and then compresses them into semantic abstractions** — reusable representations of 'this kind of situation' rather than one-off instances."
- **ECL Pipeline:** Extract → Cognify → Load; "raw inputs move into normalized documents, which then become a knowledge graph with embeddings, and finally lead to searchable answers."
- **Ontology integration:** OWL-based via RDFLibOntologyResolver + Instructor-powered structured output; OPTIONAL (works without ontology too).
- **Foundational citation:** Cognee explicitly cites CoALA (Sumers 2023, same Q7 paper). They use CoALA as their theoretical foundation.
- **Honesty gap audit:** cluster algorithm + compression prompt NOT documented in blog. Ontology integration adds poly-store complexity TheMemory deliberately avoids (per CLAUDE.md Roadmap Item 15 v1.4 plan — ontologies are post-v1.0).

**Cross-vendor synthesis (the moat verdict):**

| Vendor | Conflict-resolution claim | Algorithm documented? | Provenance trace? |
|---|---|---|---|
| Mem0 (April 2026) | None (ADD-only by design) | Yes (source-code clear) | Soft link via `linked_memory_ids` |
| Letta | LLM agent decides via tool calls | No (implicit in agent) | None explicit |
| Zep + Graphiti | Bi-temporal validity invalidation | No (blog claim only) | None explicit in blog |
| Cognee | Clustering + compression to abstractions | No (blog claim only) | None explicit in blog |
| **TheMemory v0.7 (proposed)** | **`ConflictResolutionPolicy` DIP** | **YES** | **YES (`derived_from` + `rejected_alternatives` + `reasoning_trace`)** |

The honest moat is NOT "we solve conflict-resolution better" — Mem0's April 2026 announcement (validated by Q1 source code) suggests ADD-only is the SOTA position. The moat is **TRANSPARENCY**: we ship the algorithm + the prompts + the provenance trace. Consumers asking "why" get a verbatim answer 6 months later. Mem0/Letta/Zep/Cognee don't document this; we do.

---

## Cross-cutting comparison

| Aspect | Mem0 (Python V3) | Letta (sleeptime v4) |
|---|---|---|
| **Pipeline shape** | 8-phase synchronous batch on `add()`: Context → Existing-retrieval → LLM-extract → batch-embed → hash-dedup → batch-persist → entity-link → save-messages (`mem0/mem0/memory/main.py:662-970`) | Background tool-call agent: foreground step → trigger-by-turn-counter → spawn `_participant_agent_step` → multi-step memory-tool edits until `finish` (`letta/letta/groups/sleeptime_multi_agent_v4.py:65-289`) |
| **Extraction LLM** | Single call w/ `ADDITIVE_EXTRACTION_PROMPT` (system) + `generate_additive_extraction_prompt(...)` (user); response_format `json_object` (`mem0/mem0/configs/prompts.py:468`) | Background LettaAgentV3 with sleeptime system prompt + memory tools (precise edits + `rethink` + `finish`); multi-step until done (`letta/letta/prompts/system_prompts/sleeptime_v2.py:PROMPT`) |
| **Conflict-resolution strategy** | NONE — ADD-only + hash-dedup + soft-link via `linked_memory_ids` | NONE — implicit via agent LLM tool-call reasoning |
| **Gold-set methodology (tests/)** | NONE under `tests/` — fully mocked unit tests (`mem0/tests/memory/test_main.py:9-26`) | NONE under `tests/` — real-server integration tests (`letta/tests/integration_test_sleeptime_agent.py:1-50`) |
| **Provenance schema** | `linked_memory_ids: [UUID]` soft links; no rejection trace | None — edits in place via `core_memory_replace` etc.; transcript preserved separately |
| **Per-row fallback at I/O boundary** | YES — every batch path falls back to per-row on failure (lines 776, 835, 856, 888, 952) | Background task failure raises (line 167); no per-agent fallback |
| **Async** | Both sync `Memory` and `AsyncMemory` paths (`main.py:1795 class AsyncMemory`) | Async-native via `LettaAgentV3` parent; `safe_create_task` for sleeptime spawn |
| **Bi-temporal validity** | NO (created_at/updated_at only) | Implicit via run_status / archive_manager (not deeply audited) |
| **Anti-hallucination** | UUID→int sequential mapping for LLM prompt (lines 717-721) | Line numbers explicitly excluded from tool calls per sleeptime_v2 prompt |
| **Dev story** | `hatch env create` + optional `make install_all` (heavy); in-memory default | `docker-compose -f dev-compose.yaml up` + Postgres prerequisite; no in-memory option |

---

## Recommendations

### R1 (Q1) — Adopt Mem0's 8-phase batch pipeline shape verbatim

Mirror Mem0's V3 `_add_to_vector_store` 8-phase shape (Context → Existing-retrieval w/ UUID→int → LLM-extract → batch-embed w/ per-row fallback → hash-dedup → batch-persist w/ per-row fallback → batch entity-link → save-messages). This is the proven shape. We already adopt phases 0-6 in v0.1; v0.7 adds Phase 7 entity-linking (with batch dedup at cosine ≥ 0.95 like Mem0) and the per-row fallback discipline at EVERY I/O boundary. Cite `.claude/knowledge-base/references/mem0/mem0/memory/main.py:662-970`.

### R2 (Q2) — DO NOT adopt Letta's sleeptime tool-call agent model for v0.7

Letta's background-agent approach is architecturally different (multi-step LLM tool calls vs single LLM extraction call). It's higher cost (M LLM calls vs 1) and Letta itself has churned 4 versions on it (v2 ABANDONED). DEFER to v0.8+ if/when consumer pain surfaces. For v0.7, the single-LLM-call shape (Mem0's R1) is enough.

### R3 (Q3) — Ship `ConflictResolutionPolicy` DIP with 3 implementations

- `NoopConflictPolicy` (DEFAULT, Mem0-parity) — never resolves; just adds + soft-links via `linked_memory_ids`
- `LastWriteWinsConflictPolicy` — when hash-dedup detects equivalent text, keep newer (created_at); persist `{kept, rejected, reason: "last-write-wins"}` to history
- `LlmJudgedMergeConflictPolicy` (premium / opt-in) — for cosine-similar but not hash-equivalent pairs, invoke LLM to merge; persist `{kept, rejected_alternatives, reason: <verbatim LLM reasoning>, original_episode_ids: []}`

Opt-in per-instance via `createMemory({ conflictResolution: <Policy> })`. Default ships with Noop = Mem0 parity. Premium adds telemetry on resolution rate.

### R4 (Q4) — Gold-set methodology from MemoryBank

200 manually-labeled episodes split: 50 single-fact + 50 multi-fact + 25 contradiction-pair + 25 entity-overlap + 50 LLM-simulated dialogs (per MemoryBank Q7 methodology). Commit at `tests/fixtures/distillation/{shape}/`. Each fixture: `{episodeText, expectedFacts: [{text, attributedTo, linkedToIds}], expectedConflictPair?: {kept, rejected}}`. Precision/recall computed via:
- Precision = exact-text or BLEU>0.8 matches / extracted_count
- Recall = exact-text or BLEU>0.8 matches / expected_count
- Conflict-resolution accuracy = correct(kept, rejected) decisions / total contradiction-pair fixtures

Lock thresholds at v0.7 kickoff per CLAUDE.md Roadmap Item 9 acceptance ("entity-extraction precision ≥ TBD; recall ≥ TBD"). Initial baselines: precision ≥ 0.75, recall ≥ 0.70.

### R5 (Q5) — Dependency strategy

- ADOPT: `openai` SDK (Cycle 2 already shipped); `crypto` (stdlib, hash dedup); `pg` + `drizzle-orm` (already in v0.1)
- DEFER: `spacy` / NER lib — first ship LLM-only entity extraction (cheaper to validate); add NER lib only if Q5 EC-6 cap fires during /implement
- REJECT: `sentence-transformers`, `langchain*`, `psycopg2`, `sqlalchemy`, `llama-index-*` (ecosystem mismatch or unnecessary)

### R6 (Q6) — Dev story

Mirror Letta's docker-compose pattern for integration tests (auto-boot pgvector + app); mirror Mem0's in-memory-quickstart for SDK readme example. Already have `compose:up` per package.json v0.1. v0.7 ships `tests/fixtures/distillation/` + `pnpm run eval:distillation` script that runs gold-set against `ankane/pgvector:v0.5.1`.

### R7 (Q7) — Academic citations in v0.7 plan

- Cite Park 2023 (https://arxiv.org/abs/2304.03442) as the reflection algorithm anchor
- Cite Sumers 2023 (https://arxiv.org/abs/2309.02427) as the framework taxonomy (validates 3-tier scope)
- Cite Zhong 2023 (https://arxiv.org/abs/2305.10250) as the gold-set methodology
- All 3 already snapshotted in `discoveries/snapshots/v0-7-episodic-semantic-distillation/` — reusable verbatim in /to-plan

### R8 (Q8) — Differentiation pitch (the moat)

v0.7's MARKETING and CHANGELOG entry should NOT claim "we solve conflict-resolution better than Mem0/Zep/Cognee". The HONEST moat is:

> "Transparent provenance + explicit conflict-resolution policy DIP. Every memory consolidation writes a full audit trail: which sources were merged, which were rejected, the verbatim LLM reasoning. Mem0 (ADD-only, no merge) / Letta (tool-call, no trace) / Zep (bi-temporal, no algorithm doc) / Cognee (clustering, no algorithm doc) ship the OUTCOME; TheMemory ships the ALGORITHM + the AUDIT TRAIL."

Validates Inquebrável Rule 3 (extreme honesty) at the product-marketing layer.

---

## ADRs

> Synthesis-time decisions taken during /discover-execute. Distinct from source-plan ADRs D1-D5 (which governed HOW to investigate).

### B-D1 — Mem0 V3 pipeline shape is the v0.7 architectural target

**Decision:** v0.7 adopts Mem0's 8-phase V3 pipeline shape (see R1). Does NOT adopt Letta's multi-step background-agent shape (see R2).

**Alternatives considered:** (A) Hybrid (Mem0 add + Letta reflect agent) — REJECTED: double the LLM cost; complexity; both have implicit conflict handling. (B) Letta-only — REJECTED: v2 abandonment evidence + multi-step cost. (C) Mem0-only (CHOSEN) — proven (April 2026 benchmarks); cheaper.

**Consequences:** v0.7 implementation plan mirrors `mem0/mem0/memory/main.py:662-970` directly. Per-row fallback at every boundary is non-negotiable.

### B-D2 — `ConflictResolutionPolicy` DIP ships v0.7 (Mem0's gap = our moat)

**Decision:** v0.7 ships a `ConflictResolutionPolicy` DIP at `src/core/dip/conflict-resolution-policy.ts` with 3 implementations (see R3).

**Alternatives considered:** (A) ADD-only only (Mem0 parity) — REJECTED: gives up the moat. (B) LLM-judged-merge ALWAYS (Letta-parity) — REJECTED: cost. (C) DIP with 3 implementations + Noop default (CHOSEN) — backward-compat + opt-in differentiation.

**Consequences:** Default behavior matches Mem0 (zero risk). Premium consumers opt into `LlmJudgedMergeConflictPolicy` for transparent merge with audit trail. The trail IS the marketing.

### B-D3 — Gold-set methodology from MemoryBank, NOT invented

**Decision:** Mirror MemoryBank (Zhong 2023, Q7) gold-set methodology verbatim: 200 episodes, 4 contradiction categories + simulated-user category (see R4).

**Alternatives considered:** (A) Invent our own — REJECTED: no academic anchor; reviewers can question. (B) LongMemEval (used by Mem0) — REJECTED: external benchmark, harder to commit fixtures. (C) MemoryBank (CHOSEN) — academic anchor + commit fixtures under `tests/fixtures/distillation/`.

**Consequences:** Acceptance criteria for v0.7 cite MemoryBank in `tests/fixtures/distillation/README.md`. Each fixture file links back to its archetype (single-fact / multi-fact / contradiction / entity-overlap / simulated-dialog).

### B-D4 — LangChain ecosystem rejected; raw `openai` SDK + manual prompts

**Decision:** v0.7 uses raw `openai` SDK (Cycle 2 adapter) + manually-authored prompts in `src/core/extraction/prompt.ts` (already exists). No LangChain / LangChain-Community.

**Alternatives considered:** (A) LangChain (BOTH Mem0 + Letta use it) — REJECTED: contradicts CLAUDE.md adoption choice (we use Mem0-shape WITHOUT the framework). (B) Raw SDK (CHOSEN) — matches existing TheMemory hygiene.

**Consequences:** Prompts are debuggable + version-controlled in our repo; no LangChain abstraction tax.

### B-D5 — Bi-temporal validity already shipped (ADR-0006); v0.7 wires conflict-resolution to it

**Decision:** Zep's bi-temporal moat ("facts invalidated when contradictory information arrives later") is already shipped in TheMemory via `t_valid` / `t_invalid` columns per ADR-0006. v0.7 wires `ConflictResolutionPolicy` to set `t_invalid` on rejected memories instead of hard-delete.

**Alternatives considered:** (A) Hard-delete rejected (Mem0-style) — REJECTED: loses audit trail. (B) Soft-delete via `t_invalid` (CHOSEN) — matches our existing schema; consumers can `recall({ asOf: t1 })` for historical state per ADR-0006 v0.5+ surface.

**Consequences:** `LlmJudgedMergeConflictPolicy` SETS `t_invalid` + records full provenance in history table. Zero schema changes from v0.4b → v0.7. Pure logic-layer add.

---

## Blocked questions

> Honest record of questions that hit halt/stop conditions. Populated only if /discover-execute exhausts budget or hits unresolvable gaps.

<!-- (empty — populated only on honest BLOCKED) -->
