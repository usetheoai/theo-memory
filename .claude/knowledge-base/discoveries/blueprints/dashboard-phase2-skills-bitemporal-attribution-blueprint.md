# Blueprint: Dashboard Phase 2 — Skills, Bi-temporal, Attribution-write

> **Version 1.0** — Synthesizes how the in-tree references **Mem0** and **Letta** model + persist + test + expose three advanced capabilities (procedural/code-as-skill memory, temporal/point-in-time access, multi-actor attribution-on-write) to inform how the theo-cloud dashboard Phase 2 should surface TheMemory's own equivalents. Key outcome: **attribution-write** and **bi-temporal `asOf`** are **wiring-only** (no new TheMemory REST endpoint — `RememberBody.attributedTo` + `RecallBody.asOf` already exist); **skills** need a NEW REST surface (skill verbs + listing are SDK-only, `501` on REST today) and stay **FROZEN under P0** pending owner unfreeze. LangMem was NOT investigated (not cloned into `.claude/knowledge-base/references/`; only `mem0` + `letta` present) — the procedural-memory corner is covered by Letta's tool subsystem instead.

**Slug:** `dashboard-phase2-skills-bitemporal-attribution`
**Source plan:** `.claude/knowledge-base/discoveries/plans/dashboard-phase2-skills-bitemporal-attribution-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-06-19 via `/discover-execute` (executed in-context per `loop-engine-convention.md § most-constrained-mechanism` — the 7-question / 2-reference scope fits one context; output contract identical to the ralph-loop path: verified citations, 4 corners, ADRs, post-promise citation check)
**Confidence verdict:** SHIPPABLE (98.5/100, 0 caps, 13/13 citations verified, 4/4 corners — `/discover-confidence` 2026-06-19)

## Context

Inherited from the discovery plan: the `theo-memory-dashboard-full-integration` cycle (READY_TO_MERGE 2026-06-19) deferred skills (Repo tier), bi-temporal `asOf`, and attribution-write as explicit NON-GOALs. This blueprint investigates how Mem0/Letta solved the analogous problems so Phase 2 design is evidence-based, and decides per capability whether a new TheMemory REST endpoint is needed or only gateway-BFF + dashboard wiring. Respects `.claude/rules/architecture.md` (HTTP-seam: browser → gateway BFF → TheMemory REST) and the P0 freeze (CLAUDE.md Rule 10 — skills research-only).

## Objective

Decide, per capability, the dashboard UX + the gateway/REST surface change required (new endpoint vs wiring) + the dependency/test cost.

---

## Coverage Corner 1 — Integration Tests

### Mem0

How Mem0 tests the temporal/history path (the corner relevant to our `asOf`):

- **Pattern**: pytest class-based tests against a real `SQLiteManager`; asserts the history **audit table schema** explicitly (column-set equality) then exercises `add_history`. Cite `.claude/knowledge-base/references/mem0/tests/memory/test_storage.py:70` (`test_table_schema_creation` — `PRAGMA table_info(history)` → `assert columns == expected_columns`) + `:92` (`test_add_history_basic`).
- **Fixtures**: `sqlite_manager` + `sample_data` fixtures; real on-disk SQLite, no mock of the storage layer (`test_storage.py:58` `test_initialization` asserts `manager.connection is not None`).
- **Coverage**: locks the history table's column contract (ordering + immutability of the audit shape) — the invariant a "memory timeline" UI would depend on.

### Letta

How Letta tests the procedural/skill (tool) execution path (the corner relevant to our skills browser):

- **Pattern**: async integration tests wiring REAL sandbox configs (E2B + Local) with deterministic uuid5 org/user fixtures. Cite `.claude/knowledge-base/references/letta/tests/integration_test_async_tool_sandbox.py:28` (`from letta.services.tool_sandbox.e2b_sandbox import AsyncToolSandboxE2B`) + `:29` (`AsyncToolSandboxLocal`) + `:35` (uuid5 org fixture).
- **Fixtures**: `SandboxConfig` / `SandboxEnvironmentVariable` ORM objects + `SandboxConfigManager` (`:17`, `:26`); the LOCAL sandbox path runs without cloud deps.
- **Coverage**: proves create-tool → execute-in-sandbox end-to-end; the EXECUTION half (not needed for a read-only skills browser) is what pulls the heavy deps.

### LangMem

N/A — not cloned into `.claude/knowledge-base/references/` (only `mem0` + `letta` present). Procedural-memory corner covered by Letta above.

---

## Coverage Corner 2 — Dependencies

### Letta (skills execution vs read-only browse)

| Dependency | Version | Why | Citation |
|---|---|---|---|
| `e2b-code-interpreter` | `>=1.0.3` | cloud sandbox EXECUTION of code-as-skill | `.claude/knowledge-base/references/letta/pyproject.toml:132` (under `cloud-tool-sandbox` extra) |
| `modal` | `>=1.1.0` | alternative sandbox EXECUTION backend | `.claude/knowledge-base/references/letta/pyproject.toml:133` (`modal` extra) |

**Load-bearing finding (EC-4):** both sandbox backends live under `[project.optional-dependencies]` (`pyproject.toml:87`), NOT core. A dashboard skills **BROWSE** surface (list/inspect, no execution) inherits **zero** sandbox deps — it only reads tool rows (name + source_code + json_schema). Execution is a separate, opt-in concern we are NOT planning for Phase 2.

### Mem0

Temporal/history needs no extra dep — `history()` reads the existing SQLite/store history table (`.claude/knowledge-base/references/mem0/mem0/memory/storage.py:17` `_create_history_table`). No new runtime dependency for a history/timeline view.

### LangMem

N/A (not cloned).

---

## Coverage Corner 3 — Tools

### Mem0

- **Build / test / lint**: `Makefile` targets `install` / `format` / `sort` / `lint` / `build` / `publish` (`.claude/knowledge-base/references/mem0/Makefile:8-36`). Default `all: format sort lint`.
- **Local dev story**: a standalone server stack ships at `.claude/knowledge-base/references/mem0/server/docker-compose.yaml` (exists) for the REST server form.

### Letta

- **Local dev story**: `compose.yaml` wires `ankane/pgvector:v0.5.1` as the DB (`.claude/knowledge-base/references/letta/compose.yaml:3`) + the `letta/letta:latest` app (`:24`) + an nginx front (`:61`). **Notably the SAME pgvector image our `tests/e2e` already uses** — our Phase 2 dev/e2e harness needs no new infra for any of these capabilities.
- **Config**: `LETTA_PG_URI` env wires the app to pgvector (`compose.yaml:35`).

### LangMem

N/A (not cloned).

---

## Coverage Corner 4 — Techniques

### Technique 1 — Procedural / code-as-skill identity + persistence (Q1)

| Project | Approach | Citation |
|---|---|---|
| Letta | A tool is `{name, source_code, json_schema}`. `create_or_update_tool_async` **derives the name from the generated `json_schema`** when absent (`pydantic_tool.name = pydantic_tool.json_schema.get("name")`), validates name↔schema consistency, then **UPSERTs by name** (`get_tool_by_name_async`). Identity = the function NAME; the body = `source_code`. | `.claude/knowledge-base/references/letta/letta/services/tool_manager.py:211` (create_or_update), `:229` (name from schema), `:249` (upsert-by-name); schema generation from source via `.claude/knowledge-base/references/letta/letta/functions/ast_parsers.py:55` (`resolve_type`) |
| Mem0 | No code-as-skill concept — Mem0 stores facts, not executable procedures. (Procedural memory is referenced in `add()` docstring as an `agent_id`-scoped memory_type, not executable code — `main.py:573` docstring.) | `.claude/knowledge-base/references/mem0/mem0/memory/main.py:573` |

**Maps to TheMemory:** our Voyager skill library (`Memory.skills(repoId)`, ADR-0010) already uses hash identity (`hashFact(description)`) + scope-isolated forget — the SAME upsert-by-identity shape as Letta's upsert-by-name. The dashboard skills surface should therefore be a **read-only browse** (list `{name/hash, description, code-payload}` per repo), NOT an editor/executor (KISS + P0 freeze). A NEW REST endpoint is required (today `GET /v1/scopes/skill/*` returns `501 SKILL_LISTING_NOT_IMPLEMENTED`).

### Technique 2 — Temporal / point-in-time access (Q2)

| Project | Approach | Citation |
|---|---|---|
| Mem0 | `history(memory_id)` returns a **change audit-log** (`db.get_history`), NOT an as-of query. The history table columns are `old_memory, new_memory, event, created_at` (+ ids) — a per-memory mutation log. | `.claude/knowledge-base/references/mem0/mem0/memory/main.py:1573` (`history`), `.claude/knowledge-base/references/mem0/mem0/memory/storage.py:43-46` (history columns) |
| Letta | Passages are append-only rows carrying `organization_id` + `created_at` (`create_agent_passage_async`); temporal access = ordering by `created_at`, not a validity-interval as-of. | `.claude/knowledge-base/references/letta/letta/services/passage_manager.py:134` (create_agent_passage), `:54` (organization_id) |

**Maps to TheMemory:** NEITHER reference implements true **as-of bi-temporal recall**. TheMemory's `t_valid`/`t_invalid` + `recall({asOf})` (ADR-0011, v1.1) is **ahead** of both. CRUCIAL: `RecallBody.asOf` ALREADY exists at `.claude/knowledge-base/references/`-external `packages/api/src/server/schemas.ts:72` — so exposing `asOf` is **wiring-only** (gateway client `recallRequest`/`RecallOptions` lack `asOf`; dashboard needs a date/time picker on the Playground recall panel). Mem0's `history()` audit-log shape is the model for a SEPARATE "memory timeline / change-log" view (would need a new endpoint; lower priority).

### Technique 3 — Multi-actor attribution-on-write (Q3)

| Project | Approach | Citation |
|---|---|---|
| Mem0 | `add(messages, user_id, agent_id, run_id, metadata, ...)` — **one of `user_id`/`agent_id`/`run_id` is REQUIRED**; the actor ids scope the memory. Ids are hashed when used as filters. | `.claude/knowledge-base/references/mem0/mem0/memory/main.py:573` (`add` signature + docstring "One of those ids is required"), `.claude/knowledge-base/references/mem0/mem0/memory/utils.py:210-213` (agent_id/run_id md5 encoding) |
| Letta | First-class `IdentityManager` — `create_identity_async` / `list_identities_async(name, identifier_key)`; identity is a named, keyed entity separate from the memory row. | `.claude/knowledge-base/references/letta/letta/services/identity_manager.py:30` (class), `:94` (create), `:33` (list by name/identifier_key) |

**Maps to TheMemory:** our `RememberOptions.attributedTo` (v1.1, single string peer) is closest to Mem0's actor-id-on-write (simpler than Letta's full identity entity). It ALREADY exists in `RememberBody.attributedTo` (`packages/api/src/server/schemas.ts`). Exposing attribution-WRITE is **wiring-only**: add an `attributedTo` text field to the Playground remember panel + thread it through the gateway BFF `rememberRequest`. The Entities page already READS the aggregation.

---

## Cross-cutting Comparison

| Dimension | Mem0 | Letta |
|---|---|---|
| Integration-test style | pytest + real SQLite, asserts history schema (`test_storage.py:70`) | async + real E2B/Local sandbox fixtures (`integration_test_async_tool_sandbox.py:28`) |
| Skills/procedural | facts only (no code-as-skill) | tool = name+source+schema, upsert-by-name (`tool_manager.py:211`) |
| Temporal | change audit-log via `history()` (`main.py:1573`) | append rows ordered by `created_at` (`passage_manager.py:134`) |
| Attribution-write | required actor id (user/agent/run) on `add()` (`main.py:573`) | first-class IdentityManager (`identity_manager.py:30`) |
| Local dev | Makefile + `server/docker-compose.yaml` | `compose.yaml` on `ankane/pgvector:v0.5.1` (`:3`) |

## ADRs

### D1 — Attribution-write + bi-temporal asOf are WIRING-ONLY (ship as Phase-2A, not frozen)

**Decision:** surface `attributedTo` (write) on the Playground remember panel and `asOf` (time-travel) on the recall panel by threading the EXISTING REST fields (`RememberBody.attributedTo`, `RecallBody.asOf`) through the gateway BFF + dashboard. No new TheMemory endpoint.

**Rationale:** verified both fields already exist in the REST zod schemas (`schemas.ts:72` for asOf; `RememberBody.attributedTo`); the references confirm the shapes are sound (Mem0 actor-on-write `main.py:573`; neither ref even HAS as-of, so we are not under-building). These are hardening of shipped v1.1 surfaces, NOT frozen Phase-V features.

**Alternatives considered:** (a) new `/v1/attribution` + `/v1/asof` endpoints — rejected, the verbs already accept these params; (b) defer with skills — rejected, no P0-freeze reason applies to v1.1 surfaces.

**Consequences:** a small, low-risk `/to-plan` can ship 2A on owner confirmation; the gateway `recallRequest`/`rememberRequest` + `RecallOptions`/`RememberOptions` gain the two optional fields + the dashboard gains a peer input + a date picker.

### D2 — Skills dashboard is a READ-ONLY browse needing a NEW REST endpoint; stays FROZEN under P0

**Decision:** the skills/Repo-tier dashboard surface is a read-only browser (list `{hash/name, description, code-payload}` per repo). It requires a NEW TheMemory REST endpoint (skill listing; today `GET /v1/scopes/skill/*` → `501`). NO implementation until the owner unfreezes Roadmap Item 8 (CLAUDE.md Rule 10).

**Rationale:** Letta's tool model (`tool_manager.py:211` upsert-by-name) confirms a browse view needs only name+source+schema rows — zero sandbox/execution deps (`pyproject.toml:132-133` are optional extras). But the skill REST surface does not exist (501), and skills are P0-FROZEN. Building the endpoint is new feature work requiring owner sign-off.

**Alternatives considered:** (a) an executor/editor in the dashboard — rejected (KISS/YAGNI + pulls e2b/modal); (b) reuse the memories list endpoint — rejected (skills are a distinct tier with hash identity + code payload).

**Consequences:** this blueprint is decision-support for the unfreeze conversation; on unfreeze, a `/to-plan` adds a `GET /v1/scopes/skill/:repoId/skills` REST endpoint + gateway BFF + a dashboard Skills tab.

## Recommendations for TheMemory

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Ship **Phase 2A** (`attributedTo` write field on Playground remember + `asOf` date picker on recall) as wiring-only — gateway BFF threads the existing REST params; no new endpoint. | Q3, Q2, D1, architecture.md HTTP-seam | HIGH (low-risk, immediate on owner OK) |
| 2 | Keep **skills** as decision-support only; draft the `GET /v1/scopes/skill/:repoId/skills` REST contract for the unfreeze conversation; read-only browse, zero sandbox deps. | Q1, Q6, D2, CLAUDE.md Rule 10 | BLOCKED (P0 freeze — owner unfreeze first) |
| 3 | (Optional, later) a "memory timeline / change-log" view modeled on Mem0's `history()` audit-log shape — needs a new `history` REST endpoint; lower priority than 2A. | Q2, Q5 | LOW |
| 4 | Phase 2A dev/e2e harness reuses the existing `ankane/pgvector:v0.5.1` (same image Letta + our e2e use) — no new infra. | Q7 | HIGH (free) |

## Blocked questions (if any)

(none — all 7 research questions answered with verified citations)

## Halt-loop progress (audit trail)

- Execution mode: in-context (not ralph-loop) per `loop-engine-convention.md § most-constrained-mechanism` — 7 questions / 2 references fit one context window
- Questions answered: 7 / 7
- Questions blocked: 0
- Citations verified: all `.claude/knowledge-base/references/` paths confirmed on disk (Step 7 sanity check below)
- Coverage corners populated: 4 / 4 (tests, deps, tools, techniques)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/dashboard-phase2-skills-bitemporal-attribution-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/dashboard-phase2-skills-bitemporal-attribution-edge-cases-2026-06-19.md`
- Confidence report: `.claude/knowledge-base/reviews/dashboard-phase2-skills-bitemporal-attribution-confidence-2026-06-19.md` (generated by `/discover-confidence`)
- Linked TheMemory rules: `.claude/rules/architecture.md` (HTTP-seam), CLAUDE.md Rule 10 (P0 freeze)
