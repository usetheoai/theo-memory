---
slug: openmemory-mcp-compat
created_at: 2026-06-18
cycle: discover (phase 4 — blueprint)
source_plan: .claude/knowledge-base/discoveries/plans/openmemory-mcp-compat-plan.md (v1.1)
status: SHIPPABLE_WITH_CAVEATS (pending /discover-confidence)
---

# Blueprint: OpenMemory MCP-shape compatibility

## Context & Objective

Make TheMemory's MCP server a **drop-in for the OpenMemory MCP Server** so OpenMemory-wired clients (Cursor / Claude Desktop / Windsurf / Cline) work unchanged. All findings below are read from the reference clone `.claude/knowledge-base/references/mem0/openmemory/` (Mem0 OSS, Apache-2.0). Source is authoritative over the marketing announcement (ADR D2 of the plan) — and the two **disagree** (see Headline findings).

## Headline findings (the surprises)

1. **The delete tool is `delete_memories(memory_ids: list[str])`, NOT `delete_all_memories`.** The announcement says "`delete_all_memories`: Clear memory entirely"; the code (`api/app/mcp_server.py:296-297`) exposes `@mcp.tool(description="Delete specific memories by their IDs") async def delete_memories(memory_ids: list[str])`. The `tools/list` test (`api/tests/test_mcp_server.py:162`) asserts exactly `{add_memories, search_memory, list_memories, delete_memories}`. → A real drop-in must expose **`delete_memories`** (delete-by-IDs), not `delete_all_memories`.
2. **OpenMemory ships BOTH transports.** Legacy **SSE** (`GET /{client}/sse/{user}` + POST message routes) AND **Streamable HTTP** (`/{client}/http/{user}`, "MCP spec 2025-03-26+ which replaces [SSE]"). Our package already has Streamable HTTP; SSE is the gap.
3. **No new dependency.** Our `@modelcontextprotocol/sdk@^1.29.0` already ships `server/sse.js` (`SSEServerTransport`) + `server/streamableHttp.js`. SSE is a wiring ADD in `packages/mcp`, not a dependency add.

---

## Coverage Corner 1 — Techniques (the tool surface)

### Q1+Q2: the four tools — signatures, derived schemas, returns

All four are `FastMCP("mem0-mcp-server")` tools (`mcp_server.py:43`). Input schemas are FastMCP-**generated** from the Python signatures (the `tools/list` test asserts presence only, `test_mcp_server.py:183`). All return `str`; success payloads are `json.dumps(...)`, errors are plain `"Error: ..."` strings returned as the tool RESULT (not MCP protocol errors).

| Tool | Signature (`mcp_server.py`) | Derived input schema | Return |
|---|---|---|---|
| `add_memories` | `(text: str, infer: bool = True) -> str` (`:65`) | `{text: string (req), infer: boolean (default true)}` | `json.dumps(response)` (`:104`) or `"Error adding to memory: …"` |
| `search_memory` | `(query: str) -> str` (`:150`) | `{query: string (req)}` | JSON string of matches or error string |
| `list_memories` | `() -> str` (`:228`) | `{}` (no params) | `json.dumps(filtered_memories, indent=2)` (`:~262`) or error string |
| `delete_memories` | `(memory_ids: list[str]) -> str` (`:297`) | `{memory_ids: array<string> (req)}` | success/“deleted N” JSON or `"Error: No accessible memories found…"` |

Common preconditions in every tool: `user_id` + `client_name` must be present (from contextvars) else `return "Error: user_id not provided"` / `"Error: client_name not provided"` (`:66-72` etc.). `delete_memories` soft-deletes (`memory.state = MemoryState.deleted`, `:~341`) and is permission-filtered (only `check_memory_access_permissions`-accessible IDs, `:~318`).

