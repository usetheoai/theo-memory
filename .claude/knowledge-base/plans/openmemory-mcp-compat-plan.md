---
slug: openmemory-mcp-compat
created_at: 2026-06-18
goal: Expose the OpenMemory MCP tool surface + SSE transport as a drop-in over TheMemory's verbs, proven by an integration test driving a real MCP client through the SSE endpoint against real pgvector.
---

# Plan: OpenMemory MCP-shape compatibility

> Implements the blueprint `.claude/knowledge-base/discoveries/blueprints/openmemory-mcp-compat-blueprint.md` (SHIPPABLE_WITH_CAVEATS 99.7). Classified IN-SCOPE under P0 sub-goal 3 (MCP) per CLAUDE.md Amendment 2026-06-18, Roadmap Item 26 — MCP protocol/tool-shape interop, NOT the cut Mem0 data-adapter (no `mem0ai` dep).

## Goal

> "Register the 4 OpenMemory tools (`add_memories`/`search_memory`/`list_memories`/`delete_memories`) + an SSE transport at `/{client}/sse/{user}` as an opt-in compat mode in `packages/mcp`, measured by `tests/integration/openmemory/mcp-compat.test.ts` — an MCP client over the real SSE endpoint gets `tools/list` = exactly the 4 names, round-trips add→search→delete, and per-user isolation holds — 0 failed against real `ankane/pgvector:v0.5.1`."

## Context

Owner directive (2026-06-18, "URGENTE P0"): TheMemory's MCP server must be a drop-in for the OpenMemory MCP Server so OpenMemory-wired clients (Cursor/Claude/Windsurf/Cline) work unchanged. The discover cycle produced the blueprint (verified against the `openmemory/` clone) with the tool→verb mapping, transport routes, and ADRs D1-D5. Two source-confirmed facts drive this plan: the delete tool is `delete_memories(memory_ids)` (NOT `delete_all_memories` — announcement is wrong, `mcp_server.py:296`), and OpenMemory serves SSE + Streamable HTTP (our SDK `@modelcontextprotocol/sdk@^1.29.0` already ships `SSEServerTransport` — no new dep).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists | Invariant to preserve |
|---|---|---|---|
| `packages/mcp/src/server.ts` | 123 | `McpServer` wraps SDK `Server`; registers `ListTools`+`CallTool` handlers; scope via `_meta`/env | accept an opt-in alias tool set without breaking native verbs |
| `packages/mcp/src/tools/dispatch.ts` | 58 | routes a tool name → handler | reuse for the alias names (map to same handlers) |
| `packages/mcp/src/tools/list-handler.ts` | 75 | builds `tools/list` response | compat mode lists the 4 OpenMemory tools |
| `packages/mcp/src/tools/{remember,recall,forget,list}-handler.ts` | 60-78 ea | the native verb handlers | reused verbatim by the alias mapping |
| `packages/mcp/src/transports/streamable-http.ts` | 189 | `StreamableHTTPServerTransport` + node:http | the `/{client}/http/{user}` route reuses this |
| `packages/mcp/src/transports/stdio.ts` | 22 | stdio transport | unchanged |
| `packages/mcp/src/run-mcp-server.ts` | 322 | transport/auth resolution + boot | add `compat=openmemory` resolution + SSE branch |
| `packages/mcp/src/index.ts` | 11 | package barrel | export `connectSse` + compat tool builder |
| `packages/agent-core/src/scope.ts` | 53 | `withScope`/`getScope` (AsyncLocalStorage) | SSE per-connection scope binding reuses this |
| `packages/mcp/src/openmemory/tools.ts` (NEW) | 0 | 4 OpenMemory tool specs → native handler mapping | DIP: adapter only |
| `packages/mcp/src/openmemory/index.ts` (NEW) | 0 | compat registration helper | — |
| `packages/mcp/src/transports/sse.ts` (NEW) | 0 | SSE transport + path-param scoping | uses SDK `SSEServerTransport`; no new dep |
| `packages/mcp/src/openmemory/tools.test.ts` (NEW) | 0 | contract: tools/list set + schemas + mapping | — |
| `tests/integration/openmemory/mcp-compat.test.ts` (NEW) | 0 | real MCP client over SSE vs pgvector | THE GOAL TEST |

