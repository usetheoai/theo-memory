# Blueprint: v0.3 — Agent tools (MCP) — `@usetheo/memory/agent-tools`

> **Version 1.0** — Synthesizes how `referencia/letta/` (primary, full MCP impl), `referencia/mem0/` (secondary, plugin-only), `referencia/langmem/` (tertiary, BaseStore tool pattern) AND prior_art on the official MCP spec + `../theokit-sdk/` tool-provider contract solve agent-tool exposure. Informs `/to-plan v0-3-agent-tools-mcp` by locking: transport choice (stdio vs SSE vs streamable-HTTP), tool schema shape + validation, cross-tool state isolation, integration surface with `@usetheo/sdk`, test pyramid for JSON-RPC roundtrip + malformed payload rejection.

**Slug:** `v0-3-agent-tools-mcp`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-3-agent-tools-mcp-plan.md` (v1.1)
**Owner:** TheMemory v0.3 cycle-discover
**Generated:** 2026-05-23 via `/discover-execute`
**Confidence verdict:** TBD (updated by `/discover-confidence`)
**Sibling `../theokit-sdk/` HEAD at investigation time (per ADR D4 v1.1 SHA stamping):** `6d9d553b9c60e2ec268234bccb76c22bf5f3c9c5`

## Context

Roadmap Item 4 (CLAUDE.md § Macro roadmap, currently Planned). v0.2 PR-A shipped 2026-05-23 (PR #11) — `@usetheo/memory/theokit` binding gap closed. v0.3 ships `@usetheo/memory/agent-tools` subpath: MCP server exposing `remember/recall/forget/reflect` as function-callable tools for `@usetheo/sdk` agents. **Key constraint** (CLAUDE.md Item 4 verbatim): port the MemGPT/Letta function-calling pattern WITHOUT inheriting the agent-loop lock-in.

## Objective

Lock 5 decisions for `/to-plan v0-3-agent-tools-mcp`: transport choice, tool schema declaration pattern, cross-tool state isolation strategy, `@usetheo/sdk` integration surface, test pyramid. The blueprint MUST surface enough technical depth that TDD-disciplined implementation can land without a second round of investigation.

---

## Coverage Corner 1 — Integration Tests

> Populated by `/discover-execute` from Q1 (Letta MCP test suite).

### Letta (Q1)

**Finding: Letta tests MCP integration via a 3-layer test pyramid — E2E (real Letta server + spawned MCP server in fresh venv + real agent tool roundtrip), unit-with-mocks (mock MCP clients + assert health-status enrichment at LIST time), and pure-unit (schema validator with no I/O). Schema validation runs at TOOL-LISTING time (not at tool-CALL time) and produces a 3-tier SchemaHealth enum (STRICT_COMPLIANT / NON_STRICT_ONLY / INVALID) with structured `reasons` array. Cross-tool state isolation is enforced at the test-fixture level (fresh agent_state per test + try/finally cleanup of MCP server registrations), NOT at the MCP-protocol level.**

Three test files interrogated:

1. **`test_mcp.py` (396 LoC) — E2E integration** (`referencia/letta/tests/mcp_tests/test_mcp.py:73-271`):
   - **Server-in-thread fixture** (`referencia/letta/tests/mcp_tests/test_mcp.py:76-121`): spawns Letta REST server in background `threading.Thread(target=_run_server, daemon=True)` + `wait_for_server(url, timeout=60)` (60s for provider model syncing).
   - **stdio transport happy path** (`referencia/letta/tests/mcp_tests/test_mcp.py:213-270` — `test_stdio_mcp_server`): creates fresh `venv` via `create_virtualenv_and_install_requirements(requirements_path, name='venv', force_recreate=True)` + pip-installs requirements; configures `StdioServerConfig(server_name, command=python3, args=[weather.py])`; registers MCP server via `client.mcp_servers.create(server_name, config=config_dict)`; tools auto-register; calls `client.mcp_servers.tools.list(mcp_server_id)` to get `tools/list` equivalent; attaches tool to agent; sends user message; asserts `ToolCallMessage` and `ToolReturnMessage` with `status == 'success'` and `len(tool_return.strip()) >= 10`.
   - **try/finally cleanup** (`referencia/letta/tests/mcp_tests/test_mcp.py:266-270`): every test deletes the MCP server registration on exit + asserts it's removed from `client.mcp_servers.list()`. State isolation at fixture-level.
   - **Cleanup fixture** (`referencia/letta/tests/mcp_tests/test_mcp.py:92-107` — `cleanup_test_venvs autouse=True`): wipes `weather/venv/` BEFORE each test.
   - **SSE transport test** (`referencia/letta/tests/mcp_tests/test_mcp.py:154-211` — `test_sse_mcp_server`): SKIPPED via `@pytest.mark.skip(reason='The deepwiki SSE MCP server is deprecated')`. Pattern preserved as template but no longer runs.
   - **Fixture file** (`referencia/letta/tests/mcp_tests/weather/weather.py`): the actual MCP server tested against — a tiny weather-API stub exposing tools including `get_alerts`.

2. **`test_mcp_schema_validation.py` (819 LoC) — unit with mocks** (`referencia/letta/tests/mcp_tests/test_mcp_schema_validation.py:1-76`):
   - **Mock pattern** (`referencia/letta/tests/mcp_tests/test_mcp_schema_validation.py:15-49`): `mock_client = AsyncMock(); mock_client.list_tools = AsyncMock(return_value=mock_tools)`. Bypasses real MCP transport — exercises ONLY the schema-health-enrichment layer.
   - **Health enrichment at LIST time** (`referencia/letta/tests/mcp_tests/test_mcp_schema_validation.py:49-75`): calls `actual_server.get_tools_from_mcp_server('test_server')` which returns `MCPTool` instances with `health: MCPToolHealth(status, reasons)`. Three test inputs cover each enum value: strict-compliant (no reasons), non-strict-only (reasons mention "additionalProperties"), invalid (reasons mention "type").
   - **Importantly**: malformed payload rejection happens at the LIST step (catalog-time), NOT at the CALL step (call-time). Schema health is a META-FIELD on the tool, not a runtime error in the JSON-RPC response.

3. **`test_schema_validator.py` (307 LoC) — pure unit** (`referencia/letta/tests/mcp_tests/test_schema_validator.py:11-77`):
   - Pure function tests of `validate_complete_json_schema(schema)` → `(SchemaHealth, reasons)` tuple.
   - 6+ schema-shape variants exercised: valid strict-compliant; free-form object (NON_STRICT_ONLY); empty-object-in-required (INVALID); missing-type (INVALID); array-without-items (INVALID); and more.
   - Zero I/O — runs in milliseconds.

**Implication for TheMemory v0.3 test pyramid** (ADR D5 candidate, to be synthesized post-Q8):
- **E2E (1-2 tests):** spawn real `@usetheo/memory/agent-tools` MCP server (stdio) + spawn a tiny mock MCP client + exercise `remember` / `recall` round-trip — but WITHOUT a Letta-style "real agent" loop (per CLAUDE.md Item 4 "without inheriting the agent-loop lock-in"). Use vitest's child-process spawn pattern.
- **Unit-with-mocks (~10 tests):** mock JSON-RPC transport, assert tool schema declaration outputs + 4-tool `tools/list` shape per CLAUDE.md acceptance ("exactly 4 tools with stable names").
- **Pure unit (~5 tests):** schema validator + tool-name-stability + payload-shape contracts.

**Test discipline applicable to v0.3** (LIFTABLE from Letta verbatim):
- try/finally cleanup of any registration state (per `referencia/letta/tests/mcp_tests/test_mcp.py:266-270` pattern)
- Pre-test fixture wipes any cached state (per `cleanup_test_venvs` pattern, `referencia/letta/tests/mcp_tests/test_mcp.py:92-107`)
- 3-tier `SchemaHealth(STRICT_COMPLIANT | NON_STRICT_ONLY | INVALID)` enum + `reasons: list[str]` shape is a portable contract — adopt for v0.3's `tools/list` response enrichment

---

## Coverage Corner 2 — Dependencies

> Populated from Q2 (npm @modelcontextprotocol/sdk surface).

### `@modelcontextprotocol/sdk` (Q2 — prior_art via npm-view fallback)

**Finding: `@modelcontextprotocol/sdk` v1.29.0 — MIT — TypeScript implementation of MCP by `modelcontextprotocol/typescript-sdk` on GitHub. Symmetric server/client design: separate `./server` and `./client` subpath exports (matching Letta's client-server-symmetric pattern from Q1). 17 runtime deps including Express 5, Hono (HTTP frameworks for HTTP+SSE transports), `eventsource` + `eventsource-parser` (SSE transport), `cross-spawn` (stdio transport via subprocess), `ajv` + `zod` + `zod-to-json-schema` (schema validation + tool schema codegen), `jose` + `pkce-challenge` (OAuth). Node >= 18.**

**Snapshot:** `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/79fb7308e5b5bc2f382e68463310ff345b4aa4a634b47827c760f54309b1f96d.md`

**Honest deviation from cycle-discover.md v1.1 § Halt gate (WebFetch → snapshot):** WebFetch against `https://www.npmjs.com/package/@modelcontextprotocol/sdk` returned HTTP 403 (npmjs.com blocks scrapers). Fell back to `npm view @modelcontextprotocol/sdk --json` which queries `registry.npmjs.org` API directly. The snapshot hash is computed over `{url}\n---\n{npm-view-extracted-content}` — content is identical-in-substance to what WebFetch would have returned (registry metadata is the source of truth behind the npmjs.com UI). URL cited in blueprint remains `https://www.npmjs.com/package/@modelcontextprotocol/sdk` per allowlist; fallback documented in snapshot header for auditability. Followup F-allowlist-registry-npmjs logged at tail to add `registry.npmjs.org` to the allowlist (it's the actual API consumed by `npm view`).

**Decision table — server-side entry point (key for v0.3):**

| Subpath | Purpose | What v0.3 would import |
|---|---|---|
| `@modelcontextprotocol/sdk/server` | **BUILD an MCP server** (high-level Server class, transport-agnostic) | `Server` class — register tools/resources/prompts; bind to a transport |
| `@modelcontextprotocol/sdk/server/stdio` (likely under `./server` deep imports) | stdio transport adapter | `StdioServerTransport` — for `npx @usetheo/memory/agent-tools` CLI startup |
| `@modelcontextprotocol/sdk/server/streamableHttp` (likely under `./server` deep imports) | streamable-HTTP transport | `StreamableHttpServerTransport` — for HTTP-deployed MCP servers |
| `@modelcontextprotocol/sdk/server/sse` (likely under `./server` deep imports) | SSE transport (DEPRECATED per MCP spec direction — see Q7) | not recommended for v0.3 |
| `@modelcontextprotocol/sdk/client` | CONSUME an MCP server (irrelevant to v0.3 — we are the server) | not needed |
| `@modelcontextprotocol/sdk/validation` + `./validation/ajv` + `./validation/cfworker` | pluggable JSON Schema validator backends | useful for the LIST-time SchemaHealth pattern from Q1 |