### Q3: delete semantics — resolved
Tool name + param confirmed: `delete_memories(memory_ids)`. The announcement's `delete_all_memories` does not exist in this clone. **Recommendation:** implement `delete_memories(memory_ids)`; OPTIONALLY also register a `delete_all_memories()` alias (no-arg, clears the scope) for clients that hard-code the announcement name — flagged as an implement-time decision.

---

## Coverage Corner 2 — Integration tests (our compat-test checklist)

From `api/tests/test_mcp_server.py` — the surface OpenMemory itself guards, which our compat layer must satisfy:

| OpenMemory test | What it asserts → our compat test |
|---|---|
| `test_post_initialize` (`:80`) | JSON-RPC `initialize` handshake works |
| `test_tools_list` (`:144`,`:162`) | `tools/list` returns exactly `{add_memories, search_memory, list_memories, delete_memories}` |
| `test_tools_list_has_descriptions` (`:167`) | every tool has a description |
| `test_tools_list_has_input_schemas` (`:183`) | every tool has an `inputSchema` |
| `test_call_unknown_tool_returns_error` (`:199`) | unknown tool → error |
| `test_unknown_jsonrpc_method` (`:218`) | unknown JSON-RPC method handled |
| `test_response_content_type_is_json` (`:228`) | response content-type is JSON |
| `test_context_vars_set_during_tool_call` (`:247`) | user_id/client_name bound during the call |
| `test_different_users_are_isolated` (`:275`) | user A cannot see user B's memories (per-user isolation) |
| protocol errors (`:98`,`:107`,`:116`,`:126`) | DELETE→405, missing Accept→406, bad JSON→400, wrong path→404 |

→ Compat acceptance = these behaviors reproduced against our server (we already have a per-user isolation guarantee — maps to our user-tier + workspace).

---

## Coverage Corner 3 — Dependencies (Q6 verdict)

- **OpenMemory:** `mcp[cli]>=1.3.0` (Python MCP SDK — FastMCP + `mcp.server.sse.SseServerTransport`, `mcp_server.py:34-35` + requirements.txt:11).
- **Ours:** `@modelcontextprotocol/sdk@^1.29.0` (`packages/mcp/package.json:20`). Confirmed present: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/{sse.js, streamableHttp.js, stdio.js}`.
- **Verdict: NO new dependency.** The SDK already ships `SSEServerTransport`. We currently wire `connectStdio` + `connectStreamableHttp` (`packages/mcp/src/index.ts:9-10`); the OpenMemory `/http/` route maps to our existing `connectStreamableHttp`; the legacy `/sse/` route needs a NEW SSE wiring using the SDK's existing `SSEServerTransport`.

---

## Coverage Corner 4 — Tools / transport + scoping (Q4)

Routes (all in `mcp_server.py`, `mcp_router`, mounted under `/mcp`):

| Route | Line | Purpose |
|---|---|---|
| `GET /{client_name}/sse/{user_id}` | `:435` `handle_sse` | open SSE stream; binds `user_id`+`client_name` from `request.path_params` → contextvars |
| `POST /messages/` | `:465` | SSE message POST (base) |
| `POST /{client_name}/sse/{user_id}/messages/` | `:470` | SSE message POST (scoped) |
| `api_route /{client_name}/http/{user_id}` (POST/GET/DELETE) | `:496` | Streamable HTTP (MCP 2025-03-26+) |

- `SseServerTransport("/mcp/messages/")` (`:62`); `FastMCP("mem0-mcp-server")` (`:43`).
- **Port 8765** (announcement + compose). Client connect URL: `http://localhost:8765/mcp/<client>/sse/<user>`.
- **Scoping mechanism:** `user_id` + `client_name` come from the **URL path**, set into `contextvars` (`user_id_var`/`client_name_var`, `:55-56`, `:439-442`), read by every tool. There is NO bearer-token auth on this surface — the user identity IS the path segment (local-first trust model).

---

## Mapping table — OpenMemory tool → TheMemory

