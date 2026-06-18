---
slug: openmemory-mcp-compat
owner: paulohenriquevn
created_at: 2026-06-18
version: 1.1
cycle: discover (phase 1 — discovery plan)
---

# Discovery Plan: OpenMemory MCP-shape compatibility

> **v1.1 (edge-case absorption 2026-06-18):** EC-1 Q6 now compares all 3 OpenMemory transport routes (SSE + `/http/`) against our stdio/streamable-http-only stack; EC-2 Q1 derives the FastMCP-generated JSON schema from signatures (not literal); EC-3 Q4 cites the `mcp_router` route handlers (`mcp_server.py:435-496`) as the user/client scoping source; EC-4 halt-loop checkpoint added (enumerate ALL transport routes). Report: `.claude/knowledge-base/reviews/openmemory-mcp-compat-edge-cases-2026-06-18.md`.

## Context

Project-owner directive (2026-06-18, "URGENTE P0"): TheMemory's MCP server should be a **drop-in for the OpenMemory MCP Server** — any MCP client already wired to OpenMemory (Cursor / Claude Desktop / Windsurf / Cline) should work against TheMemory by pointing at our endpoint, with no client change. OpenMemory is Mem0's local-first MCP memory layer; its announcement names four tools (`add_memories` / `search_memory` / `list_memories` / `delete_all_memories`) and an SSE connection convention (`http://localhost:8765/mcp/<client>/sse/<user>`).

Classified IN-SCOPE under **P0 sub-goal 3 (MCP available + reliable)** per CLAUDE.md Amendment 2026-06-18 — this is MCP protocol/tool-shape interoperability mapped onto our existing `remember`/`recall`/`forget` verbs, NOT the cut Mem0/Zep/Letta data-adapter (no `mem0ai` dependency). Roadmap Item 26.

A first read of the reference clone already surfaced a **discrepancy to resolve**: the announcement says `delete_all_memories` "clears memory entirely", but the source (`mcp_server.py:296`) describes "Delete specific memories by their IDs". The blueprint must pin the ACTUAL contract, not the marketing copy.

## Objective

Produce a blueprint that pins, with file:line evidence, (a) the exact OpenMemory MCP tool surface (names, params, JSON input schemas, return shapes), (b) the SSE transport + per-request scoping convention (`user_id` + `client_name`), (c) the runtime contract a drop-in must honor (port, mount paths, client config string), and (d) a concrete mapping table from each OpenMemory tool → TheMemory verb + scope, flagging every semantic gap — sufficient for a follow-up `/to-plan` to implement the compat layer in `packages/mcp` without re-reading the reference.

**Success criteria:** every tool's input schema + return shape documented from source; the SSE path/scoping convention documented from source; ≥ 1 mapping gap explicitly identified (e.g. the delete semantics, the `infer` flag, the `client_name` dimension vs our 3-tier/workspace scope); zero fabricated citations.

## In-scope / Out-of-scope

**Reference project:** `.claude/knowledge-base/references/mem0/openmemory/` (read-only).

In-scope subdirectories:
- `openmemory/api/app/mcp_server.py` — the 4 tools + FastMCP + SSE transport (PRIMARY).
- `openmemory/api/tests/test_mcp_server.py` — how the MCP surface is tested.
- `openmemory/api/app/schemas.py` — request/response shapes referenced by the tools.
- `openmemory/run.sh` + `openmemory/docker-compose.yml` — runtime/port/mount contract (transport convention only).

Out-of-scope (explicit):
- `openmemory/ui/**` — the dashboard (Scope guardrail: NOT the UI).
- `openmemory/api/app/utils/memory.py` + `routers/**` + `alembic/**` — Mem0-client internals + REST + DB schema (we map to OUR verbs, not their storage).
- The OpenMemory Docker stack itself (we do NOT run it; read-only study).
- Any `mem0ai` dependency (the cut adapter — explicitly excluded).