### Current callers / dependents
- `McpServer` (`server.ts`): consumed by `run-mcp-server.ts` (`runMcpServer`). The alias tool set is an additive option; native-verb consumers (existing `themory mcp`) unaffected.
- Transports: `connectStdio` + `connectStreamableHttp` exported from `index.ts:9-10`; `connectSse` is additive.
- `withScope`/`getScope` (`agent-core/scope.ts`): used by every tool handler via `getScope()`; the SSE transport sets the scope per connection from the path `user_id`.

### Domain glossary
- **OpenMemory tool** — one of `add_memories` / `search_memory` / `list_memories` / `delete_memories` (the wire names a client sends).
- **Compat mode** — opt-in server mode where `tools/list` returns the OpenMemory names instead of the native `remember`/`recall`/etc.
- **Path scoping** — `user_id` + `client_name` parsed from the SSE URL path → bound to the request scope (no bearer; local-first).

### Architecture boundaries affected
- `architecture.md § 3` (DIP): the compat layer lives entirely in `packages/mcp` (adapter); `src/core` is untouched. Tool aliases map to existing handlers — no new domain logic.
- `no-paper-names-in-code.md`: module dir `openmemory/` + tool wire-names are the vendor interop contract (allowed as string literals in the adapter); internal identifiers stay neutral (`compatTools`, not `mem0Tools`).

## Prior Art & Related Work
- Blueprint `openmemory-mcp-compat-blueprint.md` (the source — tool surface, transport routes, mapping table, ADRs D1-D5).
- Reference clone `.claude/knowledge-base/references/mem0/openmemory/api/app/mcp_server.py` + `api/tests/test_mcp_server.py` (the surface to mirror).
- Existing v0.3 MCP server (`packages/mcp`) — the native 4-verb tools + stdio/streamable-http transports this extends.

## Objective
- [ ] The 4 OpenMemory tools registered as an opt-in compat tool set mapping to native handlers (Phase 0).
- [ ] SSE transport at `GET /{client}/sse/{user}` + POST message routes, per-connection path scoping; `/{client}/http/{user}` reuses streamable-http (Phase 1).
- [ ] `run-mcp-server` resolves `compat=openmemory` (flag/env) and boots the compat tool set + SSE (Phase 2).
- [ ] THE GOAL TEST: a real MCP client over SSE → tools/list = the 4 names, add→search→delete round-trip, per-user isolation, against real pgvector (Final).

## ADRs

### D1 — Compat tools are an opt-in ALIAS set in `packages/mcp`, not new core code
- **Decision:** A `buildOpenMemoryTools()` returns 4 tool specs whose handlers delegate to the existing `remember`/`recall`/`list`/`forget` dispatch. Selected via a `compat: 'openmemory'` server option; default mode is unchanged (native verbs).
- **Rationale:** `architecture.md § 3` DIP — adapter-only; reuse the proven handlers (DRY). Blueprint D1.
- **Alternatives considered:** *Replace native verbs globally* — rejected: breaks existing `themory mcp` consumers. *New package* — rejected: YAGNI; it's a thin alias in the existing MCP package.
- **Consequences:** the server can expose native OR OpenMemory tool names; both dispatch to the same handlers.

