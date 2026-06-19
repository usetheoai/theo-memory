# Discovery Plan: Dashboard Phase 2 — Skills, Bi-temporal, Attribution-write

> **Version 1.1** (2026-06-19 — absorbed `/discover-edge-cases`: 4 SHOULD-TEST Fase-B scoping checkpoints added; EC-1 asOf-already-in-REST + EC-4 read-only-zero-sandbox-deps documented; 0 MUST FIX) — Investigates how the in-tree reference memory systems (Mem0, Letta) model + persist + test + expose three advanced capabilities — procedural/code-as-skill memory, temporal/point-in-time access, and multi-actor attribution-on-write — to inform how the theo-cloud dashboard (Phase 2) should surface TheMemory's own already-built equivalents (`Memory.skills(repoId)`, `recall({asOf})`, `RememberOptions.attributedTo`) through the gateway BFF. Blueprint output decides, per capability: (a) the UX shape, (b) whether a NEW TheMemory REST endpoint is required (skills + asOf are SDK-only today; no REST surface) or only gateway wiring, (c) the dependency/test cost, and (d) the P0-freeze posture. **No code lands from this discovery** — the skills browser is FROZEN under PRIORITY 0 (CLAUDE.md Rule 10); this is research only until the owner unfreezes.

**Slug:** `dashboard-phase2-skills-bitemporal-attribution`
**Owner:** paulohenriquevn
**Created:** 2026-06-19
**Time budget:** 7h (per-project breakdown in ADR D1)

## Context