**Our mapping target (not researched here, named for the blueprint's mapping table):** `packages/mcp/src/**` (our existing MCP server) + `packages/agent-core/src/**` (shared MCP helpers).

## Prior Art & Related Work

- TheMemory already ships an MCP server (`themory mcp`, 4 verbs as MCP tools, stdio + streamable-HTTP) — Roadmap Item 4. This compat layer reshapes/aliases that surface to the OpenMemory tool names + SSE convention.
- The earlier `/review` competitor research (2026-06) established OpenMemory is the `openmemory/` sub-project of the mem0 repo, separate from the importable `mem0ai` core lib.

## ADRs (how to investigate)

### D1 — Time + stop conditions
- **Decision:** Single reference project (OpenMemory). Budget ~2h. Per-question stop condition: stop a question once its answer is backed by ≥ 1 file:line citation AND (for tool-shape questions) the input schema is captured verbatim. Do not spelunk Mem0-client internals.
- **Rationale:** narrow, well-bounded surface (one 574-LoC file + its test); the risk is scope-creep into Mem0 storage internals, which D1's stop condition forbids.

### D2 — Investigation depth: source-of-truth is code, not the announcement
- **Decision:** Where the OpenMemory announcement and the source disagree, the SOURCE wins and the discrepancy is recorded. (Triggered by the `delete_all_memories` vs delete-by-IDs gap.)
- **Rationale:** Inquebrável Rule 3 — pin the real contract; marketing copy is not a spec.

### D3 — Coverage-corner deferral: none
- **Decision:** All four corners populated (no DEFER-CORNER markers).
- **Rationale:** the topic touches tool schemas (techniques), the project's own MCP tests (tests), the MCP SDK/transport (deps), and the run/port/mount contract (tools) — all load-bearing for a drop-in.

## Research Questions

| # | Question | Corner | Fase A (method) | Fase B (cross-check) | Expected answer shape |
|---|---|---|---|---|---|
| Q1 | Exact tool surface: names, params + defaults, and JSON **input schemas** of every `@mcp.tool` (the 4 named + any extra). **EC-2:** schemas are FastMCP-GENERATED from the Python signatures, not literal in source — DERIVE + label "derived". | techniques | Read `references/mem0/openmemory/api/app/mcp_server.py` (grep `@mcp.tool`, read each `async def`); derive JSON schema from the signature + type hints | Read `references/mem0/openmemory/api/tests/test_mcp_server.py` (`test_tools_list_has_input_schemas` — asserts presence only) | Per-tool: name, signature, DERIVED JSON schema, description string |
| Q2 | Tool **return shapes**: what does each tool return (string? JSON? list)? incl. error strings (`"Error: user_id not provided"`). | techniques | Read `mcp_server.py` (return statements of each tool) | Read `test_mcp_server.py` (`test_response_content_type_is_json`) | Return type + example payload per tool |
| Q3 | **delete semantics discrepancy**: is the delete tool `delete_all_memories` (clear all) or delete-by-IDs? exact name + params. | techniques | Read `mcp_server.py:296+` | Read `test_mcp_server.py` (delete cases, if any) | The real tool name + param + behavior; gap vs announcement |
| Q4 | **Transport + scoping**: ALL transport route mounts (EC-4) and how `user_id` + `client_name` are extracted per request. **EC-3:** the scoping lives in the `mcp_router` route handlers, not the `SseServerTransport(...)` line. | tools | Read `mcp_server.py:435-496` — `mcp_router` `GET /{client_name}/sse/{user_id}` (`handle_sse`, `request.path_params` → contextvars) + POST `/messages/` `:465` + `/{client}/sse/{user}/messages/` `:470` + `/{client}/http/{user}` `:496` | Read `run.sh` / `docker-compose.yml` (port 8765) + announcement URL `/mcp/<client>/sse/<user>` | Every route + the path-param→contextvar extraction + port |
| Q5 | How is the MCP surface **tested** (tools/list, input-schema presence, per-user isolation, JSON-RPC error codes)? | tests | Read `references/mem0/openmemory/api/tests/test_mcp_server.py` | grep its assertions (`expected = {"add_memories",...}`, `test_different_users_are_isolated`) | List of test classes + what each asserts → our compat-test checklist |
| Q6 | **Transport gap (EC-1):** OpenMemory mounts SSE (`/{client}/sse/{user}`) AND `/{client}/http/{user}`; our package exports only `connectStdio` + `connectStreamableHttp` (`packages/mcp/src/index.ts:9-10`) — NO legacy SSE. Does our streamable-http satisfy OpenMemory's `/http/` route, or must we ADD an SSE transport for `/sse/` clients? Any NEW dep? | deps | Read `mcp_server.py:34-35` (`mcp.server.fastmcp`, `mcp.server.sse`) + the 3 transport routes (`:435/:470/:496`) | Read `packages/mcp/src/transports/streamable-http.ts` + `packages/mcp/package.json` (`@modelcontextprotocol/sdk` version — does it ship an SSE server transport?) | Explicit verdict: SSE is a NEW transport to add / `/http/` maps to our streamable-http; new dep yes/no |

Budget: 6 questions — techniques 3 (max), tests 1, tools 1, deps 1. Within [5,10]; every corner ≥ 1.

## Coverage Matrix

| Corner | Question(s) | Method present? |
|---|---|---|
| techniques | Q1, Q2, Q3 | Yes — Read `mcp_server.py` + `test_mcp_server.py` |
| tests | Q5 | Yes — Read `test_mcp_server.py` |
| deps | Q6 | Yes — Read OpenMemory imports + our `packages/mcp` |
| tools | Q4 | Yes — Read `mcp_server.py` SSE + `run.sh`/compose |

100% — every corner mapped to ≥ 1 question with a concrete method. No deferrals.

## Project rules the borrowed pattern must respect

- **`architecture.md § 3` (DIP boundary):** the compat layer lives in `packages/mcp` (adapter), mapping OpenMemory tool names → our domain verbs; `src/core` MUST NOT learn about OpenMemory. The blueprint's mapping table must respect this boundary.
- **`no-paper-names-in-code.md`:** "OpenMemory"/"Mem0" are vendor names — allowed in docs/blueprint, but the compat code identifiers must describe the role (e.g. `openMemoryToolAliases`) per the rule; the blueprint flags this for the implement phase.
- **`testing.md`:** Q5's findings feed an integration-test checklist (tools/list, input schemas, per-user isolation) for the eventual implementation.

## Halt-loop checkpoints (for /discover-execute)

A research question may be marked DONE only when:
1. Its answer cites ≥ 1 real `references/mem0/openmemory/...` path (verified to exist).
2. Tool-shape questions (Q1-Q3) capture the input schema / return shape verbatim (not paraphrased).
3. Q4 records the literal mount path string + the user/client extraction mechanism.
4. **EC-4:** Q4 is DONE only when the blueprint enumerates EVERY transport route (`/messages/`, `/{client}/sse/{user}`, `/{client}/sse/{user}/messages/`, `/{client}/http/{user}`) — not just SSE.
5. **EC-1:** Q6 is DONE only when it states an explicit SSE-transport verdict (new transport to add, or `/http/`→our streamable-http) + a new-dep yes/no.
6. Any announcement-vs-source discrepancy (D2) is recorded explicitly.

## Acceptance Criteria

- All 6 questions answered with file:line citations; zero fabricated paths.
- A tool-by-tool mapping table (OpenMemory tool → TheMemory verb + scope) with every semantic gap flagged (delete semantics, `infer` flag, `client_name` vs our user/session/agent/workspace scope).
- The SSE transport + scoping convention documented well enough to reproduce.
- A "new dependency? yes/no" verdict for the deps corner.
- Blueprint has ≥ 1 ADR section + all four coverage corners populated.

## Global Definition of Done

- `/discover-execute` produces `.claude/knowledge-base/discoveries/blueprints/openmemory-mcp-compat-blueprint.md`.
- `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `discover-blueprint-golden-rule.md`: all 4 corners populated, no fabricated citation).
- Blueprint feeds a follow-up `/to-plan openmemory-mcp-compat` for the implementation (NOT part of this discover).