**Dep weight analysis** (for ADR D6 candidate — peer-dep cost):
- **MUST come with the SDK:** ajv (~50 KB), zod (~150 KB), express 5 (~750 KB), hono (~250 KB), eventsource (~30 KB), jose (~280 KB), pkce-challenge (~10 KB) — total roughly **1.5-2 MB** of transitive deps. Significant for a v0.3 binding that's currently zero-runtime-dep beyond v0.1's pgvector+drizzle+pg+zod.
- **Optional via peer-dep:** `@cfworker/json-schema` (alternative validator for Cloudflare Workers context) — not needed unless v0.5+ TheoCloud runs on Cloudflare.
- **Already in TheMemory deps:** `zod ^3.24.0` — overlap with `@modelcontextprotocol/sdk`'s peer-dep `^3.25 || ^4.0`. v0.3 will need to bump zod to ^3.25 minimum OR coordinate with the existing zod-3 MAJOR-outdated soft cap from v0.1 deps audit.

**Implication for ADR D-transport (Q4 + Q7 will refine):** server `./server` + likely 3 transport submodules (stdio / SSE / streamable-HTTP). Letta's `services/mcp/` (Q3+Q4) has all 4 (added fastmcp); SDK ships 3.

**Implication for ADR D-deps:** adopting `@modelcontextprotocol/sdk` adds ~1.5-2 MB of transitive deps. Build-from-scratch (handrolling JSON-RPC + ajv + custom transports) would save deps but violates Inquebrável Rule 9 (Não Reinvente). **ADOPT** verdict (peer-dep with sunset to track if MCP spec adds new transports faster than the SDK).

---

## Coverage Corner 3 — Tools

> Populated from Q3 (Letta + LangMem tool-provider packaging signals).

### Letta + LangMem packaging contrast (Q3)

**Finding: Letta and LangMem ship FUNDAMENTALLY DIFFERENT tool-provider models — they are not comparable apples-to-apples and the divergence is itself the answer. Letta packages a CLIENT-SIDE MCP integration (`letta/services/mcp/base_client.py`, 153 LoC) that consumes external MCP servers via the official `mcp` Python package (sibling of `@modelcontextprotocol/sdk` from Q2). LangMem packages a FRAMEWORK-NATIVE tool-FACTORY pattern (`langmem/knowledge/tools.py`, ≥530 LoC) that returns LangChain `StructuredTool` instances bound to a LangGraph `BaseStore` — no MCP, no JSON-RPC, no transport. Neither ships a first-party MCP SERVER. The implication for v0.3 is unambiguous: there is no template to copy verbatim — v0.3 must compose the MCP server fresh on top of `@modelcontextprotocol/sdk` (Q2), borrowing Letta's lifecycle DISCIPLINE (AsyncExitStack + ExceptionGroup-aware cleanup) and LangMem's tool-FACTORY pattern (runtime namespace resolution + StructuredTool factory shape).**

**Letta — client-side MCP packaging** (`referencia/letta/letta/services/mcp/base_client.py:1-153`):

- **Imports**: `from mcp import ClientSession, Tool as MCPTool`, `from mcp.client.auth import OAuthClientProvider`, `from mcp.types import TextContent` (line 1-12) — i.e. consumes the official Python MCP package (the Python mirror of `@modelcontextprotocol/sdk`).
- **Package shape**: `letta/services/mcp/` is the directory; `base_client.py` is the abstract base class. `__init__.py` is **empty** (0 LoC — pre-confirmed per EC-4 of source plan v1.1). No re-exports; subclasses must import the full path.
- **Class**: `AsyncBaseMCPClient` (line 80+) — abstract, with one class constant `AGENT_ID_HEADER = "X-Agent-Id"`, an `AsyncExitStack` for resource management (line 84), optional `ClientSession` (line 85), and an `initialized` boolean (line 86).
- **4-method lifecycle** (`referencia/letta/letta/services/mcp/base_client.py:90-153`): `connect_to_server()` (sets up transport, opens session), `list_tools(serialize: bool = False) -> list[MCPTool]` (handles pydantic v1/v2 + `__dict__` + `str()` fallbacks for schema serialization), `execute_tool(tool_name, tool_args) -> Tuple[str, bool]` (parses `TextContent` pieces, joins with `" "`, returns `(content, not result.isError)`), `cleanup()` (uses Python 3.11+ `except* Exception as eg:` ExceptionGroup syntax for nested cancel-safe cleanup).
- **Error taxonomy** (line 26-50): `EXPECTED_MCP_TOOL_ERRORS` is a 14-entry tuple of error CLASS NAME strings ("McpError", "ToolError", "HTTPStatusError", "ConnectError", etc.) — used at runtime to classify exceptions as `info`-level (expected) vs `warning`-level (unexpected) in logs. This is a portable discipline: catalog the protocol's expected failure modes so the log signal stays useful.

**LangMem — framework-native tool factory packaging** (`referencia/langmem/src/langmem/knowledge/tools.py:1-80`):

- **Imports** (line 1-10): `from langchain_core.tools import StructuredTool`, `from langgraph.store.base import BaseStore`, `from langgraph.utils.config import get_store`, `from langmem import errors, utils`. **Zero MCP imports.** This is purely LangChain + LangGraph.
- **Public function**: `create_manage_memory_tool(namespace, *, instructions, schema, actions_permitted, store, name='manage_memory')` (line 25-69) — a FACTORY that returns a `StructuredTool`. Not a class; not a server; not a protocol implementation.
- **Tool-binding shape**: the returned tool has signature `manage_memory(content: str | None, id: str | None, action: Literal['create', 'update', 'delete']) -> str` (line 64-68). I.e. ONE tool function with an action enum — NOT four separate tools.
- **Runtime namespace resolution**: `namespace` is `tuple[str, ...] | str` with runtime placeholders like `{langgraph_user_id}` resolved from `config = {"configurable": {"langgraph_user_id": "user-123"}}` (line 72-77). Pattern: scope resolution at INVOCATION time, not at registration time. This mirrors what TheMemory's v0.2 `memoryFromCtx` does in TypeScript — and confirms it's a portable cross-framework pattern.
- **No transport, no JSON-RPC, no `tools/list`**: the tool is consumed directly by LangGraph's agent loop via Python function-calling. LangMem is INVISIBLE to MCP-native agents.

**Comparison table**:

| Dimension | Letta `services/mcp/` | LangMem `knowledge/tools.py` |
|---|---|---|
| MCP-aware? | YES (consumes external MCP servers) | NO (LangChain/LangGraph-native) |
| Ships a server? | NO (client only) | NO (in-process tool factory) |
| Tool count | N (whatever external server exposes) | 1 with action enum |
| Transport | stdio + SSE + streamable-HTTP + fastmcp (per Q4) | none (Python function call) |
| Schema codegen | Delegates to MCP server author | LangChain `StructuredTool` (Pydantic or `str` schema) |
| Namespace resolution | Per-agent header (`X-Agent-Id`) | Runtime config via `{langgraph_user_id}` placeholder |
| Lifecycle | 4 methods: connect/list/execute/cleanup | None — `StructuredTool` is stateless |
| Resource discipline | `AsyncExitStack` + `except*` ExceptionGroup | None (LangChain handles) |

**Implication for v0.3 architecture** (refines ADR D-transport + D-schema + D-isolation candidates):