The `theo-memory-dashboard-full-integration` cycle (READY_TO_MERGE 2026-06-19) closed the CORE feature surface (4 verbs + scope + metrics + entities + date-filter + hard-delete) but **deliberately deferred three advanced capabilities as explicit NON-GOALs** (see that plan's `## Non-goals` + the cross-validation this session):

1. **Voyager-style SKILLS / Repo tier** — `Memory.skills(repoId)` (CLAUDE.md Roadmap Item 8, ADR-0010) ships 4 skill verbs with hash identity + scope-isolated forget, but is **SDK-only** (no REST endpoint; `GET /v1/scopes/skill/*` returns `501 SKILL_LISTING_NOT_IMPLEMENTED` per `packages/api/src/server/handlers/scopes.ts`). It is **FROZEN under PRIORITY 0** (CLAUDE.md § What does NOT ship — no PRs until owner unfreezes).
2. **BI-TEMPORAL `recall({asOf})`** — shipped for memory scopes in v1.1 (Roadmap Item 12, ADR-0011) but **skill-scope `asOf` is deferred per EC-9**, and there is **no REST `asOf` parameter** on `POST /v1/recall` today (`packages/api/src/server/schemas.ts` `RecallBody` HAS `asOf` — verify) — needs gateway + dashboard wiring.
3. **Multi-peer ATTRIBUTION-WRITE** — `RememberOptions.attributedTo` exists (v1.1, `RememberBody.attributedTo` in `schemas.ts`) and is surfaced READ-ONLY via the new Entities page (derived aggregation), but the dashboard Playground remember panel does NOT capture it on write.

This discovery answers: how do comparable systems (Mem0, Letta) shape these, so our Phase 2 dashboard + gateway decisions are evidence-based rather than invented. Respects `.claude/rules/architecture.md` (HTTP-seam: dashboard → gateway BFF → TheMemory REST; no SDK in the browser) and `.claude/rules/cycle-discover.md` (discovery output is a blueprint, never code). The P0-freeze (CLAUDE.md Rule 10) means skills stays research-only.

## Objective

Decide, per capability, the dashboard UX + the gateway/REST surface change required (new endpoint vs wiring) + the dependency/test cost, grounded in how Mem0/Letta solved the analogous problem.

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question (skills / asOf / attribution-write)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/letta/` | `letta/letta/services/tool_manager.py`, `letta/letta/services/tool_sandbox/`, `letta/letta/services/tool_executor/`, `letta/letta/functions/`, `letta/letta/services/identity_manager.py`, `letta/letta/services/passage_manager.py`, `letta/letta/services/archive_manager.py`, `letta/tests/` (integration tool/sandbox tests), `letta/pyproject.toml`, `letta/compose.yaml` | Letta is the procedural/code-as-skill + identity + archival reference (closest analog to Repo-tier skills + multi-actor + temporal) |
| `.claude/knowledge-base/references/mem0/` | `mem0/mem0/memory/main.py`, `mem0/mem0/memory/storage.py`, `mem0/mem0/memory/utils.py`, `mem0/tests/memory/test_storage.py`, `mem0/tests/memory/test_main.py`, `mem0/tests/test_memory.py`, `mem0/pyproject.toml`, `mem0/Makefile`, `mem0/server/docker-compose.yaml` | Mem0 is the attribution (agent_id/run_id/actor) + history/temporal + local-dev-tooling reference; closest to our Mem0-shape architecture |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/docs/`, `.claude/knowledge-base/references/letta/` docs/marketing | Not source of truth |
| `.claude/knowledge-base/references/*/{build,dist,.venv,node_modules}/` | Build artifacts |
| LangMem | NOT cloned into `.claude/knowledge-base/references/` (only `letta` + `mem0` present) — Cross-Project Rule: never claim a feature without reading its source. Letta `functions/` covers the procedural-memory corner instead. |
| Letta agent-loop / LLM-provider / batch / clickhouse subsystems | Unrelated to the 3 capabilities |
| Mem0 graph / reranker / proxy subsystems | Unrelated to the 3 capabilities |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Letta: 4h (procedural/code-as-skill + identity + archival = 2 of 3 capabilities, deepest); Mem0: 3h (attribution + history/temporal + tooling).

**Rationale:** Letta carries the richest procedural-memory + identity + temporal-passage surface (the two least-understood capabilities for us), so it earns the deeper dive; Mem0 maps 1:1 onto our attribution + history shape and is faster to read.

**Alternatives considered:** equal split (rejected — Letta has more to teach here); single-project (rejected — attribution needs Mem0, skills need Letta).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions pending, mark all remaining questions for that project BLOCKED with reason "budget exhausted" and continue. If every remaining project is in the same state (every question `done` or honestly `blocked`), emit `<promise>BLUEPRINT_BLOCKED</promise>` with the honest report — never `BLUEPRINT_COMPLETE` from a blocked state.

**Anti-pattern:** NEVER fabricate Fase B answers to close a Fase-A-exhausted question (Unbreakable Rule 3).

**Consequences:** the halt-loop stops per-project on budget exhaustion; blocked questions surface in the blueprint's `## Blocked questions` section as next-discovery seed.

### D2 — Investigation depth

**Decision:** Fase A = ast-grep/grep hotspot map per code-shape question; Fase B = Read each hotspot end-to-end capturing intent + comments + edge-cases. Text-shape questions (deps manifests, compose, Makefile) SKIP Fase A and Glob+Read directly.

**Rationale:** the load-bearing knowledge (how skill identity/versioning works, how attribution is persisted, how asOf is queried) lives in method bodies + their comments, not signatures alone — Read depth is required. Manifests are flat text — ast-grep adds nothing.

**Consequences:** higher per-question token cost on the techniques corner; cheaper on deps/tools.

### D3 — P0-freeze posture + REST-gap framing (scope guardrail)

**Decision:** This discovery produces a blueprint ONLY. No implementation cycle (`/to-plan` → `/implement`) is spawned against the **skills** capability until the project owner explicitly unfreezes Roadmap Item 8 (CLAUDE.md Rule 10). For **asOf** and **attribution-write**, the blueprint MAY recommend a follow-up `/to-plan` because those are hardening of already-shipped v1.1 surfaces (not frozen), pending owner confirmation. Every recommendation MUST state explicitly whether it needs a NEW TheMemory REST endpoint (skills listing + skill verbs + possibly `asOf` query param) or only gateway-BFF + dashboard wiring.

**Rationale:** Inquebrável Rule 10 (P0 freeze) + Rule 3 (honesty) — the discovery must not become a backdoor to ship a frozen feature; it informs the decision the owner will make.

**Alternatives considered:** plan+implement directly (rejected — violates P0 freeze for skills); skip discovery and guess the UX (rejected — the whole point is evidence-based design).

**Consequences:** the blueprint is actionable for asOf + attribution-write immediately on owner sign-off; the skills section is decision-support for the unfreeze conversation.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep/grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Letta model + persist procedural / code-as-skill memory — identity (name/hash), versioning, and the create/list/execute boundary? | techniques | `.claude/knowledge-base/references/letta/letta/services/tool_manager.py`, `.claude/knowledge-base/references/letta/letta/functions/functions.py`, `.claude/knowledge-base/references/letta/letta/functions/ast_parsers.py` | `ast-grep run -p 'def $NAME($$$): $$$' --lang python .claude/knowledge-base/references/letta/letta/services/tool_manager.py` to list CRUD ops; grep `def ` in `functions/ast_parsers.py` for the code-parse path | Read each CRUD method + the ast-parser to capture how a tool's identity/source/schema is stored + de-duplicated | Table: operation → identity key (name/hash) → persistence shape → citation `path:line`; note whether listing is paginated |
| Q2 | How do Mem0 (`history()`) and Letta (passages/archive) expose temporal / point-in-time access — is it an audit log, an as-of query, or immutable versioned rows? | techniques | `.claude/knowledge-base/references/mem0/mem0/memory/main.py`, `.claude/knowledge-base/references/mem0/mem0/memory/storage.py`, `.claude/knowledge-base/references/letta/letta/services/passage_manager.py`, `.claude/knowledge-base/references/letta/letta/services/archive_manager.py` | `ast-grep run -p 'def history($$$): $$$' --lang python ref/mem0/`; `ast-grep run -p 'def $NAME($$$): $$$' --lang python ref/letta/letta/services/passage_manager.py` (grep `created_at|timestamp|as_of` in both) | Read the history method + the passage/archive timestamp columns to determine the temporal model (audit vs as-of vs versioned) | Comparison: Mem0 vs Letta temporal model → data shape → query shape → citations; verdict on which maps to our `t_valid/t_invalid` + `recall({asOf})` |
| Q3 | How do Mem0 (`add()` with `agent_id`/`run_id`/`actor`) and Letta (`identity_manager`) capture multi-actor attribution ON WRITE, and where is it stored/validated? | techniques | `.claude/knowledge-base/references/mem0/mem0/memory/main.py`, `.claude/knowledge-base/references/mem0/mem0/memory/utils.py`, `.claude/knowledge-base/references/letta/letta/services/identity_manager.py` | `ast-grep run -p 'def add($$$): $$$' --lang python ref/mem0/mem0/memory/main.py`; grep `actor_id|agent_id|run_id|identity` in `mem0/memory/utils.py` + `letta/.../identity_manager.py` | Read `add()` + the actor-handling helper + Letta identity CRUD to capture the write-time attribution contract + validation | Side-by-side: write-param name → storage column → validation rule → citations; recommendation for our `attributedTo` write UX + body field |
| Q4 | How does Letta integration-test tool execution + sandboxing (the procedural path)? What is mocked vs real? | tests | `.claude/knowledge-base/references/letta/tests/integration_test_async_tool_sandbox.py`, `.claude/knowledge-base/references/letta/tests/integration_test_builtin_tools.py` | `ast-grep run -p 'def test_$NAME($$$): $$$' --lang python .claude/knowledge-base/references/letta/tests/integration_test_async_tool_sandbox.py` AND `.../integration_test_builtin_tools.py` to list test cases | Read each test's arrange/act/assert + fixtures to see how a skill's create+execute is verified (sandbox real? stubbed?) | Table: test name → fixture (real sandbox / stub) → assertion → citation; lesson for testing a dashboard skills surface |
| Q5 | How does Mem0 test history / temporal correctness — does it assert ordering, immutability, and as-of semantics? | tests | `.claude/knowledge-base/references/mem0/tests/memory/test_storage.py`, `.claude/knowledge-base/references/mem0/tests/memory/test_main.py`, `.claude/knowledge-base/references/mem0/tests/test_memory.py` | `ast-grep run -p 'def test_$NAME($$$): $$$' --lang python ref/mem0/tests/memory/test_storage.py` (grep `history` across the three test files) | Read each history/temporal test to capture what invariant it locks (ordering, append-only, timestamp) | Table: test → invariant asserted → citation; lesson for our asOf REST + dashboard time-travel testing |
| Q6 | What runtime dependencies do Letta's code-as-skill sandboxes pull (e2b / modal / local), and what is the LIGHTEST viable path for a READ-ONLY dashboard "skills browser" (list/inspect, no execution)? | deps | `.claude/knowledge-base/references/letta/pyproject.toml`, `.claude/knowledge-base/references/letta/letta/services/tool_sandbox/` | SKIP Fase A (manifest text-shape) — Glob `tool_sandbox/*.py` + Read `pyproject.toml`; grep `e2b\|modal\|sandbox` in pyproject | Read pyproject optional-dependency groups + the sandbox impl headers to separate execution-only deps from list/inspect deps | Dependency tree: execution deps vs read-only deps + a "skills browser needs ZERO sandbox deps" verdict + citations |
| Q7 | What is the local-dev + test story (docker-compose, test command, CI shape) for these features in Mem0 and Letta? | tools | `.claude/knowledge-base/references/mem0/Makefile`, `.claude/knowledge-base/references/mem0/server/docker-compose.yaml`, `.claude/knowledge-base/references/mem0/pyproject.toml`, `.claude/knowledge-base/references/letta/compose.yaml`, `.claude/knowledge-base/references/letta/pyproject.toml` | SKIP Fase A (text-shape) — Read each file fully | Read Makefile targets + compose services + pyproject scripts to extract the dev/test commands | Step-by-step: how to run + test these features locally in each project + what our Phase 2 dev/e2e harness should mirror |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4, Q5 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

Question budget: 7 total (within 5-10); per-corner: techniques 3 (≤3), tests 2, deps 1 (≥1), tools 1 (≥1). All corners populated — no DEFER-CORNER markers needed.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `.claude/knowledge-base/references/{project}/{path}` in Qx's Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted", continue |
| After answering Qx | Blueprint section under Qx has ≥1 citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Citations to `.claude/knowledge-base/references/` ≥ 1 / 200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | Letta 4h / Mem0 3h not exhausted | When exhausted, mark remaining Qx for that project BLOCKED "budget exhausted", advance |
| Q1 Fase B scope (EC-2/EC-5) | Q1 reads ONLY `tool_manager` create/list/get + `ast_parsers` identity path — NOT update/delete/execute internals, NOT `tool_executor/`·`tool_sandbox/` (those are Q6) | If Fase A surfaces executor/sandbox hotspots under Q1, drop them — they belong to Q6; prevents agent-loop scope creep |
| Q3 Fase B helper read (EC-3) | Q3 reads the actor helper (`mem0/mem0/memory/utils.py` ENTITY_PARAMS/encoded-ids ~:100/:210) IN ADDITION to the two `add()` bodies | If only `add()` is read, the attribution where-stored/where-validated answer is incomplete — re-iterate to read the helper |
| Q2 split timebox (EC-6) | Mem0-history half charged to Mem0 budget, Letta-passages half to Letta budget | If the Letta-temporal half exceeds budget, BLOCK only that sub-answer and KEEP the Mem0 history answer (load-bearing for our `t_valid/t_invalid`) |
| Before promising complete | All 4 coverage corners have populated blueprint sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes decisions (per capability: REST-endpoint-needed vs wiring-only; P0 posture)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/dashboard-phase2-skills-bitemporal-attribution-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations (only `letta/` + `mem0/` paths — LangMem absent)
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one project rule (`architecture.md` HTTP-seam, `cycle-discover.md`) or principle (KISS/YAGNI — do not over-build the skills browser)
- [ ] P0-freeze honored: NO implementation cycle spawned against skills until owner unfreeze (D3)