### D2 — SSE transport via the SDK's `SSEServerTransport`; `/http/` reuses streamable-http
- **Decision:** Add `connectSse()` in `transports/sse.ts` using `@modelcontextprotocol/sdk/server/sse.js#SSEServerTransport`, mounting `GET /{client}/sse/{user}` (stream) + `POST /{client}/sse/{user}/messages/` + base `POST /messages/`; the `/{client}/http/{user}` route delegates to the existing `connectStreamableHttp`.
- **Rationale:** Blueprint D2 + Corner 3; NO new dependency (the SDK already ships SSE — Corner 2). Matches OpenMemory's route shape (`mcp_server.py:435-496`).
- **Alternatives considered:** *Only streamable-http* — rejected: announcement clients connect via `/sse/`; not a drop-in. *Hand-roll SSE* — rejected: Rule 9, the SDK ships it.
- **Consequences:** a third transport in `packages/mcp`; node:http server routes by path regex.

### D3 — Path `user_id` → user tier within the credential's workspace; `client_name` → metadata
- **Decision:** The SSE handler parses `user_id` + `client_name` from the path and binds `withScope({ kind: 'user', userId }, ...)` for the connection; the workspace comes from the connection credential, or the `default` workspace when unauthenticated (local-first parity). `client_name` is attached as memory metadata.
- **Rationale:** Blueprint D3 + ADR-C; preserves v0.4.0 workspace isolation while honoring OpenMemory's path scoping.
- **Alternatives considered:** *Map user_id → workspace* — rejected: conflates tenant (security) with the within-workspace user tier; our workspace is credential-derived.
- **Consequences:** per-user isolation holds; multi-tenant isolation intact.

### D4 — `delete_memories(memory_ids)` → `forget(id)` per id; JSON-string returns
- **Decision:** Implement `delete_memories(memory_ids: string[])` mapping to `forget` per id (best-effort, accessible-only). Tools return JSON **strings** on success and `"Error: …"` strings on failure (result strings, not protocol errors) — OpenMemory parity. `delete_all_memories` is NOT implemented (announcement-only; the clone has no such tool).
- **Rationale:** Blueprint D4 + D5; match the code, not the marketing.
- **Alternatives considered:** *Implement `delete_all_memories`* — rejected: not in the reference; would be inventing a contract. Optional alias deferred.
- **Consequences:** one source-faithful delete tool; return shape matches OpenMemory clients' expectations.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| SSE transport is legacy (MCP deprecating SSE in favor of streamable-http) | Medium | We ship both; SSE only for OpenMemory-wired clients. Documented as compat-only. | Implementer |
| Path-scoping has no auth (local-first) — exposing it on a non-localhost bind is unsafe | High | Default-bind localhost; reuse the ADR-0015 non-localhost-without-TLS guard from the streamable-http path; document loud. | Implementer + `/review` |
| Return-shape mismatch (structured vs JSON-string) silently breaks clients | Medium | Goal test asserts JSON-string parity against an SDK MCP client. | Implementer |
| Scope creep into the OpenMemory dashboard / Docker stack | Low | Out-of-scope locked by blueprint; plan touches only tool aliases + SSE. | Implementer |