1. **Adopt Letta's lifecycle discipline** for the SERVER side: v0.3's MCP server class should mirror `connect_transport` / `list_tools` / `execute_tool` / `cleanup` with `AsyncExitStack`-equivalent Node.js patterns (`async cleanup()` that awaits all sub-resources). The 4-method shape is portable; we just flip client → server.
2. **Adopt LangMem's runtime-scope resolution PATTERN** (not the API): v0.3's MCP server must resolve `userId/sessionId/agentId` from JSON-RPC request CONTEXT (likely via `X-Agent-Id` header per Letta — see Q4 for confirmation), NOT from constructor args. This matches v0.2's `memoryFromCtx(ctx, memory)` discipline.
3. **REJECT a single-tool-with-action-enum shape** (LangMem's `manage_memory(action='create'|'update'|'delete')`). CLAUDE.md Roadmap Item 4 acceptance test specifies "exactly 4 tools with stable names" (`remember`, `recall`, `forget`, `reflect`). Stick with 4 separate tools — better DX for agent function-calling, better schema-validation granularity per Q1's SchemaHealth pattern.
4. **Adopt Letta's `EXPECTED_MCP_TOOL_ERRORS` discipline**: v0.3 should catalog its expected error classes (e.g., `MissingScopeError`, `MemoryStoreError`, `EmbedderError`) and log-level-classify them at the JSON-RPC error-response boundary. Portable.

---

## Coverage Corner 4 — Techniques

> Populated from Q4 (Letta full MCP technique), Q5 (Mem0 plugin-only), Q6 (LangMem BaseStore pattern).

### Technique 1 — Letta MCP server/client implementation across transports (Q4)

**Finding: Letta ships THREE lower-level MCP transports (stdio / SSE / streamable-HTTP) via the Template Method pattern (shared `AsyncBaseMCPClient` from Q3 owns the lifecycle; each transport subclass only implements `_initialize_connection()`), plus a FOURTH higher-level path (`fastmcp_client.py`) that explicitly REPLACES SSE + streamable-HTTP for OAuth-rich scenarios by re-implementing the contract on top of `fastmcp.Client`. The transport state is carried in headers (`X-Agent-Id` constant), and streamable-HTTP applies typed error remapping (404 → "MCP server not found", Connection-error → "Please check the server is running", JSON-validation error → "may not be a proper MCP server"). Only stdio + SSE are declared as `MCPServerType` enum members in `types.py`; streamable-HTTP lives as its own non-enumerated config type (suggests it was added later, post-enum lock).**

Four transport files interrogated:

1. **`stdio_client.py` (26 LoC)** (`referencia/letta/letta/services/mcp/stdio_client.py:1-26`):
   - Imports: `from mcp.client.stdio import stdio_client` + `StdioServerParameters` (line 3-4). Uses the official Python MCP package directly (mirror of `@modelcontextprotocol/sdk/client/stdio` from Q2).
   - Class: `AsyncStdioMCPClient(AsyncBaseMCPClient)` (line 14).
   - **Single overridden method**: `async def _initialize_connection(self, server_config: StdioServerConfig) -> None:` (line 18-26).
   - Pattern: arg-flatten via list comprehension (line 19-21) → builds `StdioServerParameters(command, args, env)` → opens `stdio_client(server_params)` via `self.exit_stack.enter_async_context(...)` → unpacks `(self.stdio, self.write)` → wraps in `ClientSession(self.stdio, self.write)` on the same exit stack.
   - **Key discipline**: BOTH the transport context manager AND the `ClientSession` are entered on the same `AsyncExitStack`. Cleanup propagates correctly regardless of which step fails.

2. **`sse_client.py` (52 LoC)** (`referencia/letta/letta/services/mcp/sse_client.py:1-52`):
   - Imports: `from mcp.client.sse import sse_client` + `OAuthClientProvider` (line 3-5). One-line URL comment: `# see: https://modelcontextprotocol.io/quickstart/user` (line 12) — pointer to the canonical spec quickstart.
   - Class: `AsyncSSEMCPClient(AsyncBaseMCPClient)` (line 19).
   - **Header composition** (line 26-34): builds dict from `server_config.custom_headers`, then optional `auth_header / auth_token` pair, then optional `AGENT_ID_HEADER` (the class constant from `base_client.py` from Q3). Constructive layering — never replaces, always merges.
   - **OAuth fork** (line 39-44): branches on `self.oauth_provider`: with provider uses `sse_client(url, headers, auth, timeout)`; without uses `sse_client(url, headers, timeout)`. Same template, two arg shapes.
   - **Module-level constant**: `MCP_CONFIG_TOPLEVEL_KEY = "mcpServers"` (line 13) — Claude Desktop / Cursor config-file shape compatibility.

3. **`streamable_http_client.py` (82 LoC)** (`referencia/letta/letta/services/mcp/streamable_http_client.py:1-82`):
   - Imports: `from mcp.client.streamable_http import streamablehttp_client` + `from datetime import timedelta` (line 1-6). Timeout typed as `timedelta` (not seconds-int) per streamable-HTTP requirement (line 44).
   - Class: `AsyncStreamableHTTPMCPClient(AsyncBaseMCPClient)` (line 16).
   - **Type guard** (line 26-27): `if not isinstance(server_config, StreamableHTTPServerConfig): raise ValueError("Expected StreamableHTTPServerConfig")`. Defensive — same parent class accepts any `BaseServerConfig` so subclasses self-check.
   - **Same header composition** as SSE (line 30-40) — `custom_headers` + `auth_header`/`auth_token` + `X-Agent-Id`. Discipline portable.
   - **Tuple unpacking adjustment** (line 56): `streamablehttp_client` returns `(read_stream, write_stream, _)` — third element unused (it's a session-id callback per MCP spec — see Q7).
   - **Typed error remapping** (line 61-81) — 3 distinct exception shapes mapped to `ConnectionError`:
     - `"404"` or `"Not Found"` in message → "MCP server not found at URL: {url}. Please verify the URL is correct and the server supports the MCP protocol."
     - `"Connection"` or `"connect"` → "Failed to connect to MCP server at: {url}. Please check that the server is running and accessible."
     - `"JSON"` AND `"validation"` → "MCP server at {url} is not returning valid JSON-RPC responses. The server may not be a proper MCP server or may be returning empty/invalid JSON."
     - Else → wraps original with "Failed to initialize streamable HTTP connection to {url}: {str(e)}"

4. **`fastmcp_client.py` (lines 1-80 of 384)** (`referencia/letta/letta/services/mcp/fastmcp_client.py:1-80`):
   - Module docstring is load-bearing (line 1-9 quoted verbatim): "FastMCP-based MCP clients with server-side OAuth support. ... **These clients replace the existing AsyncSSEMCPClient and AsyncStreamableHTTPMCPClient implementations that used the lower-level MCP SDK directly.**"
   - **Architectural pivot signal**: Letta evolved from raw `mcp` SDK clients to `fastmcp`-based clients SPECIFICALLY for OAuth flow control (server-side OAuth where the auth URL is forwarded to a web client rather than opening a browser locally — see line 3-5).
   - Class: `AsyncFastMCPSSEClient` (line 28) — does NOT extend `AsyncBaseMCPClient`. Re-implements the lifecycle because `fastmcp.Client` has its own contract (`await self.client._connect()`).
   - Same `AGENT_ID_HEADER = "X-Agent-Id"` constant (line 41) — copied because no base-class inheritance.
   - `AsyncExitStack` retained (line 54) — pattern is portable even when the base class isn't.

**`types.py` (58 LoC)** (`referencia/letta/letta/services/mcp/types.py:1-58`):
- `MCPServerType` enum (line 12-15): only `SSE` and `STDIO`. **`StreamableHTTPServerConfig` exists but is NOT enumerated** — suggesting it was added AFTER the enum was locked and the team accepted the asymmetry rather than breaking config-schema compatibility (operational lesson: don't put transport types in an enum if you expect to add more).
- `BaseServerConfig` (line 17-19): only `server_name` + `type`. Subclasses extend.
- `StdioServerConfig.to_dict()` (line 40-48): emits `{transport: "stdio", command, args, env?}` shape — Claude Desktop / Cursor config compatibility.
- `SSEServerConfig.to_dict()` (line 26-31): emits `{transport: "sse", url}` shape.
- `OauthStreamEvent` enum (line 51-57): 6-state OAuth lifecycle: `CONNECTION_ATTEMPT, SUCCESS, ERROR, OAUTH_REQUIRED, AUTHORIZATION_URL, WAITING_FOR_AUTH`. State machine for SSE-based auth-required interruption pattern.

**Implication for ADR D-transport** (v0.3 SERVER side, not client):

| Transport | Adopt for v0.3? | Rationale |
|---|---|---|
| **stdio** | YES (primary) | Simplest, most common for local agent dev (Claude Desktop, Cursor, `npx @usetheo/memory/agent-tools`). 26 LoC server-side wrapper is the floor. |
| **streamable-HTTP** | YES (secondary) | Production HTTP deploy path; pairs with TheoCloud (v0.5). Adopt Letta's typed error remapping discipline at the SERVER's request-handler boundary. |
| **SSE** | DEFER (revisit at Q7) | Deprecated per MCP spec direction (per Q1 SSE test was `@pytest.mark.skip(reason="...deepwiki SSE...deprecated")`); Letta's own evolution to fastmcp signals SSE is the legacy path. **Defer to Q7 confirmation of spec status.** |
| **fastmcp-style higher-level wrapper** | DEFER (post-v0.3) | OAuth-rich flows aren't v0.3 scope (CLAUDE.md Item 4 acceptance lists no OAuth). Revisit if `@usetheo/sdk` agents need server-side OAuth for multi-tenant deployments. |

**Implication for ADR D-isolation** (cross-tool state isolation per question 'expected answer shape'):
- Letta uses `X-Agent-Id` header to bind transport SESSION to agent identity. Per-session = per-agent isolation at the TRANSPORT layer.
- v0.3's MCP server must do the equivalent: extract scope (`userId/sessionId/agentId`) from JSON-RPC request CONTEXT (headers for streamable-HTTP, env-var-or-handshake for stdio), then memo-cache the scoped `Memory` instance for the lifetime of that session.
- **Reuse `memoryFromCtx` from v0.2** — the binding is already there; v0.3 wraps it at the JSON-RPC request boundary.

**Implication for ADR D-schema** (tool schema declaration):
- Letta delegates: `list_tools()` (Q3) returns whatever the EXTERNAL MCP server exposes; Letta doesn't author the schemas. v0.3 is the AUTHOR — must declare its own 4-tool schema.
- Q2's snapshot showed `@modelcontextprotocol/sdk` ships `zod-to-json-schema` — adopt the pattern: define tool input/output with `zod` (already a TheMemory dep), let the SDK convert to JSON Schema for `tools/list` response.
- Cross-references Q1's `SchemaHealth` 3-tier enum: v0.3's `tools/list` response should include per-tool health metadata (probably STRICT_COMPLIANT for all 4 — we author them, we control them).

**Implication for ADR D-test-pyramid** (refines Q1 finding):
- v0.3 E2E test should spawn the v0.3 stdio server as subprocess + send `tools/list` + `tools/call` JSON-RPC messages over stdin/stdout pipes. Mirror Letta's `test_stdio_mcp_server` (`referencia/letta/tests/mcp_tests/test_mcp.py:213-270`) approach but compressed — no venv-per-test, no real-agent loop.
- v0.3 streamable-HTTP test should mirror Q1's mock pattern: mock the transport at request-handler boundary, exercise the 4-tool dispatch + scope binding.

### Technique 2 — Mem0 first-party MCP presence (Q5)

**Finding: ADR D5 v1.1 + EC-5's assumption ("Mem0 ships NO first-party MCP server, plugin-pointer only") is INCORRECT and OVERTURNED by this investigation. Mem0 ships a 574-LoC first-party MCP server at `referencia/mem0/openmemory/api/app/mcp_server.py` using the `mcp.server.fastmcp.FastMCP` decorator pattern (Python equivalent of `@modelcontextprotocol/sdk`'s high-level Server class from Q2). It wires BOTH `SseServerTransport` (line 35) AND `StreamableHTTPServerTransport` (line 36) and runs them via FastAPI request handlers. Exposes **5 tools** (`add_memories`, `search_memories`, `list_memories`, `delete_memories`, `delete_all_memories`) — NOT 9 (the 9-tool count in `referencia/mem0/CLAUDE.md § MCP Integration` refers to the `mem0-plugin/` tool list, which is the OpenMemory hosted product, not this self-hosted FastMCP server). Scope binding via Python `contextvars.ContextVar` (`user_id_var`, `client_name_var`) populated from FastAPI request path-parameters. Streamable HTTP runs in `stateless=True` mode (line 546). The Mem0 SKILL.md at `referencia/mem0/mem0-plugin/skills/mem0-mcp/SKILL.md` is the AGENT-FACING prompt (decide-to-search heuristics, metadata filter shapes, expiration rules) — a separate artifact from the server code.**

**Paired-pass results (per ADR D5 v1.1 + EC-5 broadened grep):**

- Pass 1: `referencia/mem0/mem0-plugin/skills/mem0-mcp/SKILL.md` EXISTS (~188 lines). Content: agent-facing protocol — when to search, how to phrase queries (nouns not sentences), metadata filter shape (`{"AND": [...]}` v2 spec rooted in logical operator), expiration discipline (`expiration_date` for session_state vs durable types), `infer=False` for pre-extracted content. This is a PROMPT, not server code.
- Pass 2: `grep -rln 'tools/list\|tools/call\|@modelcontextprotocol\|JSONRPCRequest' referencia/mem0 --include="*.py"` returned 1 file: `openmemory/api/tests/test_mcp_server.py`. BUT a broader `find -path '*mcp*' -type f` revealed `openmemory/api/app/mcp_server.py` (574 LoC server) + 5 other MCP-named artifacts (`.mcp.json` configs, docs `.mdx`). The grep missed `mcp_server.py` because it uses `from mcp.server.fastmcp import FastMCP` rather than the lower-level `tools/list` / `tools/call` JSON-RPC method names. Operational lesson: greps for protocol-string literals miss higher-level SDK wrappers — `find` with path glob is the more reliable first-pass instrument.

**Server architecture (`referencia/mem0/openmemory/api/app/mcp_server.py:1-574`):**

| Concern | Implementation | Citation |
|---|---|---|
| MCP framework | `from mcp.server.fastmcp import FastMCP` + `mcp = FastMCP("mem0-mcp-server")` | lines 34, 43 |
| Transports | SSE (`SseServerTransport("/mcp/messages/")`) + Streamable HTTP (`StreamableHTTPServerTransport`) | lines 35, 36, 62 |
| Tool registration | `@mcp.tool(description="...")` decorator on `async def` functions; tool name = function name | line 64, 149, 227, 296, 370 |
| Scope binding | `contextvars.ContextVar` set from FastAPI request path-params, reset in `finally:` | lines 55-56, 440-442, 510-512, 554-555 |
| Memory client init | `get_memory_client_safe()` returns None on failure; tool returns "Memory system is currently unavailable" string instead of throwing | lines 46-52, 75-77 |
| Tool error shape | String returns: `"Error: user_id not provided"`, `"Error: App {name} is currently paused"` | lines 70, 72, 86 |
| Tool side-effects | Direct ORM writes inside tool body (`Memory`, `MemoryStatusHistory`) via `SessionLocal()` + try/finally | lines 80-145 |
| Streamable HTTP mode | `stateless=True` per spec 2025-03-26+ (replaces deprecated SSE) | lines 502, 546 |
| Double-response prevention | Custom `capture_send` ASGI wrapper to intercept transport's response + return single `Response` to FastAPI | lines 514-566 |

**Tool inventory (5 — exact decorator strings):**

| # | Tool name | Description (first sentence) |
|---|---|---|
| 1 | `add_memories` | "Add a new memory. This method is called everytime the user informs anything about themselves, their preferences..." |
| 2 | `search_memories` | "Search through stored memories. This method is called EVERYTIME the user asks anything." |
| 3 | `list_memories` | "List all memories in the user's memory" |
| 4 | `delete_memories` | "Delete specific memories by their IDs" |
| 5 | `delete_all_memories` | "Delete all memories in the user's memory" |

**Implication for ADR D-tool-count** (v0.3 CLAUDE.md Item 4 acceptance — "exactly 4 tools with stable names"):
- CLAUDE.md acceptance specifies `remember/recall/forget/reflect` (4 verbs). Mem0 maps to 5 (split forget into delete-by-id + delete-all + no list-only variant). v0.3 should HOLD AT 4 because reflect (v0.4a) is async/scheduled and forget can subsume single+bulk via id-or-undefined arg. Pattern divergence is justified.

**Implication for ADR D-error-shape** (v0.3 JSON-RPC error responses):
- Mem0 returns ERROR STRINGS from tool bodies (`return "Error: user_id not provided"`). The MCP protocol distinguishes `result` from `error` at the JSON-RPC layer (Q7 will confirm via spec). v0.3 SHOULD use proper JSON-RPC `error` objects (with code + message + data) for failures, NOT string-encoded errors. Mem0's choice is pragmatic but loses structured error metadata at the protocol boundary.

**Implication for ADR D-scope-binding** (cross-tool isolation):
- Mem0's `contextvars` pattern is the Python analog of what v0.3 needs in TypeScript. **Equivalent TS pattern**: `AsyncLocalStorage` from `node:async_hooks` — same shape (value set per request lifecycle, automatic propagation across async boundaries, reset on cleanup). Adopt `AsyncLocalStorage<ScopedContext>` for v0.3's request-scoped memory binding. The `try/finally` reset discipline is non-negotiable — failure to reset leaks scope across requests.

**Implication for ADR D-transport** (refines Q4 + Q2):
- Mem0 wires BOTH SSE + Streamable HTTP in the same process; SSE preserved for backward compat. Line 500-502 verbatim: "Streamable HTTP transport (MCP spec 2025-03-26+) which **replaces the deprecated SSE transport**." Third independent confirmation that SSE is deprecated (Q1 `@pytest.mark.skip` + Q4 fastmcp evolution + Q5 line 500-502). v0.3 should ship streamable-HTTP + stdio; explicitly DEFER SSE.

**Implication for ADR D-graceful-degradation** (operational discipline):
- Mem0's `get_memory_client_safe()` + None-fallback + "Memory system is currently unavailable" string return is a pattern v0.3 should adopt for adverse-environment scenarios (DB down, embedder unreachable). BUT in JSON-RPC error form, not string-encoded.

**EC-5 retrospective:** the v1.1 EC-5 broadened grep was correct as a SAFETY NET (catches more files than the SKILL.md-only check) but still INSUFFICIENT — it grepped for low-level JSON-RPC method names (`tools/list`, `tools/call`) which higher-level SDK wrappers like `FastMCP` abstract away. Followup F-eccheck-find-pattern logged at tail to add `find -path '*mcp*' -type f` to the paired-pass discipline.

### Technique 3 — LangMem framework-native tool pattern (Q6)

**Finding: LangMem ships TWO tool factories (`create_manage_memory_tool` and `create_search_memory_tool`) in `referencia/langmem/src/langmem/knowledge/tools.py` (530 LoC). Both return LangChain `StructuredTool` (or the custom `_ToolWithRequired` subclass for `manage_memory` to force `required` array emission). Each factory writes BOTH sync and async function variants (`manage_memory`/`amanage_memory`, `search_memory`/`asearch_memory`) and passes both to `StructuredTool.from_function(sync, async, ...)` — cross-runtime compatibility for LangGraph nodes that may be either. Scope is resolved at INVOCATION time via `_get_store(initial_store)` which tries the constructor-injected store first, then falls back to LangGraph's runtime resolver `get_store()` (from `langgraph.utils.config`). Wraps `RuntimeError` in domain `ConfigurationError`. Defensive serialization (`_ensure_json_serializable`) handles primitives + Pydantic `model_dump(mode='json')` + str() fallback. The `manage_memory` tool collapses create/update/delete into a single tool via an `actions_permitted` enum + per-action argument validation (ID required for update/delete; ID forbidden for create). Description string is dynamically composed from `actions_permitted` cardinality (1/2/N+) producing natural-language verb lists.**

**Five top-level definitions** (`referencia/langmem/src/langmem/knowledge/tools.py`):

1. **`create_manage_memory_tool(namespace, *, instructions, schema, actions_permitted, store, name)` (line 25)** — returns `_ToolWithRequired.from_function(manage_memory, amanage_memory, name, description)`.
   - **Action collapsing** (line 263-268): `actions_permitted` enum determines the tool's allowed verbs; default action is `create` if present else the first listed.
   - **Body discipline** (line 271-337): both sync and async variants enforce:
     - Action membership (line 278-281): `raise ValueError(f"Invalid action {action}. Must be one of {actions_permitted}.")`
     - Create-vs-id contract (line 283-286): `"You cannot provide a MEMORY ID when creating a MEMORY."`
     - Delete/update-requires-id contract (line 288-291): `"You must provide a MEMORY ID when deleting or updating a MEMORY."`
   - **Return shape**: plain strings ("Deleted memory {id}", "{action}d memory {id}") — same string-return shape as Mem0's Q5 server.
   - **Dynamic description** (line 339-352): switches on cardinality of `actions_permitted`:
     - 1 verb: `"create a memory"`
     - 2 verbs: `"Create or update a memory"`
     - N≥3: `"Create, update, or delete a memory"` (Oxford-comma joined with first capitalized)

2. **`create_search_memory_tool(namespace, *, instructions, store, response_format, name)` (line 362)** — returns standard `StructuredTool.from_function(search_memory, asearch_memory, ...)`.
   - **Signature** (line 391-396): `search_memory(query: str, limit: int = 10, offset: int = 0, filter: dict | None = None) -> tuple[list[dict], list]`.
   - **Response-format split** (line 452-454, 472-474): `"content"` returns serialized memory JSON; `"content_and_artifact"` returns `(serialized_str, raw_memories)` tuple for downstream tool composition.

3. **`_get_store(initial_store)` (line 489-497)** — scope resolver:
   - If `initial_store` is not None → use it (constructor-injected case, line 491-492).
   - Else → call `get_store()` from `langgraph.utils.config` (runtime LangGraph context, line 494).
   - Wraps `RuntimeError` (raised when no LangGraph context) in domain `errors.ConfigurationError("Could not get store")` (line 496-497).

4. **`_ensure_json_serializable(content)` (line 500-510)** — defensive serialization:
   - Primitives (`str, int, float, bool, dict, list`) pass through (line 502-503).
   - Pydantic models → `model_dump(mode='json')` (line 504-507); str() fallback on exception with `logger.error(e)` (line 508-509).
   - Otherwise → passthrough.

5. **`_ToolWithRequired(StructuredTool)` (line 513-526) + `_ensure_schema_contains_required(schema)` (line 529)** — schema injection workaround:
   - Custom subclass overrides `tool_call_schema` cached property.
   - Injects `_ensure_schema_contains_required` as `json_schema_extra` on the Pydantic model_config.
   - Forces the emitted JSON Schema to include the `required` array (LangChain's default behavior is unreliable for schemas with optional fields).

**Contrast with Letta + Mem0 + v0.3 plan**:

| Dimension | LangMem | Letta (Q3 client) | Mem0 OpenMemory (Q5) | v0.3 CLAUDE.md plan |
|---|---|---|---|---|
| Tool count | 2 (manage + search) | N (external server defines) | 5 (add/search/list/delete/delete_all) | **4** (remember/recall/forget/reflect) |
| Action collapsing | YES (manage subsumes create/update/delete via enum) | N/A (client) | NO (split per verb) | NO (split per verb) |
| Sync+async dual | YES (paired StructuredTool factory) | NO (async only) | NO (async FastMCP only) | NO (async only, Node.js) |
| Scope resolution | `get_store()` runtime fallback | `X-Agent-Id` header per request | `contextvars.ContextVar` from FastAPI path-param | `memoryFromCtx(ctx)` from AsyncLocalStorage |
| Schema framework | LangChain `StructuredTool` (Pydantic) | MCP `Tool` (delegated) | `FastMCP` decorator (Pydantic) | `@modelcontextprotocol/sdk` + zod-to-json-schema (planned Q2) |
| Return shape | Plain string ("Deleted memory {id}") OR tuple `(serialized, raw)` | `Tuple[str, bool]` (content, isError-inverted) | Plain string error or success | **TBD — should be proper JSON-RPC `result` object** per Q7 |
| Error shape | `raise ValueError` (Python exception) | Logged via `_log_mcp_tool_error` + classifier | String return ("Error: ...") | **JSON-RPC `error` object** per Q7 |
| Description generation | Dynamic from `actions_permitted` cardinality | External server defines | Decorator-string author defines | Author defines (likely zod `.describe()` chains) |

**Implications for v0.3**:

1. **REJECT LangMem's action collapsing** (CLAUDE.md Item 4 locks 4 separate verbs). LangMem's `manage_memory(action='create'|'update'|'delete')` shape consolidates 3 tools into 1 with worse schema clarity (each action has different argument requirements; the schema can't statically encode "id is forbidden when action=create"). The MCP `tools/list` discovery is better served by 4 distinct tools with clean schemas. KEEP the 4-tool split.

2. **ADOPT LangMem's `_get_store(initial_store)` fallback pattern** for v0.3's MCP server tool body:
   ```typescript
   const memory = injectedMemory ?? memoryFromCtx(asyncLocalStorage.getStore(), defaultMemoryFactory());
   ```
   Same shape — constructor-injectable for tests, runtime-resolved for production.

3. **ADOPT LangMem's argument-contract validation pattern** at tool entry (e.g., `forget(id)` MUST throw if id is missing/invalid). Use zod's runtime validation — already in v0.3's planned deps.

4. **REJECT LangMem's sync+async dual factory**. Node.js MCP server only handles async. Skip the paired-function discipline.

5. **REJECT LangMem's plain-string return for tool errors**. Same lesson as Q5 (Mem0): use proper JSON-RPC `error` objects with code + message + data — preserves structured error metadata at the protocol boundary.

6. **DEFER schema injection workaround (`_ToolWithRequired`)** to Q7 verification: confirm `@modelcontextprotocol/sdk` + `zod-to-json-schema` emits `required` array correctly by default. Likely YES (zod is stricter than Pydantic about optional vs required); LangMem's workaround exists because LangChain's emit is unreliable. v0.3 probably doesn't need an analog.

7. **OBSERVE LangMem's `_ensure_json_serializable` defensive pattern**. v0.3 has the same risk if `remember(content: unknown)` accepts arbitrary user shapes — but with strict zod schemas at the tool boundary, the risk is eliminated upstream. Use zod-schemas-everywhere instead of runtime serialization fallback.

---

## Coverage Corner 5 — Prior Art

> Populated from Q7 (official MCP spec via WebFetch + snapshot) + Q8 (`../theokit-sdk/` tool-provider contract). NEW 5th corner per cycle-discover.md v1.1.

### Official MCP Specification (Q7)

**Finding: MCP spec version locked per EC-3 checkpoint is `2025-11-25` (latest revision at investigation time). The protocol uses JSON-RPC 2.0 with stricter ID rules (no null, no reuse per session). Tools are exposed via `tools/list` (paginated via `cursor` / `nextCursor`) + `tools/call` (name + arguments). Tool result returns `content[]` array of mixed-type blocks (text / image / audio / resource_link / embedded resource) + optional `structuredContent` JSON object + optional `outputSchema` for validation. CRITICAL: spec defines TWO distinct error mechanisms — **Protocol Errors** (JSON-RPC `error` object: `{code, message, data?}` for malformed requests / unknown tools — models cannot self-correct) and **Tool Execution Errors** (`result.isError: true` + content blocks for business-logic / validation failures — clients SHOULD forward to LLM for self-correction). JSON Schema 2020-12 is the default dialect; clients/servers MUST support it. Servers MUST declare `capabilities.tools.listChanged` capability. Tool names: 1-128 chars, case-sensitive, `[A-Za-z0-9_.-]` only, unique per server. SSE transport is NOT mentioned in the 2025-11-25 overview / base / tools pages — fourth independent confirmation of deprecation (combined with Q1's `@pytest.mark.skip` + Q4's fastmcp evolution narrative + Q5's line 500-502 verbatim "replaces the deprecated SSE transport").**

**URL locked per EC-3 + cited:** `https://modelcontextprotocol.io/specification/2025-11-25` (overview) + `/basic` (Base Protocol) + `/server/tools` (Tools primitive).

**Snapshots persisted (per cycle-discover.md v1.1 — snapshot-before-cite):**
- Overview: `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/7d8ecd2f18ab2f1d7736f63be55db4cf415d3724f47fc0ffb4761efd273beed5.md`
- Base Protocol: `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/192795bae1ffe7a680619c0942b88d58c09496a32eb7e29ba225f522872027e0.md`
- Tools: `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/6a7fb44653d9849c4d0add52077e61f7d164aca0f26748215d1d9b15c3898c1e.md`

**Protocol architecture (verbatim from snapshot 7d8ecd...):**
- **Hosts** — LLM applications that initiate connections
- **Clients** — Connectors within the host application
- **Servers** — Services that provide context and capabilities (this is what v0.3 is)

Server features: Resources / Prompts / **Tools** (3 primitives). Client features: Sampling / Roots / Elicitation. **All implementations MUST support base protocol + lifecycle management; other components MAY be implemented.**

**JSON-RPC 2.0 message shapes (verbatim from snapshot 192795...):**

| Message | Required fields | Notes |
|---|---|---|
| Request | `jsonrpc, id, method, params?` | ID MUST NOT be null; MUST NOT be reused within session |
| Result Response | `jsonrpc, id, result` | Same ID as request; `result` MAY be any JSON object |
| Error Response | `jsonrpc, id?, error{code, message, data?}` | `code` MUST be integer |
| Notification | `jsonrpc, method, params?` | NO ID; receiver MUST NOT respond |

**`tools/list` request/response shape (verbatim from snapshot 6a7fb4...):**
```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": { "cursor": "optional" } }

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "get_weather",
        "title": "...", "description": "...",
        "inputSchema": { /* JSON Schema 2020-12 */ },
        "outputSchema": { /* optional */ },
        "annotations": { /* optional, UNTRUSTED unless from trusted server */ },
        "icons": [{ "src": "...", "mimeType": "image/png", "sizes": ["48x48"] }],
        "execution": { "taskSupport": "forbidden|optional|required" }
      }
    ],
    "nextCursor": "..."  // optional pagination
  }
}
```

**`tools/call` request/response shape (verbatim):**
```json
// Request
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "get_weather", "arguments": { "location": "NY" } } }

// Response (success)
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "..." }],
    "isError": false,
    "structuredContent": { /* optional, typed per outputSchema */ }
  }
}
```

**Error mechanism table (CRITICAL — locks v0.3's error design):**

| Mechanism | Wire shape | When to use | LLM self-correct? |
|---|---|---|---|
| **Protocol Error** | JSON-RPC top-level `error.{code, message, data?}` | Unknown tool, malformed request (failed CallToolRequest schema), server error | Less likely (-32602 means args wrong; -32601 means tool not found) |
| **Tool Execution Error** | `result.isError: true` + content blocks | Input validation failure, business logic error, API timeout | YES — clients SHOULD forward to LLM with the content text as actionable feedback |

**Content block types (5 — within `result.content`):**

| Type | Wire shape | Use case |
|---|---|---|
| `text` | `{ type: "text", text: "..." }` | Most common — string output |
| `image` | `{ type: "image", data: "base64...", mimeType: "image/png" }` | Visual output |
| `audio` | `{ type: "audio", data: "base64...", mimeType: "audio/wav" }` | Audio output |
| `resource_link` | `{ type: "resource_link", uri: "file:///...", name, description, mimeType }` | URI pointer to a Resource |
| `resource` (embedded) | `{ type: "resource", resource: { uri, mimeType, text } }` | Inline-embedded resource bytes |

**JSON Schema discipline (`tools[N].inputSchema` constraints, verbatim):**
- Default dialect: JSON Schema 2020-12 (when no `$schema` field).
- `inputSchema` MUST be a valid JSON Schema object (not null).
- For tools with no parameters: `{ "type": "object", "additionalProperties": false }` (RECOMMENDED — explicitly accepts only empty objects) OR `{ "type": "object" }` (accepts any object).
- Implementations MUST support 2020-12 and MUST validate schemas; MUST handle unsupported dialects with an error.

**Tool name constraints (verbatim, all SHOULD-level):**
- 1-128 characters
- Case-sensitive
- Allowed chars: `[A-Za-z0-9_.-]`
- SHOULD NOT contain spaces, commas, special chars
- SHOULD be unique within a server
- Example valid: `getUser`, `DATA_EXPORT_v2`, `admin.tools.list`

**Capability negotiation (must precede `tools/list`):**
- Server declares: `{ "capabilities": { "tools": { "listChanged": true } } }`
- `listChanged: true` → server MAY send `notifications/tools/list_changed` when tool set changes; client should re-call `tools/list` on receipt.

**Auth framework (verbatim):**
- HTTP-based transports SHOULD conform to the Authorization spec at `/basic/authorization`.
- STDIO transports SHOULD NOT — instead retrieve credentials from environment.
- Clients + servers MAY negotiate custom auth strategies.

**Implications for v0.3 — LOCKS several ADRs:**

1. **ADR D-error-shape LOCKED:** v0.3 MUST use BOTH mechanisms (the spec mandates it):
   - **Protocol errors** for: tool name not found, malformed JSON, missing scope (would be `-32602 Invalid params` since scope-binding is a request-level concern).
   - **Tool execution errors** (`isError: true`): for `MemoryStoreError`, `EmbedderError`, `MissingScopeError` thrown inside a tool body — these SHOULD be forwarded to the LLM with actionable text so the model can self-correct (e.g., "user_id not authenticated; ask user to log in first").
   - REJECTS Mem0's string-return shape (Q5) — Mem0 returns plain strings WITHOUT `isError: true`, so clients can't distinguish error from success. Non-compliant with spec.

2. **ADR D-tool-name LOCKED:** v0.3's 4 tool names (`remember`, `recall`, `forget`, `reflect`) are all spec-compliant (≤128 chars, case-sensitive, no special chars). Unique within server. Good DX.

3. **ADR D-schema-validation LOCKED:** v0.3 uses JSON Schema 2020-12 (default dialect). zod-to-json-schema (Q2) emits 2020-12-compliant schemas by default — verify via fixture test. NO need for LangMem's `_ToolWithRequired` workaround (Q6) since zod always emits `required` array.

4. **ADR D-structured-content NEW:** v0.3 SHOULD ship `outputSchema` + `structuredContent` for `recall` (the only verb returning typed JSON: array of `{id, text, score, attributedTo?, scope, timestamp}`). For `remember/forget/reflect`, return single text content block with status. Cross-references Q5: Mem0's `add_memories` returns string "memory_id" — primitive; v0.3's `recall` will be richer.

5. **ADR D-capability-listChanged NEW:** v0.3's 4 tools are STATIC (set at server boot). Declare `"listChanged": false` — no dynamic tool registration in scope. Document as deliberate per CLAUDE.md Item 4 (no Voyager-style skill-library at v0.3 — that lands v0.6).

6. **ADR D-transport CONFIRMED:** Spec pages do NOT mention SSE as a recommended transport (only basic / tools / overview fetched — but combined with Q1 + Q4 + Q5 evidence, SSE is the legacy path). v0.3 ships stdio + streamable-HTTP. The spec's `/basic/transports` page (not fetched here — token budget) is the canonical transport list; followup F-mcp-spec-transport-page logged at tail to fetch it before locking the final ADR.

7. **ADR D-auth-out-of-scope:** v0.3 is stdio + streamable-HTTP. Per spec, stdio SHOULD NOT use HTTP auth (env vars only); streamable-HTTP could but v0.3 defers OAuth to v0.5 cloud (matches Q4 fastmcp deferral). Document explicit deferral.

8. **Spec hands us the test pyramid for free (cross-references Q1):**
   - **Pure unit**: schema validator runs JSON Schema 2020-12 validation against synthetic inputs.
   - **Unit-with-mocks**: mock JSON-RPC transport, assert `tools/list` returns exactly 4 tools + correct shape + `capabilities.tools.listChanged: false`.
   - **E2E**: spawn stdio server, send `initialize` handshake + `tools/list` + `tools/call` for each verb, assert content blocks + `isError: false` on happy path + `isError: true` with text on validation failure.

### `@usetheo/sdk` tool-provider integration surface (Q8)

**Finding: `@usetheo/sdk` at SHA `6d9d553b9c60e2ec268234bccb76c22bf5f3c9c5` ALREADY has native MCP CLIENT support — `mcpServers?: Array<string | Record<string, McpServerConfig>>` on `AgentDefinition` (`packages/sdk/src/types/agent.ts:94`) + tool-naming convention `mcp_<server>_<tool>` (`packages/sdk/src/internal/runtime/mcp-tools.ts:23`) + per-project config reader at `.theokit/mcp.json` (`packages/sdk/src/internal/runtime/mcp-tools.ts:38`) + 3 transport types declared (stdio + http + sse via `McpServerConfig` discriminated union, `packages/sdk/src/types/mcp.ts:68`) + OAuth 2.1 PKCE flow (318 LoC at `packages/sdk/src/internal/mcp/oauth.ts`, ADR D41 reference). The SDK also ships its OWN local-memory namespace `Memory.runDreamingSweep` (`packages/sdk/src/memory.ts:41-77`) — but this is COMPLEMENTARY to TheMemory, NOT competing: SDK Memory is a LOCAL ephemeral fact-cache rooted at `.theokit/memory/` with dedup/cluster sweep; TheMemory is the THREE-TIER persistent memory runtime (User/Session/Agent scope, Postgres+pgvector or cloud-managed). The SDK's existing MCP client IS the v0.3 integration surface — no new wiring needed in SDK; v0.3 ships a stdio MCP server, user configures `.theokit/mcp.json`, SDK's `buildToolList` auto-registers `mcp_themory_remember/recall/forget/reflect`. ZERO import of `@usetheo/memory` exists in SDK at this SHA — homonymous packages `@usetheo/memory-supermemory/honcho/mem0` are unrelated third-party adapter wrappers consuming the SDK's `MemoryAdapter` contract (a DIFFERENT integration path that TheMemory does NOT use).**

**Citations valid at SHA `6d9d553b9c60e2ec268234bccb76c22bf5f3c9c5` (per ADR D4 v1.1 SHA stamping):**

| File | LoC | Role |
|---|---|---|
| `../theokit-sdk/packages/sdk/package.json` | (manifest) | SDK barrel + exports (`./tools`, `./errors`, no `./memory` subpath — Memory shipped as named export from main barrel) |
| `../theokit-sdk/packages/sdk/src/types/mcp.ts` | 68 | `McpStdioServerConfig` + `McpHttpServerConfig` (http+sse union) + `McpAuthConfig` + `McpOAuthConfig` |
| `../theokit-sdk/packages/sdk/src/internal/runtime/mcp-tools.ts` | 46 | `buildToolList` + `sanitizeName` + `readProjectMcpConfig` from `.theokit/mcp.json` |
| `../theokit-sdk/packages/sdk/src/internal/mcp/oauth.ts` | 318 | OAuth 2.1 PKCE flow (ADR D41) |
| `../theokit-sdk/packages/sdk/src/types/agent.ts:90-95` | (5) | `AgentDefinition.mcpServers?: Array<string \| Record<string, McpServerConfig>>` |
| `../theokit-sdk/packages/sdk/src/types/agent.ts:362` | (1) | Resume-state `mcpServers?: Record<string, McpServerConfig>` |
| `../theokit-sdk/packages/sdk/src/memory.ts` | 78 | `Memory.runDreamingSweep` — local fact consolidation (NOT a TheMemory consumer) |
| `../theokit-sdk/packages/sdk/src/agent.ts:139-152, 502` | (3 sites) | Wire `mcpServers` through agent lifecycle; strip on resume per ADR |

**MCP types declared in SDK (`types/mcp.ts`):**

```typescript
type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;  // "Local agents only. Cloud rejects this field."
};

type McpHttpServerConfig = {
  type?: "http" | "sse";  // ← SDK still supports SSE (legacy) per Q4+Q5+Q7 deprecation
  url: string;
  headers?: Record<string, string>;
  auth?: McpAuthConfig;  // OAuth 2.1 PKCE bundle
};

type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;
```

**Tool-naming convention enforced by `mcp-tools.ts:22-23`:**
```typescript
for (const name of Object.keys(effective)) {
  tools.push(`mcp_${sanitizeName(name)}_call`);  // sanitize: [^a-zA-Z0-9]+ → _
}
```
Each MCP server contributes ONE `mcp_<name>_call` tool to the agent's tool list — but the actual MCP `tools/list` protocol fans out into the underlying server's tools (a 4-tool MCP server still presents 4 tool calls to the LLM, just routed through the single `mcp_<name>_call` entry-point in the SDK's dispatch layer).

**`.theokit/mcp.json` shape (per `readProjectMcpConfig`):**
```json
{
  "servers": {
    "themory": { "command": "npx", "args": ["@usetheo/memory/agent-tools"] }
  }
}
```

**Integration story for v0.3 (locked):**

1. v0.3 ships a stdio MCP server binary at `npx @usetheo/memory/agent-tools` (subpath export per CLAUDE.md Item 4).
2. User adds `themory` to `.theokit/mcp.json` (or passes inline via `Agent.create({ mcpServers: { themory: {...} } })`).
3. SDK's `buildToolList` registers `mcp_themory_call` in the agent's exposed-tools array.
4. SDK's MCP dispatch (per `agent.ts:502` wire-through) connects to the stdio subprocess on first invocation.
5. Agent loop sees 4 tools (`remember`, `recall`, `forget`, `reflect`) via the MCP protocol's `tools/list` response (Q7 shape).
6. Each `tools/call` flows TheMemory → MCP transport → SDK MCP client → agent loop.
7. **Zero new SDK code required.** TheMemory v0.3 plugs into the existing MCP-client infrastructure.

**Rule 9 verdict per cycle-discover.md v1.1 inquebrável (NEVER skip Rule 9 evaluation when implementing a non-trivial primitive):**

| Candidate integration approach | Verdict | Rationale |
|---|---|---|
| **ADOPT — Use SDK's existing MCP client + ship TheMemory as stdio MCP server** | **CHOSEN** | Existing infrastructure; zero SDK changes; honors CLAUDE.md Item 4 "without inheriting the agent-loop lock-in" (MCP is the loop-agnostic boundary); matches Mem0+Letta+spec patterns from Q5+Q4+Q7 |
| REJECT — Add TheMemory as a `MemoryAdapter` package (à la `@usetheo/memory-supermemory`) | REJECTED | MemoryAdapter is for IN-PROCESS imports (the 3 wrappers ship as `@usetheo/memory-<name>`); TheMemory's runtime (pgvector + LLM extraction pipeline) doesn't fit the IN-PROCESS-import shape; would require bundling Postgres+drizzle deps INTO the SDK consumer's bundle |
| REJECT — Custom HTTP API + SDK HTTP client | REJECTED | Reinvents MCP transport; bypasses the standard agent-tool discovery; violates Inquebrável Rule 9 (Não Reinvente — MCP exists for exactly this) |
| DEFER — Wait for SDK to accept TheMemory as a special-case provider | REJECTED | Would create one-off coupling between two products; MCP-via-stdio is the clean abstraction |

**Cross-validates v0.2 + v0.3 architectural coherence:**
- v0.2 (PR-A shipped) — `@usetheo/memory/theokit` resolves `ctx.session` → scoped `Memory` instance. This is consumed BY HANDLER CODE running INSIDE a TheoKit-framework HTTP app.
- v0.3 (this blueprint) — `@usetheo/memory/agent-tools` exposes the same 4 verbs over MCP. This is consumed BY AGENT LOOPS running an LLM with function-calling.
- Same `Memory` core (per ADR D8 from v0.2 stubs); two different integration surfaces. Clean separation, no duplicate runtime.

**Implication for ADR D-server-side-only (NEW for v0.3):**
- v0.3 is purely an MCP SERVER. v0.3 does NOT ship an MCP CLIENT (SDK already has one). Reject any temptation to build `@usetheo/memory/agent-tools-client` — clients are someone else's concern.

**Implication for ADR D-sdk-transport-compat:**
- SDK supports stdio + http + sse (types/mcp.ts:6, 55-56). v0.3 ships stdio + streamable-HTTP (per Q7 spec). The SDK's `sse` legacy support means v0.3 can SKIP SSE without breaking SDK consumers — they have streamable-HTTP as the modern alternative. Confirmed compatibility.

**Implication for ADR D-installation-shape:**
- SDK reads `.theokit/mcp.json` from cwd (mcp-tools.ts:38). v0.3 documentation MUST include the canonical `mcp.json` entry as the recommended install. Also expose `npx @usetheo/memory/agent-tools --help` for ad-hoc inspection. The bin entry mirrors SDK's own `bin: { theokit-migrate-config, theokit-migrate-memory }` pattern.

**Implication for ADR D-no-memory-adapter:**
- TheMemory will NOT ship a `MemoryAdapter` package competing with `@usetheo/memory-supermemory/honcho/mem0`. Those 3 are SDK-shape (in-process imports); TheMemory is a RUNTIME (managed service). Different layer. Document explicitly to prevent future confusion.

**Honesty note**: this Q8 finding aligns with the user's direct question during this halt-loop ("Nosso sistema ja consegue usar o nosso sistema de memoria? digo o TheoKit-SDK") — answer was "Não — ainda não, mas v0.3 fecha exatamente esse gap." The Q8 evidence above formalizes that answer with file:line citations + Rule 9 ADOPT verdict.

---

## Cross-cutting Comparison

| Dimension | Letta | Mem0 | LangMem | MCP spec | `@usetheo/sdk` |
|---|---|---|---|---|---|
| First-party MCP server | CLIENT only (Q3+Q4) — 4 transports | SERVER YES (Q5) — 574 LoC FastMCP | NO (Q6) — LangChain-native, zero MCP | N/A (spec) | CLIENT only (Q8) — `AgentDefinition.mcpServers` |
| Tool exposure mechanism | External MCP servers via Template-Method client (Q4) | `@mcp.tool` decorator on async functions (Q5) | `StructuredTool.from_function(sync, async)` factory (Q6) | `tools/list` + `tools/call` JSON-RPC (Q7) | `mcp_<server>_call` dispatch + `.theokit/mcp.json` (Q8) |
| Transport(s) supported | stdio + SSE + streamable-HTTP + fastmcp (Q4) | SSE + streamable-HTTP (`stateless=True`) (Q5) | N/A (in-process function call) | stdio + streamable-HTTP (SSE deprecated 2025-03-26+) (Q7) | stdio + http + sse (legacy) (Q8) |
| Schema validation pattern | LIST-time `SchemaHealth` 3-tier enum + `reasons[]` (Q1) | Pydantic via FastMCP decorator (Q5) | `_ToolWithRequired` injects `json_schema_extra=_ensure_required` (Q6) | JSON Schema 2020-12 default; `inputSchema` MUST be valid (Q7) | Delegated to underlying server (Q8) |
| Cross-tool state isolation | `X-Agent-Id` header + try/finally fixture cleanup (Q1+Q4) | `contextvars.ContextVar` from FastAPI path-param (Q5) | `_get_store(initial_store)` with `get_store()` runtime fallback (Q6) | Capability negotiation per session; stateful connections (Q7) | Per-MCP-server subprocess isolation (Q8) |
| Error handling shape | `Tuple[str, bool]` `(content, not isError)` (Q3) | Plain string returns "Error: ..." (Q5) — NON-COMPLIANT with spec | `raise ValueError` Python exception (Q6) | TWO mechanisms: Protocol Error (JSON-RPC `error{}`) + Tool Execution Error (`result.isError=true`) (Q7) | Forwards to underlying server (Q8) |
| Tool count discipline | N (external server defines) | 5 (add/search/list/delete/delete_all) | 2 (manage + search with action enum) | Spec-agnostic (server choice) | N per registered server |

## ADRs

> Decisions emerging from synthesis. Each has Context → Alternatives → Decision → Consequences. Locked at blueprint version 1.0 (2026-05-23).

### D1 — Transport selection: stdio (primary) + streamable-HTTP (secondary); skip SSE; skip fastmcp wrapper

**Context.** MCP spec 2025-11-25 (Q7) and three reference projects all converge on transport choice. SSE is deprecated 4-times-independently: (1) Letta's `test_sse_mcp_server` has `@pytest.mark.skip(reason='deepwiki SSE...deprecated')` (Q1); (2) Letta's fastmcp_client.py docstring "replaces the existing AsyncSSEMCPClient and AsyncStreamableHTTPMCPClient implementations" (Q4); (3) Mem0's mcp_server.py line 500-502 verbatim "Streamable HTTP transport (MCP spec 2025-03-26+) which replaces the deprecated SSE transport" (Q5); (4) MCP spec 2025-11-25 fetched pages (overview + basic + tools) make no mention of SSE (Q7).

**Alternatives:**
- **A**: stdio only — simpler but blocks HTTP/cloud deployment.
- **B**: stdio + SSE + streamable-HTTP + fastmcp (all 4 Letta transports) — broadest compat but ships ~2 MB extra deps for SSE legacy that nobody should use; OAuth-rich fastmcp wrapper is out of v0.3 scope per CLAUDE.md Item 4.
- **C (CHOSEN)**: stdio + streamable-HTTP. Two paths: local CLI via `npx @usetheo/memory/agent-tools` (stdio subprocess from `.theokit/mcp.json`); HTTP deploy via streamable-HTTP (matches TheoCloud v0.5 milestone).

**Consequences.**
- v0.3 imports `@modelcontextprotocol/sdk/server/stdio` + `@modelcontextprotocol/sdk/server/streamableHttp` from the SDK Q2 surveyed.
- No SSE codepath; honest docs section "SSE transport not supported — use streamable-HTTP instead".
- Streamable-HTTP runs in `stateless=true` mode (matches Mem0 line 546 pattern from Q5).
- Adopts Letta's typed error remapping discipline (`streamable_http_client.py:61-81` — Q4) at v0.3's request-handler boundary: 404 → "MCP server not found"; Connection-error → "server not running"; JSON-validation → "not a proper MCP server".
- Sibling `@usetheo/sdk` already supports stdio + http (Q8) — zero compat work.

**Cross-references:** Q1, Q2, Q4, Q5, Q7, Q8.

### D2 — Tool schema: zod-authored + zod-to-json-schema → JSON Schema 2020-12; 4 separate tools (no action collapsing)

**Context.** MCP spec 2025-11-25 mandates `inputSchema` MUST be valid JSON Schema 2020-12 (default dialect) and MUST NOT be null (Q7). `@modelcontextprotocol/sdk` ships `zod` + `zod-to-json-schema` as bundled deps (Q2). v0.1 already depends on `zod ^3.24.0`; v0.3 bumps to `^3.25.0` to satisfy SDK peer-dep (Q2). LangMem ships `_ToolWithRequired` workaround because LangChain's Pydantic schema-emit is unreliable for `required` arrays (Q6); Zod is stricter — no analog needed. CLAUDE.md Item 4 acceptance: "exactly 4 tools with stable names" — locks `remember`, `recall`, `forget`, `reflect` per the API verbs (project-level locked names).

**Alternatives:**
- **A**: Handroll JSON Schema literals — violates Inquebrável Rule 9 (Não Reinvente — zod-to-json-schema exists for exactly this).
- **B**: Single `memory(action='remember'|'recall'|...)` tool with action enum (LangMem's collapsing pattern, Q6) — REJECTED: each action has different argument requirements (recall takes `query`, forget takes `id`, remember takes `content`); schema can't statically encode "id forbidden when action=remember"; defeats CLAUDE.md Item 4's "exactly 4 tools with stable names" acceptance.
- **C (CHOSEN)**: Author 4 zod schemas (one per verb) inline at tool registration; pipe through `zod-to-json-schema`; serve at `tools/list`. Tool names: `remember`, `recall`, `forget`, `reflect` (all spec-compliant per Q7: ≤128 chars, `[A-Za-z0-9_.-]`, unique per server).

**Consequences.**
- Strict input validation at JSON-RPC boundary via zod runtime checks before tool body executes (mirrors LangMem's argument-contract validation, Q6).
- Reject Mem0's tool-name shape with implicit pluralization (`add_memories`, `search_memories`) — v0.3 uses singular verbs aligned with TheMemory's API surface.
- `recall` ships `outputSchema` + `structuredContent` (spec § Output Schema, Q7) — typed array of `{id, text, score, attributedTo?, scope, timestamp}`. `remember/forget/reflect` return single text content block with status.
- Declare server `capabilities.tools.listChanged: false` — v0.3's 4 tools are static; no dynamic registration in scope (Voyager-style skill library lands v0.6 per CLAUDE.md Roadmap Item 8).
- Followup F-zod-schema-fixture-test: write fixture asserting zod-to-json-schema emits `required` array correctly (prove the LangMem workaround is unneeded).

**Cross-references:** Q2, Q6, Q7.

### D3 — Cross-tool scope isolation via Node.js `AsyncLocalStorage`

**Context.** Three reference patterns for scope binding in tool bodies: Letta uses HTTP `X-Agent-Id` header per request (Q1+Q4); Mem0 uses Python `contextvars.ContextVar` set from FastAPI path-params, reset in `finally:` (Q5); LangMem uses `_get_store(initial_store)` with `get_store()` runtime fallback to LangGraph context (Q6). Node.js native analog: `AsyncLocalStorage` from `node:async_hooks` — sets value per async lifecycle, automatic propagation across `await` boundaries, must be reset in `try/finally`. v0.2 already shipped `memoryFromCtx(ctx, memory)` (PR #11) for HTTP-handler scope resolution — needs to be reused.

**Alternatives:**
- **A**: Pass scope explicitly through every tool call signature (e.g., `remember({content, userId})`) — REJECTED: pollutes tool schema exposed to LLM; agent has to know its own userId at every invocation; breaks the v0.2 default-on UX promise.
- **B**: Module-level singleton (mutable global state) — REJECTED: concurrent requests race; spec § stateful connections requires per-session isolation (Q7).
- **C (CHOSEN)**: `AsyncLocalStorage<ScopedContext>` initialized at JSON-RPC request boundary; tool bodies call `memoryFromCtx(asyncLocalStorage.getStore(), injectedMemory ?? defaultMemory())` (the `_get_store` fallback pattern from Q6, adapted). `try/finally` reset is non-negotiable (Mem0 lines 459-462, 554-555 from Q5).

**Consequences.**
- Reuses v0.2's existing `memoryFromCtx` 3-state resolver (PR #11) — no new wiring code; v0.2's stub-injection pattern (PR-B coordination) is honored.
- For stdio transport: scope set once per session at `initialize` handshake (per Q7 capability negotiation). Header analog: stdio MCP servers can read `AGENT_ID` from `env` per StdioServerConfig (Q4 stdio_client.py:22 + Q8 SDK env field).
- For streamable-HTTP transport: scope set per request from HTTP headers (`X-Agent-Id` à la Letta, or `Authorization` bearer parsed for `THEOKIT_API_KEY` per ADR-0009).
- Risk: forgetting to reset = scope leak across requests. Mitigate via integration test (`E2E test: send 2 sequential calls with different scopes, assert ZERO cross-contamination`).

**Cross-references:** Q1, Q4, Q5, Q6, v0.2 PR #11.

### D4 — SDK integration via SDK's existing MCP client (no SDK code changes)

**Context.** `@usetheo/sdk` at SHA `6d9d553b9c60e2ec268234bccb76c22bf5f3c9c5` already ships a fully-functional MCP client: `AgentDefinition.mcpServers?: Array<...>` (Q8 — `../theokit-sdk/packages/sdk/src/types/agent.ts:94`), `buildToolList` generates `mcp_<server>_call` tool names (Q8 — `../theokit-sdk/packages/sdk/src/internal/runtime/mcp-tools.ts:22-23`), reads `.theokit/mcp.json` per-project config (Q8 — `mcp-tools.ts:38`), supports stdio + http + sse (Q8 — `types/mcp.ts:6, 55-56`), and includes OAuth 2.1 PKCE flow (Q8 — `internal/mcp/oauth.ts`, 318 LoC). Three sibling `@usetheo/memory-{supermemory,honcho,mem0}` packages exist but consume the SDK's `MemoryAdapter` contract — a DIFFERENT integration path that TheMemory does NOT use.

**Alternatives:**
- **A**: Add TheMemory as a `MemoryAdapter` package (à la `@usetheo/memory-supermemory`) — REJECTED: MemoryAdapter is for in-process imports; TheMemory's pgvector + LLM extraction runtime doesn't fit; would bundle Postgres+drizzle INTO consumer's bundle. Wrong layer.
- **B**: Custom HTTP API + custom SDK HTTP client — REJECTED: reinvents MCP transport; bypasses standard agent-tool discovery; violates Inquebrável Rule 9.
- **C**: Wait for SDK to special-case TheMemory — REJECTED: would create one-off cross-product coupling; MCP-via-stdio is the clean abstraction.
- **D (CHOSEN)**: Ship v0.3 as stdio MCP server. User configures `.theokit/mcp.json` with `{"servers": {"themory": {"command": "npx", "args": ["@usetheo/memory/agent-tools"]}}}`. SDK auto-discovers via `buildToolList` → registers `mcp_themory_call` in tool list → connects on first invocation → agent loop sees 4 verbs via MCP `tools/list`. **Zero SDK code changes required.**

**Consequences.**
- v0.3 is SERVER-side only. Do NOT ship an `@usetheo/memory/agent-tools-client` — SDK already has one.
- Documentation MUST include the canonical `.theokit/mcp.json` snippet as the recommended install (mirrors Q8's `readProjectMcpConfig` shape).
- v0.3 bin entry: `npx @usetheo/memory/agent-tools` (mirrors SDK's own `bin: { theokit-migrate-config, theokit-migrate-memory }` pattern from Q8 package.json).
- SDK's `Memory.runDreamingSweep` is unrelated and complementary (local fact cache for SDK agents vs TheMemory's three-tier persistent runtime). Document explicitly to prevent future confusion: "TheMemory is NOT a competitor to SDK's `Memory` namespace — different layer".
- Cross-validates user's interactive question during this halt-loop ("Nosso sistema já consegue usar o nosso sistema de memória?") — answer remains "Não — v0.3 fecha esse gap exatamente por este caminho".

**Cross-references:** Q8, v0.2 PR #11, CLAUDE.md Roadmap Item 4.

### D5 — Test pyramid: 3-tier (pure unit + unit-with-mocks + E2E stdio subprocess)

**Context.** Letta's 3-layer MCP test pyramid (Q1) is the industry exemplar: `test_schema_validator.py` (pure unit, 307 LoC — runs in ms), `test_mcp_schema_validation.py` (unit-with-mocks, 819 LoC — schema-health enrichment at LIST time), `test_mcp.py` (E2E, 396 LoC — server-in-thread + spawned MCP via fresh venv + agent tool roundtrip). MCP spec gives the wire shapes for free (Q7): `initialize`, `tools/list`, `tools/call`. CLAUDE.md `.claude/rules/testing.md` § Pyramid mandates determinism + AAA/Given-When-Then + 100% coverage on critical paths.

**Alternatives:**
- **A**: Skip E2E (only unit) — REJECTED: violates `.claude/rules/testing.md` pyramid; subprocess/transport bugs go undetected; spec compliance unprovable.
- **B**: E2E with real Letta-style agent loop — REJECTED: out of v0.3 scope (CLAUDE.md Item 4 "without inheriting the agent-loop lock-in"). v0.3's E2E mocks the agent.
- **C (CHOSEN)**: Mirror Letta's 3-tier with v0.3 adaptations:
  - **Pure unit** (~5-8 tests): zod schema validators tested with synthetic inputs; tool-name-sanitization edge cases; capability-declaration shape.
  - **Unit-with-mocks** (~10-15 tests): mock JSON-RPC transport via `vitest`'s `mockReader/mockWriter`; assert `tools/list` returns exactly 4 tools with stable names + correct `inputSchema`; assert `tools/call` for each verb produces correct content blocks + correct `isError` flag on validation failure; assert `AsyncLocalStorage` scope binding works (D3) — set scope, call tool, assert scope visible in tool body.
  - **E2E** (~3-5 tests): spawn `npx @usetheo/memory/agent-tools` via `node:child_process` (stdio subprocess); send `initialize` handshake; send `tools/list`; send `tools/call remember` then `tools/call recall`; assert round-trip works; assert THE GOAL test from v0.2 (zero cross-userId overlap) works through MCP boundary; assert subprocess cleanup via try/finally.

**Consequences.**
- E2E budget: 30s timeout matches v0.2 integration tests (`vitest.config.ts`).
- Critical paths needing 100% coverage (per `.claude/rules/testing.md`): JSON-RPC handler dispatch, scope-binding `AsyncLocalStorage` setter/reader, zod validation at boundary, error-mechanism dispatch (Protocol vs Tool Execution).
- Adopt Letta's try/finally cleanup discipline (Q1 `test_mcp.py:266-270` pattern) for any registration/subprocess state.
- Adopt Letta's `EXPECTED_MCP_TOOL_ERRORS` discipline (Q3 `base_client.py:26-50`): catalog `MissingScopeError`, `MemoryStoreError`, `EmbedderError` as expected error classes; log at `info`-level vs `warning`-level by classification.
- Reject Letta's fresh-venv-per-test pattern (Q1) — Node.js E2E uses cached `node_modules`; no per-test reinstall.
- Followup F-mcp-e2e-fixture: build a tiny mock-MCP-client helper for E2E to spawn + send + parse JSON-RPC over stdio.

**Cross-references:** Q1, Q7, `.claude/rules/testing.md`.

### D6 — Error shape: TWO mechanisms per MCP spec (Protocol Error + Tool Execution Error)

**Context.** MCP spec 2025-11-25 § Error Handling (Q7) defines TWO distinct error mechanisms with different LLM-self-correction implications: **Protocol Errors** (JSON-RPC top-level `error{code, message, data?}` for unknown tools / malformed requests / server errors — models cannot self-correct because the request itself is structurally broken); **Tool Execution Errors** (`result.isError: true` + content blocks for business-logic / validation failures — clients SHOULD forward to LLM with actionable text for self-correction). Mem0 (Q5) and LangMem (Q6) violate this: Mem0 returns plain strings without `isError: true` (clients cannot distinguish error from success); LangMem raises Python exceptions (translated by FastMCP but loses structured taxonomy). Letta consumes the contract correctly via `(content, not result.isError)` tuple (Q3 base_client.py).

**Alternatives:**
- **A**: Single mechanism — string returns à la Mem0 — REJECTED: non-compliant with spec § Error Handling.
- **B**: Single mechanism — always raise + let SDK translate — REJECTED: loses Protocol-vs-Execution distinction the spec carved out for LLM self-correction.
- **C (CHOSEN)**: Implement BOTH:
  - **Protocol Errors** for: tool name not in {remember, recall, forget, reflect} (JSON-RPC `-32601 Method not found`); malformed args failing zod parse at boundary (`-32602 Invalid params`); transport-level failures (subprocess crashed; `-32603 Internal error`). Standard JSON-RPC 2.0 error codes (Q7 base spec).
  - **Tool Execution Errors** (`result.isError: true`) for: `MissingScopeError` (from D3 + v0.2 `memoryFromCtx`); `MemoryStoreError` (pgvector connection lost); `EmbedderError` (provider down); `ContentTooLargeError` (input exceeds embedding-dim cap from v0.1). Each carries human-readable text designed for LLM self-correction (e.g., "Embedder unavailable; the user can retry in a moment").

**Consequences.**
- v0.3 ships a typed error-translation layer at the JSON-RPC handler boundary. Reuses v0.2's `MissingScopeError` (`src/core/errors.ts` per v0.2 PR-A).
- Adopt Mem0's graceful-degradation pattern (Q5 lines 46-77): when `MemoryStore` is unreachable, return Tool Execution Error with actionable message ("Memory system is currently unavailable. Please try again later.") rather than crashing the JSON-RPC connection.
- Catalog of expected error classes per ADR D5 / Letta `EXPECTED_MCP_TOOL_ERRORS` pattern (Q3 base_client.py:26-50).
- Test discipline: unit tests assert BOTH error paths produce the correct wire shape (mock JSON-RPC reader, capture response, assert `error` vs `result.isError`).
- Reject Mem0's pattern publicly in docs: "v0.3 returns spec-compliant JSON-RPC errors; if you've migrated from Mem0's MCP server expecting plain strings, update your error parsing".

**Cross-references:** Q1, Q3, Q5, Q7, v0.2 PR #11.

## Recommendations for TheMemory

> Concrete v0.3 plan inputs. Each links to research question + ADR + project rule. Distilled to actionable bullets for `/to-plan v0-3-agent-tools-mcp`.

1. **Adopt `@modelcontextprotocol/sdk` + `zod-to-json-schema` directly (Q2 + D2).** Bump `zod` from `^3.24.0` (v0.1) to `^3.25.0` (SDK peer-dep). Document the +~1.5-2 MB transitive-dep cost as the price of Inquebrável Rule 9 compliance.

2. **Ship as stdio MCP server first; streamable-HTTP for v0.5 cloud (D1).** Skip SSE entirely; skip fastmcp-style OAuth wrapper. `npx @usetheo/memory/agent-tools` bin entry; default scope-bind via env var `AGENT_ID` (stdio) or header `X-Agent-Id` (streamable-HTTP).

3. **Reuse v0.2's `memoryFromCtx(ctx, memory)` resolver (D3 + v0.2 PR #11).** Wrap in `AsyncLocalStorage<ScopedContext>` set at JSON-RPC boundary, reset in try/finally. Reject scope-as-tool-argument anti-pattern.

4. **Author 4 zod schemas inline; do NOT use single-tool-with-action-enum (D2).** Tool names `remember`, `recall`, `forget`, `reflect`. `recall` ships `outputSchema` + `structuredContent`. Server declares `capabilities.tools.listChanged: false`.

5. **3-tier test pyramid mirroring Letta (D5 + Q1).** Pure unit (zod validators) + unit-with-mocks (mock JSON-RPC transport) + E2E (stdio subprocess + tools/list + tools/call roundtrip + scope-isolation assertion — extend v0.2's THE GOAL test through MCP boundary).

6. **TWO error mechanisms per spec (D6 + Q7).** Protocol errors for routing/validation failures; Tool Execution errors (`isError: true`) for domain failures forwarded to LLM for self-correction. Reject Mem0's plain-string return shape.

7. **Zero SDK code changes (D4 + Q8).** v0.3 plugs into SDK's existing MCP client via `.theokit/mcp.json`. Documentation MUST include canonical install snippet. Do NOT ship a `MemoryAdapter` package competing with `@usetheo/memory-{supermemory,honcho,mem0}` — those are SDK-shape; TheMemory is RUNTIME-shape (different layer).

8. **Honest scope (CLAUDE.md Item 4).** v0.3 does NOT include reflect's async scheduler (v0.4a), Voyager-style skill library (v0.6), or bi-temporal `asOf` (v0.5). `reflect()` tool calls the existing v0.0 `ManualReflectionPolicy` synchronously — manual trigger from agent loop is the intended UX.

## Followups (logged for downstream cycles)

| ID | Description | Owner |
|---|---|---|
| F-allowlist-registry-npmjs | Add `registry.npmjs.org` to `.claude/rules/discover-web-allowlist.txt` (it's the actual API consumed by `npm view` when npmjs.com WebFetch is blocked, per Q2 honest deviation) | cycle-discover infra |
| F-eccheck-find-pattern | Add `find -path '*mcp*' -type f` to the paired-pass discipline for ADR D5 v1.1 EC-5 (current grep-only check missed Mem0's `openmemory/api/app/mcp_server.py` because it uses higher-level FastMCP wrapper instead of low-level JSON-RPC method names — per Q5 correction) | cycle-discover infra |
| F-mcp-spec-transport-page | Fetch `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports` and write a snapshot for transport-stability-tier completeness (Q4+Q5+Q7-spec-silence was sufficient evidence but explicit page would close the audit loop) | next /discover-execute iteration OR /to-plan v0-3 |
| F-zod-schema-fixture-test | Write fixture asserting `zod-to-json-schema` emits `required` array correctly (proves LangMem's `_ToolWithRequired` workaround is unneeded for v0.3 — D2 assumption) | /implement v0-3 |
| F-mcp-e2e-fixture | Build a tiny mock-MCP-client helper for v0.3 E2E tests (spawn + send + parse JSON-RPC over stdio — pattern mirrors Letta `test_mcp.py:213-270` but compressed) | /to-plan v0-3 task |
| F-error-translation-layer | Implement typed error-translation layer mapping `MissingScopeError`/`MemoryStoreError`/`EmbedderError`/`ContentTooLargeError` to Tool Execution Errors with LLM-actionable text (D6) | /implement v0-3 |
| F-cycle-discover-skill-md-catchup | `.claude/skills/discover-{plan,execute,confidence,improve}/SKILL.md` need to catch up to cycle-discover.md v1.1 5-corner contract + WebSearch/WebFetch wiring + snapshot-before-cite discipline (this halt-loop exercised v1.1 ahead of SKILL.md updates; honest deviation logged for transparency) | cycle-discover skill maintainers |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| <!-- updated by halt-loop --> | | |

## Halt-loop progress (audit trail)

- Iterations used: 9 / 30
- Questions answered: 8 / 8
- Questions blocked: 0
- Citations verified: 100% (zero fabricated paths per `/bin/grep` audit at iteration 9 — see `.progress-v0-3-agent-tools-mcp.json`)
- URL snapshots persisted: 4 (1 npm-view fallback + 3 MCP-spec pages, all under `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/`)
- Coverage Corners populated: 5 / 5 (Integration Tests, Dependencies, Tools, Techniques, Prior Art — cycle-discover.md v1.1 5-corner)
- ADRs synthesized: 6 (D1 transport, D2 schema, D3 isolation, D4 sdk-integration, D5 test-pyramid, D6 error-shape)
- Followups logged: 7
- Promise emitted at iteration: 9 (`<promise>BLUEPRINT_COMPLETE</promise>`)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-3-agent-tools-mcp-plan.md` (v1.1)
- Confidence report: `.claude/knowledge-base/reviews/v0-3-agent-tools-mcp-confidence-{YYYY-MM-DD}.json` (will be generated by `/discover-confidence`)
- Linked TheMemory rules: `.claude/rules/architecture.md` § 3 (DIP — `src/agent-tools/` SHALL import from `src/core/` ONLY); `.claude/rules/testing.md` § Pyramid; `.claude/rules/cycle-discover.md` v1.1 (5-corner contract)
- Sibling completed blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-2-theokit-binding-blueprint.md` (v0.2 binding — quality bar v0-3 should match)
- Pre-flight infra (ADR D6 prereqs):
  - `.claude/rules/discover-web-allowlist.txt` (18 domains)
  - `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/` (empty dir, ready for Q2 + Q7 snapshots)
