# Discover Edge Case Review — openmemory-mcp-compat

Date: 2026-06-18
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/openmemory-mcp-compat-plan.md`
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 3, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: OpenMemory exposes SSE **and** an HTTP route; our package ships only stdio + streamable-http
- **Affected question:** Q6 (deps)
- **Family:** Method / Interpretation
- **Scenario:** Q6 as written asks "does our TS MCP stack already provide SSE". Source shows OpenMemory mounts THREE transport routes (`mcp_server.py:435` `GET /{client_name}/sse/{user_id}`, `:470` `POST /{client_name}/sse/{user_id}/messages/`, `:496` `/{client_name}/http/{user_id}`), while our package exports only `connectStdio` + `connectStreamableHttp` (`packages/mcp/src/index.ts:9-10`) — no legacy SSE transport. The announcement's `npx install-mcp …/sse/<user>` connects via SSE.
- **Impact:** If the blueprint concludes "our streamable-http is enough" without checking the SSE-vs-http distinction, the implement phase ships something OpenMemory-wired SSE clients can't connect to → not a drop-in.
- **Suggested fix:** Q6 Fase A — read all three OpenMemory transport routes (`mcp_server.py:435/470/496`) and compare to `packages/mcp/src/transports/streamable-http.ts`; the answer must state explicitly whether legacy **SSE** is a NEW transport we must add or whether the `/http/` route maps to our existing streamable-http.

### EC-2: Tool input schemas are FastMCP-generated, not literal in source
- **Affected question:** Q1 (techniques)
- **Family:** Interpretation
- **Scenario:** Q1 expects "verbatim JSON input schemas", but `mcp_server.py` only has Python signatures (`add_memories(text: str, infer: bool = True)`); FastMCP derives the JSON schema at runtime. The test (`test_mcp_server.py:183`) only asserts `"inputSchema" in tool`, not its content.
- **Impact:** Q1 answered with the Python signature mislabeled as "the JSON schema"; the implement phase emits a mismatched MCP schema.
- **Suggested fix:** Q1 — DERIVE each tool's JSON schema from its `async def` signature + type hints (FastMCP convention) and label it "derived"; note the schema is generated, not literal.

### EC-3: user/client scoping + route mounts live in the `mcp_router`, not the `SseServerTransport(...)` line
- **Affected question:** Q4 (tools)
- **Family:** Reference path
- **Scenario:** Q4's Fase A points at `SseServerTransport("/mcp/messages/")` (`:62`), but the actual per-request scoping (path → `user_id`/`client_name` contextvars) is the route handler `handle_sse` at `mcp_server.py:435-462` (`request.path_params.get("user_id")` / `client_name`), with POST-message routes at `:465/:470`.
- **Impact:** Q4 documents the transport object but misses HOW user/client are extracted — the load-bearing scoping mechanism for the mapping table.
- **Suggested fix:** Q4 Fase A — cite `mcp_server.py:435-496` (the `mcp_router` GET `/{client_name}/sse/{user_id}` + POST message routes) as the scoping source.

## SHOULD TEST

### EC-4: Blueprint must enumerate ALL transport routes, not just SSE
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** Q4 is DONE only when the blueprint lists every transport route (base `/messages/` `:465`, `/{client}/sse/{user}` `:435`, `/{client}/sse/{user}/messages/` `:470`, `/{client}/http/{user}` `:496`) — so the compat layer covers the full surface a real OpenMemory client may hit.

## DOCUMENT

### EC-5: Reference clone is a 2026-05-21 `--depth 1` snapshot; upstream may have drifted
- **Accepted risk:** the discover pins the contract against the CLONED surface (D2). The four tool NAMES are stable per the public announcement; minor schema drift upstream is acceptable for a v1 compat layer and re-verifiable later. No fix — documented per ADR D2.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 1 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 2 | 1 | 1 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 1 | 1 | 0 | 0 |
| (cross) | 1 | 0 | 0 | 1 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (3 MUST FIX — absorb into v1.1 before `/discover-execute`).