## Unresolved Questions
- Q1 — Should compat mode ALSO keep the native verbs visible, or replace them? **Default:** replace in compat mode (a drop-in must present exactly the 4 OpenMemory names per `tools/list` test); native mode stays the default. Resolved at plan time.
- Q2 — `client_name` as metadata key name? **Default:** `mcp_client` (mirrors OpenMemory's `mcp_client` metadata, `mcp_server.py:93`). Resolved.

## Dependencies

No new runtime dependencies. Uses `@modelcontextprotocol/sdk@^1.29.0` (already declared — ships `SSEServerTransport`), `hono`/`node:http` (already present), `zod` (schemas). `/deps-audit` is a no-op (zero new declared deps).

## Dependency Graph

```
Phase 0 (OpenMemory tool alias set + contract tests)
   │
   ▼
Phase 1 (SSE transport + path scoping; /http/ reuse)
   │
   ▼
Phase 2 (run-mcp-server compat resolution + wiring + exports)
   │
   ▼
Final Phase: Integration Validation (real MCP client over SSE vs pgvector; full suite + typecheck + lint)
```

## Phase 0: OpenMemory tool alias set

### T0.1 — `buildOpenMemoryTools()` mapping the 4 names to native handlers

#### Why this step
1. **What** — define the 4 OpenMemory tool specs (name + description + zod inputSchema) whose handlers delegate to the existing remember/recall/list/forget dispatch.
2. **Why now** — the tool set is the contract the transport serves; everything downstream needs it. Reuses proven handlers (D1, DRY).

#### Files to edit
```
packages/mcp/src/openmemory/tools.ts (NEW) — 4 tool specs + handler mapping
packages/mcp/src/openmemory/index.ts (NEW) — registration helper consumed by server.ts
packages/mcp/src/server.ts — accept opt-in compat tool set in McpServer
packages/mcp/src/openmemory/tools.test.ts (NEW) — contract test
```

#### TDD
```
RED:  tools.test.ts asserts buildOpenMemoryTools() yields exactly {add_memories, search_memory, list_memories, delete_memories}; each has a non-empty description + an inputSchema (add_memories: {text, infer?}; search_memory: {query}; list_memories: {}; delete_memories: {memory_ids: string[]}); add_memories maps to the remember handler, etc.
GREEN: implement tools.ts + register in server.ts behind the compat option.
VERIFY: pnpm --filter @usetheo/memory-mcp vitest run src/openmemory/tools.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `buildOpenMemoryTools()` returns an array of length 4 whose `.name` set equals `{add_memories, search_memory, list_memories, delete_memories}` (asserted in `tools.test.ts`).
- [ ] Each tool spec has a non-empty `description` string and an `inputSchema` object (asserted: `expect(t.description.length).toBeGreaterThan(0)` + `expect(t.inputSchema).toBeDefined()`).
- [ ] Invoking the `add_memories` handler calls the remember handler exactly once (vi.spy call-count === 1) and returns a value of type `string` parseable by `JSON.parse`; a thrown error returns a string matching `/^Error: /`.
- [ ] `delete_memories(['a','b'])` invokes the forget handler exactly twice with `'a'` then `'b'` (spy args asserted).
- [ ] `pnpm run typecheck` exits 0; `pnpm run lint` exits 0; `wc -l` of each new file ≤ 500; grep of banned paper-name tokens in the new files returns 0 hits.

#### DoD
- [ ] `pnpm --filter @usetheo/memory-mcp vitest run src/openmemory/tools.test.ts` exits 0; `pnpm run typecheck` + `pnpm run lint` exit 0; `CHANGELOG.md [Unreleased]` gains the entry.

## Phase 1: SSE transport + path scoping

### T1.1 — `connectSse()` with `/{client}/sse/{user}` routing + per-connection scope

#### Why this step
1. **What** — add an SSE transport that mounts the OpenMemory route shape, parses `user_id`+`client_name` from the path, binds `withScope` per connection, and maps `/{client}/http/{user}` to the existing streamable-http.
2. **Why now** — without the SSE endpoint at the OpenMemory path, existing OpenMemory clients can't connect (the drop-in crux, EC-1).

#### Files to edit
```
packages/mcp/src/transports/sse.ts (NEW) — SSEServerTransport + node:http path routing + scope binding
packages/mcp/src/transports/sse.test.ts (NEW) — route parsing + scope binding unit test
packages/mcp/src/index.ts — export connectSse
```

#### TDD
```
RED:  sse.test.ts asserts: GET /{client}/sse/{user} opens a stream + binds scope user=<user>, client=<client>; POST /{client}/sse/{user}/messages/ routes to the transport; a non-localhost bind without TLS is rejected (ADR-0015 guard); an unparseable path → 404.
GREEN: implement sse.ts using SDK SSEServerTransport.
VERIFY: pnpm --filter @usetheo/memory-mcp vitest run src/transports/sse.test.ts
```

#### Concurrency tests
- Race-aware: a parallel test opens N SSE connections with different `user_id`; each asserts `getScope().userId` equals its own (no cross-bind — AsyncLocalStorage per-connection invariant), and cancellation propagation resets the scope on disconnect.

#### Acceptance Criteria
- [ ] A `GET /<c>/sse/<u>` request returns HTTP 200 with `content-type: text/event-stream` and, during the handler, `getScope()` returns `{ kind: 'user', userId: '<u>' }` (asserted).
- [ ] A `POST /<c>/sse/<u>/messages/` request reaches the SSE transport's message handler (spy asserted call-count === 1).
- [ ] Constructing `connectSse({ host: '0.0.0.0' })` without TLS throws (asserted `expect(() => connectSse(...)).toThrow`); a `GET /nope` returns HTTP 404.
- [ ] `/<c>/http/<u>` delegates to `connectStreamableHttp` (spy asserted).

#### DoD
- [ ] `pnpm --filter @usetheo/memory-mcp vitest run src/transports/sse.test.ts` exits 0; `pnpm run typecheck` + `pnpm run lint` exit 0.

## Failure scenarios (external I/O — node:http + pgvector)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| node:http (SSE) | client disconnects mid-stream | abort the SSE request | scope reset; no leak; server stays up |
| node:http (SSE) | unparseable path (`/x`) | GET a bad path | 404, no scope bound |
| node:http (bind) | non-localhost host without TLS | construct connectSse with host 0.0.0.0, no TLS | rejected at construction (ADR-0015 guard) |
| pgvector | add then search round-trip | goal test against real pgvector | stored memory is recalled |

## Phase 2: run-mcp-server compat resolution + wiring

### T2.1 — Resolve `compat=openmemory` (flag/env) and boot the compat tool set + SSE

#### Why this step
1. **What** — extend `run-mcp-server.ts` resolution so `--compat openmemory` / `THEOMEM_MCP_COMPAT=openmemory` boots the compat tool set + SSE transport (default port 8765 to match OpenMemory).
2. **Why now** — wires the pieces into the runnable `themory mcp` entrypoint (the caller).

#### Files to edit
```
packages/mcp/src/run-mcp-server.ts — compat resolution + SSE branch + 8765 default
packages/mcp/src/run-mcp-server.test.ts — resolution matrix (compat flag/env precedence)
packages/cli/src/run-mcp.ts (if present) — pass through --compat
CHANGELOG.md — [Unreleased] Added
```

#### TDD
```
RED:  run-mcp-server.test.ts: --compat openmemory → transport=sse, toolset=openmemory, port 8765 default; env THEOMEM_MCP_COMPAT=openmemory same; absent → native (unchanged).
GREEN: implement resolution + branch.
VERIFY: pnpm --filter @usetheo/memory-mcp vitest run src/run-mcp-server.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `resolveRunOptions({ compat: 'openmemory' })` returns `{ transport: 'sse', toolset: 'openmemory', port: 8765 }` (asserted); with no compat flag/env it returns the native default (`toolset` !== 'openmemory') — asserted unchanged.
- [ ] `THEOMEM_MCP_COMPAT=openmemory` yields the same resolution as the flag (env-precedence case asserted in the resolution matrix).
- [ ] On boot in compat mode, the startup stderr string matches `/compat=openmemory/` and contains the substring `/sse/` (asserted via captured stderr).

#### DoD
- [ ] `pnpm --filter @usetheo/memory-mcp vitest run src/run-mcp-server.test.ts` exits 0; `pnpm run typecheck` + `pnpm run lint` exit 0; `CHANGELOG.md [Unreleased]` updated.

## Coverage Matrix

| # | Requirement (blueprint) | Task | Resolution |
|---|---|---|---|
| 1 | 4 OpenMemory tools registered | T0.1 | alias set |
| 2 | tools/list exact set + descriptions + inputSchema | T0.1 + Final | contract + goal test |
| 3 | JSON-string + "Error:" return parity (D5) | T0.1 | handler wrappers |
| 4 | delete_memories(memory_ids) → forget per id (D4) | T0.1 | mapping |
| 5 | SSE transport at /{client}/sse/{user} (D2, EC-1) | T1.1 | connectSse |
| 6 | /{client}/http/{user} → streamable-http | T1.1 | delegation |
| 7 | path user_id → user scope; client_name → metadata (D3) | T1.1 | per-connection withScope |
| 8 | non-localhost-without-TLS guard | T1.1 | ADR-0015 reuse |
| 9 | compat opt-in via flag/env; native default | T2.1 | resolution |
| 10 | per-user isolation | T1.1 + T3.1 | per-connection scope + goal test |
| 11 | no new dependency (Corner 2) | T1.1 | SDK SSEServerTransport |
| 12 | real-MCP-client round-trip vs pgvector | T3.1 | goal test |

## Global Definition of Done
- [ ] All phases complete; THE GOAL TEST `tests/integration/openmemory/mcp-compat.test.ts` → 0 failed vs real pgvector.
- [ ] Full contract + integration suites stay green; `pnpm run typecheck` 0 errors; `pnpm run lint` 0 warnings.
- [ ] File-size budget respected (≤ 500 LoC).
- [ ] CHANGELOG `[Unreleased]` updated (Added: OpenMemory MCP compat).
- [ ] README MCP section documents the compat mode + connect URL.
- [ ] No paper names in code identifiers (`no-paper-names-in-code.md`); vendor wire-names allowed as literals in the adapter.
- [ ] `src/core` untouched (DIP); compat lives in `packages/mcp`.

## Final Phase: Integration Validation (MANDATORY)

### T3.1 — Integration validation (THE GOAL TEST)

#### Why this step
1. **What** — drive a real MCP client over the SSE endpoint against real pgvector, proving the drop-in works end-to-end.
2. **Why now** — Phases 0-2 are inert until proven functional; this is the "100% functional" gate.

#### Files to edit
```
tests/integration/openmemory/mcp-compat.test.ts (NEW) — real-client goal test
```

#### TDD
```
RED:  mcp-compat.test.ts connects an SDK MCP client over SSE; asserts tools/list == 4 names; add→search round-trip; delete; per-user isolation. Fails until Phases 0-2 land.
GREEN: (Phases 0-2 implementation).
VERIFY: THEOMEM_PG_URI=... pnpm vitest run tests/integration/openmemory/mcp-compat.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests
- Race-aware: a parallel test runs two clients with distinct `user_id` that each recall only their own memory (per-user isolation; cancellation propagation on client disconnect).

#### Acceptance Criteria
- [ ] `pnpm vitest run tests/integration/openmemory/mcp-compat.test.ts --config vitest.integration.config.ts` exits 0 against real pgvector.
- [ ] `tools/list` returns an array whose names equal exactly `["add_memories","search_memory","list_memories","delete_memories"]`.
- [ ] After `add_memories` then `search_memory`, the returned JSON string contains the stored text; after `delete_memories`, a re-`search` returns 0 matches.

#### DoD
- [ ] The integration test exits 0; `pnpm run typecheck` 0 errors; `pnpm run lint` 0 warnings.

### Execution
```
THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem pnpm vitest run tests/integration/openmemory/mcp-compat.test.ts --config vitest.integration.config.ts
pnpm vitest run --config vitest.contract.config.ts
pnpm --filter @usetheo/memory-mcp vitest run
pnpm run typecheck && pnpm run lint
```

### Acceptance Criteria
- [ ] A real `@modelcontextprotocol/sdk` MCP **client** connects over the SSE endpoint, `tools/list` returns exactly the 4 OpenMemory names, an `add_memories`→`search_memory` round-trip recalls the stored memory, `delete_memories` removes it, and a second `user_id` cannot see the first user's memory (per-user isolation) — all against real pgvector.
- [ ] No assertion weakened to pass; the JSON-string return shape matches OpenMemory.
