# Blueprint: Voyager-style skill library for TheMemory v0.6

> **Version 1.0 (draft)** — Synthesis of how a procedural-memory skill library should land in `@usetheo/memory`, grounded in (a) the canonical 4-type agent-memory taxonomy from CoALA (Sumers et al. 2024), (b) the Voyager algorithm + 2 post-Voyager procedural-memory extensions, (c) Mem0's `openclaw/` skill packs (Node ecosystem — see plan ADR D5), (d) Letta's agent-skill test patterns. Produced by `/discover-execute` halt-loop iteration on plan v1.2.

**Slug:** `voyager-skill-library`
**Source plan:** `.claude/knowledge-base/discoveries/plans/voyager-skill-library-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-05-29 via `/discover-execute`
**Confidence verdict:** {SHIPPABLE | SHIPPABLE_WITH_CAVEATS | NON_SHIPPABLE | INVALID} (updated by `/discover-confidence`)

## Context

v0.6 of TheMemory roadmap is "Open Problem #2" — a Voyager-style skill library exposing `memory.skills(repoId)`. The framing is canonical (CoALA 2024 establishes the 4-type taxonomy and identifies Voyager as the procedural-memory exemplar; multiple post-Voyager papers extend the line). v0.4a `ReflectionPolicy` + `Memory.reflect()` shipped 2026-05-29 — the dependency for v0.6 is unblocked. No `*-patterns` skill exists yet (`.claude/skills/*-patterns/` empty); zero in-tree prior art for skill libraries. The blueprint synthesizes external prior_art with the two reference projects (Mem0 + Letta — LangMem not cloned, accessed via GitHub per plan ADR D3) into a decision-ready recommendation.

## Objective

Enable the v0.6 contract decision: shape of `memory.skills(repoId)` API + on-disk skill format + refinement-loop placement (REUSE v0.4a `Memory.reflect()` chain vs ship a sibling — D4 in the plan).

---

## Coverage Corner 1 — Integration Tests

> One subsection per investigated source. Populated by per-question synthesis below.

### Letta — agent skill cycles (Q1)

**File:** `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py` (222 lines, 5 tests, mixed sync + async)

**Mock LLM strategy:** 100% mocked. Every test patches `LLMClient.create` to return `MagicMock()` (`.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:41`). Async manager calls (`update_message_by_id_async`, `refresh_memory_async`, `refresh_file_blocks`, `get_default_archive_for_agent_async`) are stubbed via `AsyncMock` (lines 117, 201-203, 210). **No real LLM, no real DB, no real embeddings** — these are pure structural-rendering tests.

**Fixtures (3 helpers):**

| Helper | Line | Purpose |
|---|---|---|
| `_make_agent(memory)` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:20` | Builds `User` actor + `AgentState` (gpt-4o-mini default + openai embedder default + `letta_v1_agent` agent type), patches `LLMClient.create` to `MagicMock`, returns `LettaAgentV2` instance. Memory injected per test. |
| `_build_memory_with_literal_tag_refs()` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:45` | Constructs `Memory` with 3 `Block`s (`system/human`, `system/project/notes`, `system/persona`); the notes block contains literal `` `<available_skills>` `` markdown to test escape correctness when the same string is BOTH content AND structural delimiter. |
| `_assert_one_structural_skills_block_at_tail(text)` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:61` | Regex assertion helper: locates last `</memory>` boundary, then verifies EXACTLY ONE `<available_skills>` + ONE `</available_skills>` in the tail. |

**Test topology (5 tests):**

| # | Test | Line | Shape | What it asserts |
|---|---|---|---|---|
| 1 | `test_generate_request_system_prompt_appends_skills_and_preserves_literals` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:69` | sync, MagicMock | One `<available_skills>` block at tail; literal `` `<available_skills>` `` content preserved (escape correctness); `SKILL.md (fresh)` rendered |
| 2 | `test_refresh_messages_does_not_repair_or_persist_system_prompt` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:90` | async, AsyncMock | `update_message_by_id_async.assert_not_called()` — `_refresh_messages` is READ-ONLY; bloated text (skills duplicated 3×) returned unchanged |
| 3 | `test_generate_request_system_prompt_includes_request_scoped_client_skills_without_mutating_storage` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:127` | sync, MagicMock | Request-scoped `ClientSkillSchema` renders in output; original persisted `Message.content[0].text` UNCHANGED (object identity, no mutation) |
| 4 | `test_generate_request_system_prompt_is_stable_for_same_stored_system_prompt` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:153` | sync, MagicMock | Idempotency — 3 sequential calls produce IDENTICAL output; only 1 `SKILL.md (fresh)` occurrence in final |
| 5 | `test_rebuild_memory_does_not_persist_client_skill_block` | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py:184` | async, AsyncMock | After `_rebuild_memory` with `force=True`, persisted system text contains NEITHER `<available_skills>` NOR `client-only-skill` — request-scoped data NEVER reaches storage |

**Pattern recap (translatable to v0.6):**

- Skill testing = **structural rendering correctness** + **non-persistence of request-scoped data**, NOT execution validation.
- `ClientSkillSchema(name, description, location)` = Letta's contract for an external skill reference (just metadata; no executable body in the test). Maps onto our future `Skill` interface — name + description + on-disk location.
- The `<available_skills>...</available_skills>` XML envelope in the system prompt is Letta's protocol for injecting skill catalog into the LLM context per-request.
- TDD pyramid placement: these are **unit tests** (no I/O), heavily mocked; the integration-test layer for skill execution would live elsewhere.

---

## Coverage Corner 2 — Dependencies

### Mem0 openclaw (Node) (Q2 — anchor per ADR D5)

**Package:** `@mem0/openclaw-mem0` v1.0.11 (Apache-2.0, ESM, tsup-built, vitest-tested).

| Dependency | Version | Purpose | Citation |
|---|---|---|---|
| `@sinclair/typebox` | `0.34.47` | Runtime JSON-Schema validation for plugin manifest + tool args | `.claude/knowledge-base/references/mem0/openclaw/package.json:37` |
| `mem0ai` | `3.0.2` | Peer-coupled to Mem0 SDK (the JS client used inside the plugin) | `.claude/knowledge-base/references/mem0/openclaw/package.json:38` |

Dev-deps (`vitest@^4.0.18` + `tsup@^8.5.0` + `typescript@^5.8.3` + `@types/node@^22.15.0`) at `.claude/knowledge-base/references/mem0/openclaw/package.json:56-62`.

**Notable absence:** zero deps for code execution / sandboxing. openclaw is a Claude-Code/AI-editor **plugin** (per `.claude/knowledge-base/references/mem0/CLAUDE.md` Plugin & Skills System), NOT a skill-execution runtime. The "skills" shipped under `openclaw/skills/` (memory-dream, memory-triage) are markdown protocols invoked by Claude Code itself — Mem0's openclaw package provides the memory-backend integration, not the skill executor. **Implication for v0.6:** Mem0 openclaw is the format + retrieval anchor, NOT the execution-pattern anchor. Skill execution sandboxing must look elsewhere (see Voyager below).

Sub-skill `package.json` lookup: `find .claude/knowledge-base/references/mem0/openclaw/skills -maxdepth 3 -name "package.json"` returns empty — skills are pure markdown protocols, no per-skill Node packaging.

### Letta (Python) (Q2 — CONCEPTUAL_BORROW per ADR D5)

**Package:** `letta` v0.16.8, Apache-2.0, Python ≥ 3.11 < 3.14. Single `pyproject.toml` (no sub-manifests in scope).

Filtered to deps RELEVANT to skill-execution + skill-orchestration patterns (the full dep list is 80+ entries; non-relevant filtered):

| Dependency | Version | Purpose / relevance to skills | Citation |
|---|---|---|---|
| `mcp[cli]` | `>=1.9.4` | Model Context Protocol — Letta exposes skills as MCP tools | `.claude/knowledge-base/references/letta/pyproject.toml:dependencies` |
| `fastmcp` | `>=2.12.5` | MCP server framework on top of mcp[cli] | `.claude/knowledge-base/references/letta/pyproject.toml:dependencies` |
| `temporalio` | `>=1.8.0` | Workflow orchestration (potential skill scheduling) | `.claude/knowledge-base/references/letta/pyproject.toml:dependencies` |
| `apscheduler` | `>=3.11.0` | In-process job scheduling | `.claude/knowledge-base/references/letta/pyproject.toml:dependencies` |
| `llama-index` | `>=0.12.2` | Embedding-based retrieval (skill recall) | `.claude/knowledge-base/references/letta/pyproject.toml:dependencies` |
| `tavily-python` / `exa-py` | `>=0.7.2` / `>=1.15.4` | Web-search-as-tool examples (skill instances) | `.claude/knowledge-base/references/letta/pyproject.toml:dependencies` |

**Notable absence:** no sandboxed Python exec runtime (no `RestrictedPython`, no `e2b-code-interpreter`, no `pyodide`). Letta skills are **tool calls**, not arbitrary code — they invoke pre-registered functions via MCP or function-calling. The `ClientSkillSchema` from Q1 carries `(name, description, location)` triple — `location` is a skill-doc filesystem path, NOT executable code. **Implication for v0.6:** Letta validates the "skill-as-reference, not skill-as-code" pattern; matches Claude Code's own skill model.

### Voyager (Python) (Q2 — CONCEPTUAL_BORROW per ADR D5; the ONLY ref with explicit exec sandbox)

**Manifest:** [`requirements.txt`](https://raw.githubusercontent.com/MineDojo/Voyager/main/requirements.txt) (snapshot `7568f970188ce385333338bbf6da4ec7ae53807da6f1af0f5c0382fc1facbb6b.md`). Hit on first priority (requirements.txt) — no setup.py / pyproject.toml fallback needed.

| Dependency | Version | Purpose / relevance to skills | Where |
|---|---|---|---|
| `chromadb` | `==0.3.29` | **Skill embedding + retrieval store** — the index that backs the skill library | snapshot:line8 |
| `javascript` | unpinned | **Python wrapper to execute JS in a Node subprocess** — this IS the sandbox; Voyager skills are JS bot routines, invoked from Python via this lib | snapshot:line3 |
| `langchain` | unpinned | LLM orchestration for critic/proposer/refiner roles | snapshot:line2 |
| `openai` | unpinned | LLM API client (gpt-4 in paper) | snapshot:line5 |
| `tiktoken` | unpinned | Token counting (context-window discipline) | snapshot:line9 |
| `gymnasium` | unpinned | Minecraft env interface (domain-specific) | snapshot:line12 |
| `minecraft_launcher_lib` | unpinned | Game-specific (out-of-scope for v0.6) | snapshot:line14 |

**KEY INSIGHT for v0.6:** Voyager solves "executable procedural memory" via **language-bridge sandboxing** — skills are JS code stored in ChromaDB by description-embedding, retrieved on demand, then invoked from the Python orchestrator via `javascript` bridge. The pattern is `(retrieval store) + (exec runtime in a separate process)`. For our TypeScript-first context (ADR D5), the inverse mapping is: store skills as TS code in pgvector (already have), exec via a Node child-process worker OR `node:vm` module. **No need to invent new sandboxing primitives** — Voyager's pattern translates cleanly. The Rule 9 verdict on the `javascript` lib itself is CONCEPTUAL_BORROW (Python-side), but its **architectural shape** is the borrow.

**Critical version risk:** `chromadb==0.3.29` is hard-pinned (the only pinned dep). Suggests Voyager's skill library was tested against a specific ChromaDB version — moving to newer chromadb would require Voyager-side migration. For us this is academic; we use pgvector + our own VectorStore DIP.

---

## Coverage Corner 3 — Tools

> Scope: on-disk skill format + indexing layout (per Q3 mapping in the plan).


### Mem0 openclaw skills — schema + layout (Q3)

**Skill = directory** under the Mem0 openclaw skills root (examples: `memory-dream/`, `memory-triage/`). Shape is **heterogeneous** (single-file OR multi-file): EC-4 in the plan v1.1 originally attributed `domains/` + `recall-protocol.md` to `memory-dream` — VERIFIED 2026-05-29 to be wrong: `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/` has ONLY `SKILL.md` (single-file). `.claude/knowledge-base/references/mem0/openclaw/skills/memory-triage/` is the multi-file example (3 entries).

**Frontmatter (YAML, all skills):**

```yaml
---
name: memory-triage                        # required, kebab-case
description: >
  Persistent long-term memory protocol...   # required, multi-line OK
applies_to: memory-triage                   # OPTIONAL — used by auxiliary protocols (recall-protocol.md) to bind to parent skill
user-invocable: false                       # required boolean; controls who can invoke (user vs auto-injected)
metadata:
  {"openclaw": {"always": false, "injected": true, "emoji": "🧠", "requires": {"env": ["MEM0_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], "bins": []}}}
---
```

Citations:
- `memory-dream` single-file: `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md:1-11` (frontmatter), `:13-150` (Markdown protocol body — 4 phases: Orient → Gather Targets → Consolidate → Report; explicit Quality Targets list)
- `memory-triage` multi-file: `.claude/knowledge-base/references/mem0/openclaw/skills/memory-triage/SKILL.md:1-11` (frontmatter); siblings: `.claude/knowledge-base/references/mem0/openclaw/skills/memory-triage/recall-protocol.md:1-5` (frontmatter `applies_to: memory-triage`); `.claude/knowledge-base/references/mem0/openclaw/skills/memory-triage/domains/companion.md:1-5` (domain overlay frontmatter `applies_to: memory-triage`)

**Auxiliary file patterns observed in `memory-triage/`:**

| File | Purpose | Frontmatter signal |
|---|---|---|
| `SKILL.md` | The primary skill protocol | `name`, `description`, `user-invocable`, `metadata.openclaw` |
| `recall-protocol.md` | Sub-protocol bound to parent skill | `name`, `description`, `applies_to: <parent-name>` |
| `domains/companion.md` | Domain-specific extraction overlay | `name`, `description`, `applies_to: <parent-name>`; Markdown adds rules under "Additionally Extract" |

**Retrieval / indexing:** NONE built into the skill format itself. Skills are filesystem-resident; the openclaw plugin loads them at startup via the `files: ["dist", "openclaw.plugin.json", "skills"]` entry in `.claude/knowledge-base/references/mem0/openclaw/package.json:27-31`. No vector embedding of the SKILL.md body. **Implication for v0.6:** if we adopt Mem0's shape verbatim, we need to add the retrieval layer (pgvector index of description field) ourselves — not part of Mem0's contract.

**Body shape:** free-form Markdown. Common conventions observed: explicit `## Available Tools` section enumerating tool names + arg schemas; phase-numbered protocols (`## Phase 1: Orient` etc.); explicit `## Quality Targets` post-condition list. **Implication for v0.6:** skill body is LLM-consumed prompt content, NOT executable code (contrast with Voyager below).

### Voyager — skill library format (Q3, via [`voyager/agents/skill.py`](https://raw.githubusercontent.com/MineDojo/Voyager/main/voyager/agents/skill.py), snapshot `867c6c33...`)

Skills are **EXECUTABLE CODE** + multi-store layout:

| Storage | Path under `{ckpt_dir}/skill/` | Format | Purpose |
|---|---|---|---|
| Vector DB | `vectordb/` | ChromaDB collection | semantic retrieval (similarity search) |
| Code files | `code/{program_name}.js` | JavaScript file | the actual skill, executed by `javascript` Python lib (per Q2) |
| Descriptions | `description/{program_name}.txt` | text file | embedded into vector DB; used as retrieval query target |
| Registry | `skills.json` | JSON | master index `{program_name: {"code": code, "description": desc}}` |

**Retrieval:** `vectordb.similarity_search_with_score(query, k=k)` — top-k default 5.

**Refactor mechanism:** on duplicate insert, old code archived as `{program_name}_V2.js` / `_V3.js` (description files versioned in parallel); vector DB entry replaced; registry holds ONLY the latest. **This IS the consolidation pattern** — versioning + supersession at the file system level.

**Consistency invariant:** `assert vectordb._collection.count() == len(self.skills)` — vectordb and registry MUST stay in sync. Violation = corrupted skill library. (Source: snapshot `867c6c33...`)

**Implication for v0.6:** Voyager's format is the **purest "skill = code + description + index" triad** in the literature. Our equivalent in pgvector + Drizzle ORM is straightforward: a `skills` table with `(id, name, code_text, description, embedding_vector, version, superseded_by)` columns. No need to invent. The 4-store layout (vectordb + code/ + description/ + skills.json) is filesystem-coupled and presumes single-tenant; we collapse to relational + vector columns for multi-tenancy.

### LangMem — procedural memory shape (Q3, via [`langmem/src/langmem/`](https://api.github.com/repos/langchain-ai/langmem/contents/src/langmem))

**Finding (honest):** LangMem does NOT expose a procedural-skill-library module. Top-level `src/langmem/` contains:

| Entry | Type | Role |
|---|---|---|
| `__init__.py` | file | Package init |
| `errors.py` | file | Error definitions |
| `graph_rag.py` | file | Graph-based RAG |
| `reflection.py` | file (16KB) | Reflection mechanisms (the closest to v0.4a `Memory.reflect()`) |
| `utils.py` | file | Utilities |
| `graphs/` | dir | Graph modules |
| `knowledge/` | dir | Knowledge storage/retrieval |
| `prompts/` | dir | Prompt templates |
| `short_term/` | dir | Short-term memory |

**Implication for v0.6 (initial finding):** LangMem is positioned as a knowledge + reflection layer, NOT a Voyager-style code-skill library.

**Q6-iteration correction (2026-05-29):** The CLAUDE.md framing "LangMem = procedural memory via prompt rewriting" is **CORRECT, not generous**, per LangMem's own docs ([langchain-ai.github.io/langmem/concepts/conceptual_guide/](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)):

> "In LangMem, we focus on saving learned procedures as updated instructions in the agent's prompt."

> "Procedural memory represents internalized knowledge of how to perform tasks. For AI agents, procedural memory is a combination of model weights, agent code, and agent's prompt that collectively determine the agent's functionality. ...However, it is more common for agents to modify their own prompts."

LangMem ships three prompt-optimization algorithms (`metaprompt`, `gradient`, `prompt_memory`) as its procedural-memory mechanism. The `reflection.py` 16KB file IS the procedural-memory module — labeled by mechanism (reflection-based prompt mutation), not by directory name. **Bottom line:** LangMem's procedural memory IS prompt rewriting; we were right to call it that, and the project rule about source-verifying before recall-from-memory still applies (this Q3 first pass was the verification step).

---

## Coverage Corner 4 — Techniques

### Voyager iterative-prompting + skill-refinement algorithm CONTEXTUALIZED in canonical literature (Q4)

(Note: PDF abstracts insufficient — fell back to `ar5iv.labs.arxiv.org` HTML per plan v1.1 EC-5. Allowlist additions logged in `.claude/rules/discover-web-allowlist.txt` 2026-05-29.)

#### (a) Voyager algorithm — Pseudocode 1 (verbatim from [Voyager paper Appendix A.1](https://ar5iv.labs.arxiv.org/html/2305.16291), snapshot `08b07250...`)

```
for i in range(4):
    skills = skill_manager.retrieve_skills(task, environment_feedback)
    code = action_agent.generate_code(
        task, code, environment_feedback,
        execution_errors, critique, skills)
    (agent_state, environment_feedback,
     execution_errors) = environment.step(code)
    success, critique = critic_agent.check_task_success(
        task, agent_state)
    if success:
        break
```

**Loop semantics** (§2.3): max 4 attempts per task; on success → add new skill; on 4 failures → curriculum proposes a different task.

**Three feedback channels driving generate_code:**
- *Environment feedback*: "intermediate progress of program execution"
- *Execution errors*: "invalid operations or syntax errors in programs"
- *Self-verification critique*: "provides a critique by suggesting how to complete the task"

**Skill library API** (§2.2):
- `add_skill`: vector DB entry where "key is the embedding vector of the program description (generated by GPT-3.5), while the value is the program itself"
- `retrieve_skill`: top-5 via "embedding of self-generated task plans and environment feedback"

**Headline empirical** (Voyager abstract): "3.3x more unique items, travels 2.3x longer distances, and unlocks key tech tree milestones up to 15.3x faster than prior SOTA."

#### (b) CoALA anchor — procedural memory = skill library (verbatim from [Sumers et al. 2024](https://ar5iv.labs.arxiv.org/html/2309.02427), snapshot `660094e0...`)

CoALA's 4-type taxonomy definitions:

| Type | Definition (verbatim) |
|---|---|
| Working | "Working memory maintains active and readily available information as symbolic variables for the current decision cycle." |
| Episodic | "Episodic memory stores experience from earlier decision cycles." |
| Semantic | "Semantic memory stores an agent's knowledge about the world and itself." |
| Procedural | "Language agents contain two forms of procedural memory: _implicit_ knowledge stored in the LLM weights, and _explicit_ knowledge written in the agent's code." |

**Voyager-as-procedural-memory-exemplar (verbatim):**
> "Voyager (Wang et al., 2023a) loads code-based skills from a skill library via dense retrieval to interact with the Minecraft world – effectively retrieving grounding procedures from a procedural memory."

**Updating procedural memory (verbatim):**
> "Updating grounding (e.g., code-based skills; Liang et al., 2023a; Ellis et al., 2021; Wang et al., 2023a). For example, Voyager (Wang et al., 2023a) maintains a curriculum library."

#### (c) Post-Voyager extensions — design alternatives

| Paper | Skill representation | Refinement mechanism | Headline result | Citation |
|---|---|---|---|---|
| **Voyager** (2023) | **Executable JS code** + textual description | Iterative-prompting + critic feedback (max 4 loops); on success → add | 15.3× tech-tree milestone speed | snapshot `08b07250...` |
| **ProcMEM** (2026) | **Natural-language 3-tuple** (Activation + Execution + Termination) — NOT code | Non-parametric PPO (no LLM weight updates): hindsight attribution → semantic gradient `g_i^(I,π,β)` → LLM-driven update `ω' = ω ⊕ ḡ` → PPO trust-region gate (`J(ω') > 0`) → score-based pruning | 92.5% in-domain reuse vs 34.9% RAG; 816 tokens stored vs hundreds of thousands | [ar5iv 2602.01869](https://ar5iv.labs.arxiv.org/html/2602.01869) snapshot `c2785c97...` |

**Critical observation:** ProcMEM does NOT compare against Voyager (different problem — bounded sequential decisions vs open-ended Minecraft). The two represent **opposite design choices** for the skill representation question: Voyager = code-as-skill (verifiable but bound to exec runtime); ProcMEM = NL-spec-as-skill (interpretable but execution-engine = LLM call). **Implication for v0.6:** these are TWO viable architectures. Mem0 openclaw skills (Q3 finding) align with ProcMEM shape (Markdown protocols, not code); Voyager is a 3rd path. The decision for `memory.skills(repoId)` is fundamentally a Q5 / D4 choice — see Recommendations.

#### (d) Empirical anchor + domain claim from the [survey "Memory for Autonomous LLM Agents"](https://ar5iv.labs.arxiv.org/html/2603.07670) (snapshot `56c7d4bf...`)

**The 15.3× claim verbatim (Survey §2.4):**
> "Voyager without its skill library lost 15.3× in tech-tree milestone speed—the skill library *was* the performance."

**Domain claim for code-agents (Survey §6.8) — THE missing anchor for TheMemory v0.6:**
> "Software engineering agents lean heavily on procedural memory (verified code patterns and architecture decisions)."

And §6.2 supplementary:
> "Coding agents...Memory requirements are steep: retain architecture decisions, track bug report histories, remember code-style preferences."

The survey cites CoALA directly as the foundation: "a generalized blueprint where working, episodic, semantic, and procedural stores interact through a central executive (the LLM), directly echoing Baddeley's model" (Survey §3.1).

**Adjacent findings from the survey relevant to other roadmap items (NOT v0.6):**

- §5.5: "Nobody evaluates forgetting well. Only MemoryAgentBench tests selective forgetting explicitly." → relevant for v0.4b forgetting + v0.8 benchmarks (MemoryAgentBench is a candidate benchmark we missed in CLAUDE.md roadmap).
- §6.1 Ebbinghaus integration: "MemoryBank models memory decay via Ebbinghaus forgetting curves: frequently accessed, high-importance memories are reinforced, while neglected ones fade." → reinforces v0.4b approach.
- §9.1 hot/cold consolidation: "newly formed memories reside in a 'hot' buffer during a probation period and are promoted to long-term storage only after passing quality checks." → applies to v0.4a refinement (we currently skip the probation tier).
- §5.2-5.3 evaluation: 4 benchmarks (LoCoMo, MemBench, MemoryAgentBench, MemoryArena) — **NONE explicitly tests procedural memory**. v0.6 acceptance will need to define its own metric (or pick a coding-agent SWE-bench variant — see Q7).

### Mem0 `memory-dream` consolidation pattern — REUSE-or-sibling decision (Q5 / D4)

**Pattern source:** `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md` (151 lines, single-file skill, `user-invocable: true`).

**memory-dream protocol shape (4 phases per the SKILL.md body):**

| Phase | Action | Citation |
|---|---|---|
| 1. Orient | `memory_list` → count by category → identify oldest/newest → spot problems WITHOUT modifying | `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md:62-71` |
| 2. Gather Targets | `memory_search` with `created_at` filter → classify each candidate as **DELETE / MERGE / REWRITE** | `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md:73-84` |
| 3a. Delete | `memory_delete` for credentials, expired TTL, raw tool output, heartbeats, generic acks; operational > 7 days, project > 90 days | `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md:89-99` |
| 3b. Merge | Pick base → `memory_update` to absorb missing details → `memory_delete` redundant; preserve temporal anchors + user words; ≤ 50 words | `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md:100-113` |
| 3c. Rewrite | `memory_update` for vague / wrong-category / over-50-words entries | `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md:116-126` |
| 4. Report | Structured summary: reviewed / deleted (cred/expired) / merged / rewritten / final count / issues | `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md:128-141` |

**Consumer call-sites (Fase A grep on `mem0/openclaw/`):**

- `.claude/knowledge-base/references/mem0/openclaw/skill-loader.ts:264` — `if (skillName === "memory-triage" || skillName === "memory-dream")` — both treated as auto-injectable skills
- `.claude/knowledge-base/references/mem0/openclaw/skill-loader.ts:460` — `const dream = loadSkill("memory-dream", config);` — loaded by the plugin at config time
- `.claude/knowledge-base/references/mem0/openclaw/cli/commands.ts:1827` — CLI error path: "Dream skill file not found at skills/memory-dream/SKILL.md"

memory-dream is **NOT a programmatic API**; it's a Markdown protocol loaded by the openclaw plugin and invoked by the user (or auto-injected). The "execution" is performed by Claude Code (or whichever LLM agent host loads the skill) by following the protocol against the `memory_*` tool catalog. No code executes — the LLM IS the executor.

**TheMemory v0.4a chain (for compatibility check) at `src/local/index.ts`:**

```
LocalScopedMemory.reflect(scope)
  → vectorStore.list(filters, 100)              # fetch source memories
  → executeReflection({llm, sourceMemories})    # LLM extracts higher-order facts
  → validateProvenance(drafts, sourceIds)       # ensures every draft cites real sources
  → for each draft: insertDerivedMemory({...})  # persist as new row with derived_from FK
  → ReflectionResult { higherOrderMemories[], sourceIds[], derivedMemoriesCreated }
```

Cited at `src/local/index.ts:57-58` (imports), `:230` (executeReflection call), `:253` (validateProvenance), `:269` (insertDerivedMemory). `ReflectionResult` shape at `src/core/reflection-result.ts`.

#### Compatibility analysis — D4 decision tree

memory-dream and TheMemory v0.4a `Memory.reflect()` are **fundamentally different consolidation shapes:**

| Aspect | TheMemory `reflect()` (v0.4a) | Mem0 memory-dream | v0.6 skill consolidation requirement |
|---|---|---|---|
| Output | NEW derived rows (`kind='derived'`, with `derived_from` FK to sources) | DELETE/MERGE/REWRITE of EXISTING rows (in-place mutation) | NEW merged skill row with `derived_from = [oldSkill1.id, oldSkill2.id]` |
| Source preservation | YES — sourceIds tracked + sources remain | NO — sources deleted or rewritten over | MUST preserve sources for audit / rollback |
| Pattern | BUILD UP (new abstraction layer) | CLEAN LATERALLY (same layer, fewer/cleaner rows) | BUILD UP (per v0.6 acceptance test) |
| Provenance | `sourceIds[]` returned in `ReflectionResult` + `derived_from` JSONB column | None — operations are tracked only via Mem0's history (edit log) | MUST have explicit `derived_from` (per CLAUDE.md roadmap item 8 acceptance) |
| Execution | Deterministic pipeline (TS code) | Markdown protocol consumed by external LLM | Either acceptable — but TS pipeline is the established TheMemory shape |

**CLAUDE.md v0.6 acceptance test (verbatim from roadmap):**
> "Refactoring test consolidates 2 syntactically-different but semantically-equivalent skills into 1 with both source IDs in `derived_from`."

This acceptance criterion was DESIGNED around TheMemory v0.4a's `sourceIds` + `derived_from` mechanism, NOT around memory-dream's in-place edit pattern.

#### D4 verdict: **REUSE v0.4a `Memory.reflect()` chain for skills, with three minimal extensions**

The decision is REUSE (not sibling). Rationale:

1. **The v0.6 acceptance test was authored around the v0.4a shape** — `sourceIds[]` + `derived_from` are the contract.
2. **Provenance is non-negotiable for code-as-skill** — engineering agents need audit trail (who derived this skill from what — Survey §6.8 "verified code patterns and architecture decisions" requires verifiability).
3. **memory-dream's in-place rewrite breaks rollback** — losing source skills means a bad consolidation cannot be undone; v0.4a's append-only model preserves rollback by construction.
4. **memory-dream's protocol orchestration (Orient → Gather → Consolidate → Report) is borrowable as the CALLER pattern** — not as the storage pattern. Wrap `Memory.reflect()` in a scoped orchestrator that mirrors the 4 phases.

**Three extensions needed on the existing chain:**

| Extension | Why | Implementation sketch |
|---|---|---|
| Skill payload fields | Skills carry `code: string` + `description: string` (per Voyager Q3) on top of the generic `text` field | Add `kind = 'skill'` discriminator + `payload: { code, description }` to MemoryItem; reuse the existing pgvector schema (already has `kind` per v0.4a migration) |
| Versioning / supersession (Voyager pattern) | When `reflect()` produces a consolidated skill from two sources, mark old skills `superseded_by = newSkill.id` rather than deleting | Add `superseded_by UUID NULL` column; default `recall()` filter excludes `superseded_by IS NOT NULL`; `recall({ includeSuperseded: true })` opt-in for audit |
| 4-phase orchestrator wrapper (memory-dream pattern) | `memory.skills(repoId).consolidate()` runs Orient → Gather → ReflectChain → Report cycle | New file `src/local/skills/consolidate.ts` calls `memory.reflect()` internally; protocol orchestration in TS, NOT as a Markdown protocol |

**Architectural fit (cycle-discover.md hard gate #7 — Rule 9 verdict required for D4):** REUSE is the Rule 9-honest choice — reflection chain ships, has tests, is provenance-correct. Inventing a sibling violates Inquebrável Rule 9 ("Não Reinvente"). The 3 extensions are additive (no breaking changes to existing `Memory.reflect()` consumers).

---

## Coverage Corner 5 — Prior Art

> Scope: Rule 9 evaluation of candidate libraries + benchmark survey for v0.6 acceptance.


### Q6 — Rule 9 dependency-candidate evaluation (ADOPT / REJECT / DEFER / CONCEPTUAL_BORROW)

WebSearch verification (2026-05-29) updated the candidate landscape — Mem0 and LangMem both ship some form of procedural memory by 2026. The "no one shipped this as infra" claim in CLAUDE.md roadmap Item 8 is now **stale** and should be revised (see Recommendations below).

| Candidate | Ecosystem | Released | License | Procedural memory shape | Rule 9 verdict (per ADR D5) | Rationale |
|---|---|---|---|---|---|---|
| **Voyager** (canonical impl) — [github.com/MineDojo/Voyager](https://github.com/MineDojo/Voyager) | Python | 2023 (research code; not actively maintained as product) | MIT (per repo LICENSE) | **Executable JS code** stored in ChromaDB; iterative-prompting refinement; V2/V3 versioning supersession | **CONCEPTUAL_BORROW** | Pattern (code-as-skill + version supersession) is the borrow — translated to TS in v0.6 per ADRs D1+D2+D3. Direct adoption rejected: research code, Minecraft-specific, Python (ecosystem mismatch per D5), unmaintained for product use. |
| **LangMem** — [github.com/langchain-ai/langmem](https://github.com/langchain-ai/langmem) (npm: NONE; PyPI: `langmem`) | Python | Q1 2025 (active — recent releases) | MIT (per LICENSE) | **Prompt rewriting** (`metaprompt`, `gradient`, `prompt_memory` algorithms) — agent modifies its own system instructions; tightly coupled to LangGraph storage | **CONCEPTUAL_BORROW + REJECT for direct adoption** | (a) Different paradigm (prompt-as-skill, not code-as-skill — see D2); (b) Python ecosystem (D5 mismatch); (c) LangGraph storage coupling. Honest cross-reference value: study LangMem's `metaprompt` + `gradient` algorithms for future `SkillRepresentationStrategy` DIP variants targeting the prompt-rewriting representation. p95 LOCOMO latency 59.82s ([atlan.com 2026 benchmarks](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)) is too slow for our retrieval SLO anyway. |
| **mem0ai** — [npmjs.com/package/mem0ai](https://www.npmjs.com/package/mem0ai) | TypeScript (also Python `mem0ai` on PyPI) | 2023+ (active — v3.0.3 published 2026-05-14) | Apache-2.0 (per `.claude/knowledge-base/references/mem0/CLAUDE.md` Project Overview) | **`memory_type='procedural_memory'`** parameter on `Memory.add(...)` — stores step-by-step procedures and workflows as text records | **REJECT for adoption + ADOPT-as-reference** | TheMemory IS the runtime layer (per CLAUDE.md § Locked names — "managed three-tier memory layer of usetheo ecosystem"). Adopting mem0ai as our backend would INVERT our positioning — we'd become a wrapper instead of the product. Mem0 is a **competitor** at the same abstraction layer, not a dep. The procedural_memory type is worth studying for parity (does our `kind='skill'` cover their use cases?) but not for code reuse. |
| **Mem0 "Skills Standard"** — published via `mem0-plugin/skills/` + openclaw skills + `npx skills add` integration | Cross-ecosystem (Claude Code, Cursor, Codex, OpenCode, Windsurf, OpenClaw consumers) | 2026 (recent — per WebSearch findings) | Apache-2.0 (downstream of Mem0) | Markdown protocols + frontmatter (per Q3 finding); user-invocable + auto-injected variants | **CONCEPTUAL_BORROW for interop** | The standard shape is worth honoring for cross-tool interop: if v0.6 skills can ALSO be loaded by Claude Code via the same `skills add` convention, TheMemory becomes part of a wider ecosystem. Frontmatter shape per Q3 (`name`, `description`, `user-invocable`, `metadata.openclaw.requires.env/bins`) is candidate format for our v0.6 `SKILL.md` if we expose a serialization. NOT a dep — a serialization-format target. |

**Aggregate Rule 9 finding:** ZERO candidates are ADOPT verdict; all are CONCEPTUAL_BORROW or REJECT. This matches CLAUDE.md's positioning of TheMemory as the **product layer** for procedural memory — we don't consume a memory lib, we ARE the memory lib. The borrowed patterns (Voyager's code+version+ChromaDB triad; memory-dream's 4-phase orchestration; LangMem's prompt-rewriting algorithms for future strategy variants; Mem0 Skills Standard for interop) inform our DESIGN but do not enter as runtime deps.

**Roadmap correction surfaced:** CLAUDE.md roadmap Item 8 description says _"Voyager-style skill library...no one shipped this as infra"_. WebSearch 2026-05-29 confirms (a) Mem0 ships `memory_type='procedural_memory'` + Skills Standard since 2026 Q1; (b) LangMem ships procedural memory via prompt rewriting since 2025 Q1. The "no one shipped this as infra" claim should be **revised** to _"no one shipped a **code-as-skill** procedural memory **with full provenance + versioning** as infra"_ — that IS still the differentiator (Voyager is research code; LangMem is prompt rewriting; Mem0's procedural_memory is text records without code-exec semantics). The honest framing: v0.6 ships **code-as-procedural-memory + provenance + supersession** as the first product-grade implementation.

### Q7 — Skill-library benchmark survey for v0.6 acceptance test

WebSearch 2026-05-29 surfaced 5 candidate benchmarks. Top 3 ranked by fit for v0.6 acceptance criteria (CLAUDE.md Item 8: "TheoCode integration test producing ≥ 1 skill artifact, subsequent run retrieves + reuses, refactoring test consolidating 2 syntactically-different but semantically-equivalent skills").

| Rank | Benchmark | Citation | Dataset shape | Reuse metric | Fit for v0.6 acceptance (Y/N + rationale) |
|---|---|---|---|---|---|
| 1 | **SWE-Skills-Bench** ([arXiv 2603.15401](https://arxiv.org/abs/2603.15401), snapshot `56b58284...`) | Real-world SWE tasks paired with **markdown skill packages** (matches our Q3 + Q6 finding on Mem0 Skills Standard format) | +N% solve rate when skill subset is injected vs baseline (reports +30% with 7-skill subset on specialized procedural knowledge: financial risk formulas, cloud-native traffic management, GitLab CI patterns) | **YES — PRIMARY FIT.** Direct test of "skill X improves solve rate on task Y" — exactly v0.6's claim. The benchmark's "skill = markdown package" definition is interoperable with our v0.6 format (per ADR D2 with code body + description; markdown wrapper around code is straightforward). The +30% headline gives us a target. **Caveat:** this benchmark tests INJECTION (skill loaded as context), NOT RETRIEVAL (skill found by embedding search) — v0.6 acceptance needs to extend with retrieval evaluation. |
| 2 | **SkillLearnBench** ([arXiv 2604.20087](https://arxiv.org/abs/2604.20087)) | Continual learning of skill GENERATION (not just consumption) — code-based AND natural-language workflow variants | Skill-generation quality + retention over time | **PARTIAL — secondary.** Tests skill creation cycle (closer to our `consolidate()` orchestrator from D1) AND distinguishes "code-based skill libraries" vs "natural-language workflows" — directly validates our D2 design space. Use as cross-reference for v0.6.1 ProcMEM-strategy work. |
| 3 | **SWE-Bench-CL** ([arXiv 2507.00014](https://arxiv.org/abs/2507.00014)) | SWE-Bench Verified issues organized in **chronological sequences** — tests knowledge accumulation, transfer, catastrophic forgetting | Sequential pass@k + retention measure | **CROSS-POLLINATES** to v0.4b (forgetting) more than v0.6. Worth citing as evidence that "memory + skills + forgetting" intersect, but not the right primary benchmark for v0.6. Logged for v0.4b discovery follow-up. |

**Secondary benchmarks surveyed** ([SWE-EVO arXiv:2512.18470](https://arxiv.org/abs/2512.18470), [SWE-CI arXiv:2603.03823](https://arxiv.org/abs/2603.03823)) — both evaluate code-agent quality on long-horizon evolution / continuous integration, NOT skill reuse specifically. Out of scope for v0.6 acceptance but logged.

**Cross-reference with Survey §5.2-5.3 finding (Q4):** the survey enumerated 4 memory benchmarks (LoCoMo, MemBench, MemoryAgentBench, MemoryArena) — NONE explicitly tests procedural memory. SWE-Skills-Bench fills that exact gap from the code-agent side. The two benchmark families (memory benchmarks + SWE skill benchmarks) currently DO NOT OVERLAP — v0.6 acceptance test is the bridge.

**v0.6 acceptance test design recommendation:** Use SWE-Skills-Bench as the primary external validation; complement with an internal TheoCode integration test (per CLAUDE.md acceptance criterion). Internal test gates v0.6 release; SWE-Skills-Bench score gates v0.8 benchmark milestone (roadmap Item 10).

---

## Cross-cutting Comparison

Synthesis across all 7 questions. Citations point back to the corner section that established each cell.

| Dimension | Voyager | CoALA (theory) | Mem0 openclaw (Node) | LangMem (Python) | ProcMEM (theory) | **TheMemory v0.6 (proposed)** |
|---|---|---|---|---|---|---|
| Procedural-memory framing | Canonical exemplar (per CoALA Corner 4§b) | Defines procedural = "explicit knowledge written in agent's code" (Corner 4§b) | Skills = markdown protocols loaded by Claude Code (Corner 3) | Procedural = prompt-rewriting via `metaprompt` / `gradient` / `prompt_memory` (Corner 5 Q6) | NL 3-tuple (Activation + Execution + Termination) per Corner 4§c | **Code-as-skill with provenance + versioning** (per ADR D1+D2) |
| Skill format | Executable JS code + description in ChromaDB (Corner 3) | Implicit (LLM weights) OR explicit (agent code) (Corner 4§b) | Markdown skill = directory with `SKILL.md` + optional `domains/` + `recall-protocol.md` (Corner 3) | Updated prompt fragments, no separate skill artifact (Corner 5 Q6) | NL spec (no code) (Corner 4§c) | TS code body + description string + version + superseded_by FK (ADRs D2+D3) |
| Refinement loop | 4-iteration critic loop; on success → add (Corner 4§a Pseudocode 1) | Conceptual: "updating grounding" (Corner 4§b) | 4-phase orchestration: Orient → Gather → Consolidate → Report (Corner 4 Q5) | Reflection-based prompt mutation (Corner 5 Q6) | Non-parametric PPO: hindsight attribution → trust-region gate (Corner 4§c) | REUSE v0.4a `Memory.reflect()` chain + 4-phase orchestrator wrapper (ADR D1) |
| Persistence | Filesystem 4-store layout: `vectordb/`, `code/`, `description/`, `skills.json` (Corner 3) | N/A (theory) | Filesystem markdown loaded at plugin startup (Corner 3) | LangGraph BaseStore (Python-coupled) (Corner 5 Q6) | Score-based pool (in-memory or external) (Corner 4§c) | pgvector + Drizzle row in existing `memories` table; `kind='skill'` (ADR D3) |
| Indexing for retrieval | ChromaDB similarity_search top-5 by description embedding (Corner 4§a) | Dense retrieval (CoALA quote Corner 4§b) | NONE built-in — plugin loads all skills at startup (Corner 3) | LangGraph store with namespace scoping (Corner 5 Q6) | Embedding-based (per ProcMEM paper) | pgvector cosine similarity via existing `recall()` + `kind='skill'` filter (D3) |
| Provenance / audit | V2/V3 versioning + supersession on disk (Corner 3) | Implicit | None — protocols mutate via `memory_update` (Corner 4 Q5) | None explicit (Corner 5 Q6) | None explicit (Corner 4§c) | `derived_from[]` JSONB + `superseded_by` UUID FK (ADRs D1+D3) — **THE differentiator per Q6 aggregate finding** |
| Ecosystem fit (ADR D5) | Python research (Minecraft env) | Theory | **Node** (TS — anchor) | Python (cross-ecosystem) | Theory | **TypeScript-first (TheoKit native)** |

## ADRs

### D1 — REUSE v0.4a `Memory.reflect()` chain for skill consolidation; reject sibling

**Decision:** TheMemory v0.6 skill consolidation will REUSE the existing `Memory.reflect()` pipeline (`executeReflection() + validateProvenance() + insertDerivedMemory()`), extended with three additive mechanisms: skill-specific payload fields (`code`, `description`), Voyager-style versioning + supersession (`superseded_by` column), and a 4-phase orchestrator wrapper inspired by Mem0 memory-dream (Orient → Gather → Consolidate → Report). NO sibling reflection chain is built.

**Rationale (grounded in Q5 findings):**
- v0.6 acceptance test in CLAUDE.md roadmap specifies "both source IDs in `derived_from`" — that's the v0.4a `sourceIds[]` shape verbatim, NOT Mem0's in-place rewrite shape.
- Survey §6.8 "Software engineering agents lean heavily on procedural memory (verified code patterns and architecture decisions)" requires audit trail; v0.4a's append-only model preserves rollback by construction, memory-dream's mutation pattern does not.
- Mem0 memory-dream's value is the 4-phase ORCHESTRATION protocol (Orient/Gather/Consolidate/Report), borrowable at the CALLER layer; its in-place mutation shape is the WRONG storage pattern.
- Inquebrável Rule 9 (Não Reinvente): the chain ships, has 416 tests, is provenance-correct. Building a sibling would duplicate scaffolding for no gain.

**Alternatives considered + rejected:**
- *Ship sibling reflect chain dedicated to skills* — rejected; duplicates scaffolding, breaks DIP boundary, no provenance gain.
- *Adopt Mem0 memory-dream in-place mutation* — rejected; loses rollback, breaks v0.6 acceptance test contract, contradicts Inquebrável Rule 7 (every fix needs regression test → mutated row can't yield "before" state).
- *Adopt ProcMEM-style NL-spec skills as primary representation* — deferred to D2; orthogonal to D1's storage-pattern decision. (See D2.)

**Consequences:**
- v0.6 implementation plan inherits v0.4a contract: `ReflectionPolicy` DIP, `ScoringStrategy` DIP, the embed→extract→provenance→persist pipeline.
- New work limited to: (a) `kind='skill'` discriminator + `payload: {code, description}` per MemoryItem; (b) `superseded_by` UUID column + filter in `recall()`; (c) `src/local/skills/consolidate.ts` orchestrator that wraps `Memory.reflect()` in the 4-phase memory-dream protocol.
- The `memory.skills(repoId)` public API is a thin layer over the existing ScopedMemory; `.skills(repoId).consolidate()` calls the new orchestrator.
- TDD pyramid extension (per `testing.md`): the v0.6 unit-test pattern matches Q1's Letta `test_letta_agent_v2_skills.py` shape — structural rendering + non-persistence guards on the orchestrator; the integration-test layer exercises end-to-end consolidation against pgvector.

### D2 — Skill representation: code-as-skill (Voyager pattern); ProcMEM NL-spec deferred to v0.6.1+

**Decision:** v0.6 ships skills as **executable code** (Voyager pattern), stored with a description embedding. ProcMEM's NL-spec 3-tuple (Activation + Execution + Termination) is an interesting alternative but deferred to a future v0.6.1+ as a `SkillRepresentationStrategy` DIP variant.

**Rationale (grounded in Q4 + Q3 findings):**
- TheMemory's primary consumer is TheoCode (coding agent — CLAUDE.md Item 8 "Natural alignment with TheoCode"). Coding agents NEED code skills, not NL specs of code — the LLM already speaks code; an NL→code re-derivation step adds error surface.
- Voyager's `(retrieval store) + (exec runtime in separate process)` pattern (Q2 finding) translates cleanly to `node:vm` or child-process worker.
- Mem0 openclaw skill format (Markdown protocols) is a 3rd path (LLM-as-executor), but openclaw skills are READ-ONLY protocols loaded by Claude Code — not write/refactor candidates. Mismatch.
- ProcMEM's NL spec shines in bounded sequential decisions (its experimental domain — Q4 finding); v0.6's domain is open-ended code agent. Different fit.

**Alternatives considered + rejected:**
- *Mem0 openclaw Markdown protocols as primary skill format* — rejected; openclaw skills are protocols, NOT executable; would force TheoCode to interpret rather than invoke.
- *ProcMEM NL 3-tuple as primary* — deferred (not rejected); good fit for some domains. Wire as a `SkillRepresentationStrategy` DIP if v0.6.1 surfaces demand.
- *Hybrid Voyager-code + ProcMEM-NL fields per row* — rejected for v0.6; adds coupling without proven demand.

**Consequences:**
- Skill payload schema: `{ code: string, description: string, codeLanguage: 'typescript' | 'javascript' }`.
- Description field is the embedding target (per Voyager Q4 finding — embedding of description, code as value).
- Exec runtime is OUT OF SCOPE for v0.6 storage layer — consumer of `memory.skills(repoId)` decides exec strategy (TheoCode wires `node:vm` or worker; other consumers may not exec at all).
- Future `SkillRepresentationStrategy` DIP slot (6th + 1 DIP) reserved for ProcMEM-style variants.

### D3 — Skill library indexing: REUSE existing pgvector + Drizzle; reject Voyager's 4-store filesystem layout

**Decision:** Skill library reuses TheMemory's existing pgvector + Drizzle schema. NO separate `{ckpt_dir}/skill/{vectordb,code,description}/` filesystem layout (Voyager pattern from Q3).

**Rationale:**
- Voyager's 4-store layout is filesystem-coupled + presumes single-tenant. TheMemory v0.5+ ships TheoCloud (multi-tenant) — the relational schema is non-negotiable.
- pgvector already handles the vector retrieval; Drizzle ORM handles the SQL. Single store, single transaction, no consistency-invariant maintenance burden (Voyager asserts `vectordb._collection.count() == len(self.skills)` because two stores diverge; we sidestep that).
- The existing `memories` table extends naturally with `kind='skill'`, `code` + `description` payload fields, and `superseded_by` (D1).

**Alternatives considered + rejected:**
- *Voyager filesystem layout adopted verbatim* — rejected; multi-tenancy + single-tenant filesystem incompatible.
- *Separate `skills` table* — rejected (KISS); `kind` discriminator on the existing `memories` table avoids JOIN proliferation.

**Consequences:**
- Migration adds `superseded_by UUID NULL` + payload extension for `kind='skill'` rows.
- `recall()` default behavior unchanged; new opt-in `recall({ includeSuperseded: true })` and `recall({ onlySkills: true })`.
- Aligns with `architecture.md` § DIP boundaries (no new store, no new DIP unless ProcMEM strategy lands).
-->

## Recommendations for TheMemory

EC-7 check honored: Q5 cited + REUSE-vs-sibling verdict (D4 in plan) emitted explicitly in ADR D1 above.

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | **REUSE v0.4a `Memory.reflect()` chain for v0.6 skill consolidation; reject sibling.** Extend additively with: (a) `kind='skill'` discriminator + `payload: {code, description}`, (b) `superseded_by UUID NULL` column for Voyager-style versioning, (c) `src/local/skills/consolidate.ts` 4-phase orchestrator wrapper (Orient → Gather → Consolidate → Report). | Q5; ADR D1; Inquebrável Rule 9; `architecture.md` § DIP boundaries | **HIGH** — gates v0.6 implementation plan |
| 2 | **Ship skills as TypeScript executable code (Voyager pattern), with description string as embedding target.** Defer ProcMEM-style NL-spec representation to v0.6.1+ via a `SkillRepresentationStrategy` DIP slot. | Q3, Q4§a, Q4§c; ADR D2; CLAUDE.md Item 8 acceptance criterion | **HIGH** — defines API shape |
| 3 | **Reuse pgvector + Drizzle schema — NO separate skill store.** Add migration: `kind='skill'`, `code`, `description`, `superseded_by`. `recall()` gains opt-in `includeSuperseded` + `onlySkills` filters. | Q3 (Voyager 4-store rejection); ADR D3 | **HIGH** — schema decision blocks implementation |
| 4 | **Update CLAUDE.md roadmap Item 8 description** to remove the stale "no one shipped this as infra" claim. New framing (honest 2026-05-29 state): *"v0.6 ships code-as-skill procedural memory with full provenance + versioning as infra — Mem0 + LangMem ship procedural memory in adjacent shapes (text records / prompt rewriting) but neither carries code-exec semantics + provenance."* | Q6 aggregate finding; survey §6.8 | **HIGH** — public-copy honesty per `public-copy.md` § 6 |
| 5 | **Use [SWE-Skills-Bench (arXiv:2603.15401)](https://arxiv.org/abs/2603.15401) as the external validation target for v0.8 benchmark milestone.** Internal TheoCode integration test gates v0.6; SWE-Skills-Bench score gates v0.8 (per roadmap Item 10). Note the +30% headline as our target floor; design our test to also measure RETRIEVAL quality (the benchmark only tests INJECTION). | Q7; CLAUDE.md Item 10 | **MEDIUM** — applies after v0.6 ships |
| 6 | **Borrow Mem0 "Skills Standard" frontmatter shape** (`name`, `description`, `user-invocable`, `metadata`) as serialization format for v0.6 skill artifacts to enable interop with Claude Code / Cursor / Codex / OpenClaw ecosystems. Add `metadata.theomemory.{provenance, version, superseded_by}` extension to carry our differentiator. | Q3, Q6 CONCEPTUAL_BORROW for interop verdict | **MEDIUM** — enables ecosystem reach |
| 7 | **Borrow Mem0 memory-dream 4-phase orchestration (Orient → Gather → Consolidate → Report) as PROTOCOL for `consolidate()`, NOT as storage pattern.** Implement as TS pipeline calling `Memory.reflect()` internally; observability per `architecture.md` § OTel tracer. | Q5; ADR D1; `architecture.md` § Telemetry | **MEDIUM** — UX of consolidation cycle |
| 8 | **Log cross-pollination findings to other roadmap items.** v0.4b (forgetting): MemoryBank Ebbinghaus reference + SWE-Bench-CL benchmark; v0.4a (refinement): hot/cold buffer pattern from survey §9.1; v0.8 (benchmarks): MemoryAgentBench candidate (only one testing selective forgetting per survey §5.5). Open follow-up discovery plans per the broader literature direction. | Survey §5.5, §6.1, §9.1; Q7 | **LOW** — backlog tracker |
| 9 | **Do NOT adopt mem0ai as a runtime dependency.** TheMemory is the product layer; adopting Mem0 would invert positioning (we'd become a wrapper). Study `memory_type='procedural_memory'` parity for our `kind='skill'` to ensure feature coverage; do not import. | Q6 aggregate finding; CLAUDE.md § Locked positioning | **HIGH** (decision-record value) |

### Q5 / D4 verdict re-stated (EC-7 ordering check)

> **REUSE the v0.4a `Memory.reflect()` chain with 3 additive extensions; do NOT ship a sibling chain.** Full rationale + alternatives + consequences in ADR D1 above. Citation: Q5 finding that v0.4a chain (`executeReflection() + validateProvenance() + insertDerivedMemory()`, cited at `src/local/index.ts:57-58, 230, 253, 269`) matches CLAUDE.md v0.6 acceptance test (`derived_from = [...]`) verbatim; Mem0 memory-dream's in-place mutation pattern breaks rollback + violates the acceptance contract.

## Blocked questions (if any)

**None.** All 7 research questions answered with citations across 7 iterations. No `BLOCKED` markers in the blueprint.

| Question | Reason | Suggested human follow-up |
|---|---|---|
| _(none — all questions answered)_ | — | — |

## Halt-loop progress (audit trail)

- Iterations used: 7 / 20
- Questions answered: 7 / 7
- Questions blocked: 0
- Citations verified: ~50 (local Path.exists() OK + 7 URL snapshots)
- Snapshots written: 7 under `.claude/knowledge-base/discoveries/snapshots/voyager-skill-library/`
- Web budget used: 3 WebSearch / 11 WebFetch (of 15 / 25 max)
- Allowlist additions 2026-05-29 (with rationale per loop): `raw.githubusercontent.com`, `api.github.com`, `ar5iv.labs.arxiv.org`
- ADRs synthesized: D1 (REUSE chain), D2 (code-as-skill primary), D3 (REUSE schema)
- Q5 / D4 verdict: REUSE_WITH_EXTENSIONS (3 additive)
- Roadmap correction surfaced: CLAUDE.md Item 8 "no one shipped this as infra" stale by 2026-05-29
- Promise emitted at iteration: 7

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/voyager-skill-library-plan.md` (v1.2)
- Edge-case review: `.claude/knowledge-base/reviews/voyager-skill-library-edge-cases-2026-05-29.md`
- Snapshots dir: `.claude/knowledge-base/discoveries/snapshots/voyager-skill-library/`
- Confidence report: TBD (generated by `/discover-confidence`)
- Linked TheMemory rules: `.claude/rules/architecture.md` (DIP boundaries), `.claude/rules/testing.md` (TDD pyramid), `.claude/rules/discover-web-allowlist.txt`, `.claude/rules/cycle-discover.md` v1.1 (5-corner Coverage Matrix)