| OpenMemory | TheMemory verb | Scope mapping | Gap to handle |
|---|---|---|---|
| `add_memories(text, infer)` | `memory.withWorkspace(ws).user(<user_id>).remember(text, { infer })` | path `user_id` → **user tier**; `infer` maps 1:1 | `client_name` has no tier equivalent → store as metadata or ignore |
| `search_memory(query)` | `…user(<user_id>).recall(query)` | same | return shape must be JSON-string |
| `list_memories()` | scope listing for `<user_id>` | same | OpenMemory returns full dump; we cap/paginate — match shape |
| `delete_memories(memory_ids)` | `memory.forget(id)` per id | by-id; respect our 404/soft-delete | announcement `delete_all_memories` ≠ code; expose `delete_memories` (+ optional alias) |

**Cross-cutting scope gap:** OpenMemory's path `user_id` is its only tenant key (+ `client_name` app id). TheMemory's tenant is the **workspace** (from credential) with `user`/`session`/`agent` tiers inside. Recommendation: the compat endpoint maps path `user_id` → our **user tier** inside the **workspace resolved from the connection's credential** (or the `default` workspace when the local-first endpoint is unauthenticated, mirroring OpenMemory's no-auth local model). This keeps our multi-tenant isolation intact while honoring OpenMemory's path-scoping.

---

## ADRs (recommendations for the implement phase)

### ADR-A — Compat tools are ALIASES in `packages/mcp`, not new core code
Expose the 4 OpenMemory tool names as a thin alias layer over our existing `remember`/`recall`/`forget` + listing, living in `packages/mcp` (adapter boundary, `architecture.md § 3`). `src/core` learns nothing about OpenMemory. Identifiers stay neutral per `no-paper-names-in-code.md` (e.g. `openMemoryCompatTools` is OK as a vendor-interop module name in the adapter layer; tool NAMES `add_memories` etc. are the wire contract, allowed as string literals).

### ADR-B — Transport: add SSE wiring, reuse streamable-http for `/http/`
Add an SSE transport in `packages/mcp` using the SDK's `SSEServerTransport` at `GET /{client}/sse/{user}` + the POST message routes; map OpenMemory's `/{client}/http/{user}` to our existing `connectStreamableHttp`. No new dependency (Corner 3).

### ADR-C — Scoping: path `user_id` → user tier within the credential's workspace
Bind path `user_id` to our user tier; resolve the workspace from the connection credential (default workspace if the local endpoint is unauthenticated). `client_name` → memory metadata (not a tier). Preserves the v0.4.0 workspace isolation.

### ADR-D — Implement `delete_memories(memory_ids)`; flag the announcement discrepancy
Match the code, not the announcement. Optionally register a `delete_all_memories()` alias behind a flag for clients hard-coded to the announcement name.

### ADR-E — Return-shape parity
Tools return JSON **strings** for success and `"Error: …"` strings for failures (result strings, not protocol errors). Match this so OpenMemory clients parse responses identically.

## Out of scope (confirmed)
OpenMemory dashboard UI (`openmemory/ui/**`), the Docker stack, the Mem0 client internals (`utils/memory.py`), and any `mem0ai` dependency — none are touched.

## References (all verified to exist)
- `.claude/knowledge-base/references/mem0/openmemory/api/app/mcp_server.py` (`:34-35,43,55-56,62,64-72,104,149-150,227-228,296-297,318,341,435-462,465,470,496`)
- `.claude/knowledge-base/references/mem0/openmemory/api/tests/test_mcp_server.py` (`:80,98,107,116,126,144,162,167,183,199,218,228,247,275`)
- `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt:11`
- `packages/mcp/src/index.ts:9-10`, `packages/mcp/package.json:20`, `node_modules/@modelcontextprotocol/sdk/dist/esm/server/{sse,streamableHttp,stdio}.js`

## Next
`/discover-confidence openmemory-mcp-compat` → then a follow-up `/to-plan openmemory-mcp-compat` for implementation (NOT part of this discover).
