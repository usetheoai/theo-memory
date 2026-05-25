# Plan: v0.3 — `@usetheo/memory/agent-tools` — MCP server exposing 4 verbs to agent loops

> **Version 1.0** — Ships a stdio + streamable-HTTP MCP server at the `@usetheo/memory/agent-tools` subpath exposing `remember/recall/forget/reflect` as JSON-RPC tools consumable by any MCP-aware agent loop (Claude Desktop, Cursor, `@usetheo/sdk` agents). Reuses v0.2's `memoryFromCtx` for scope binding via `AsyncLocalStorage`. Zero changes to `@usetheo/sdk` per blueprint ADR D4 (SDK already ships a full MCP client at SHA `6d9d553`). Closes CLAUDE.md Roadmap Item 4 acceptance: "MCP server boots; `tools/list` returns exactly 4 tools with stable names" + end-to-end via `@usetheo/sdk` agent + JSON-RPC trace confirms no cross-tool state leakage.

## Goal

> "Enable MCP-aware agent loops to invoke `remember/recall/forget/reflect` against a scoped TheMemory instance via the `@usetheo/memory/agent-tools` subpath so that agents persist scoped memory across sessions, measured by `tests/e2e/agent-tools/round-trip.test.ts` passing (spawn stdio subprocess + JSON-RPC `initialize` + `tools/list` returns exactly 4 tools `remember|recall|forget|reflect` + `tools/call` for each verb succeeds with `isError: false` on happy path + ZERO cross-userId overlap across paired `tools/call` invocations)."

## Context

**Current state (2026-05-24, branch `feat/discover-v0-3-agent-tools-mcp`, PR #15 open):**

- v0.0 — Type contract shipped 2026-05-22 (PR #4). 9 ADRs locked, 5 DIPs in `src/core/dip/`.
- v0.1 — Core + local runtime shipped 2026-05-23 (PR #8). Pgvector adapter, 8-phase write pipeline, 9-step retrieval. 257 tests green.
- v0.2 PR-A — TheoKit binding `memoryFromCtx` shipped 2026-05-23 (PR #11). 3-state resolver + `MissingScopeError` + stub adapters. 258 contract + 46 integration tests.
- v0.3 — Blueprint shipped 2026-05-24 (this branch, PR #15). 6 ADRs locked (D1-D6), 8 recommendations distilled, SHIPPABLE_WITH_CAVEATS 85/100 confidence verdict.

**What exists in `src/` today** (per `architecture.md § 3` DIP boundaries):
- `src/core/` — contracts, types, pure logic (extraction + retrieval pipelines, dedup, errors, DIPs). 5 DIPs: `Embedder`, `LLM`, `VectorStore`, `HistoryManager`, `ReflectionPolicy`.
- `src/local/` — pgvector adapter + in-memory adapter + stubs (StubEmbedder/StubLLM from v0.2 PR-A T4.5).
- `src/theokit/` — `memoryFromCtx(ctx, memory)` resolver + `ScopedContext` interface. v0.2 PR-A.
- `src/index.ts` — public barrel (3 subpath exports: `.`, `./contract`, `./theokit`).
- **No `src/agent-tools/` yet** — this plan creates it.

**Evidence motivating this work:**
- Blueprint Q8 (`../theokit-sdk/` at SHA `6d9d553`) confirms SDK already ships full MCP client (`AgentDefinition.mcpServers` + `.theokit/mcp.json` + 3 transports + OAuth PKCE). Integration is server-side only — ZERO SDK code changes.
- Blueprint Q2 (`@modelcontextprotocol/sdk` v1.29.0, MIT, 17 runtime deps including `zod` `^3.25 || ^4.0`) provides high-level `Server` class + transport adapters; building from scratch violates Inquebrável Rule 9 (Não Reinvente).
- Blueprint Q7 (MCP spec 2025-11-25) locks: JSON-RPC 2.0 base, `tools/list` + `tools/call` shapes, JSON Schema 2020-12 default, TWO error mechanisms (Protocol Error JSON-RPC `error{}` vs Tool Execution Error `result.isError: true`), tool name constraints (1-128 chars, `[A-Za-z0-9_.-]`).
- Blueprint Q4 (Letta MCP transports — 4 flavors, Template Method) and Q5 (Mem0 FastMCP server, 574 LoC, 5 tools) overturn EC-5's "Mem0 ships NO MCP server" assumption with full citations.
- User Q during halt-loop ("Nosso sistema ja consegue usar o nosso sistema de memoria? digo o TheoKit-SDK") confirmed NO — v0.3 closes exactly this gap.

## Objective

The Goal is achieved when ALL of the following sub-goals are checked AND the named metric (E2E round-trip + scope isolation test) is observed:

- [ ] `src/agent-tools/` directory created with MCP server bootstrap, transport adapters (stdio + streamable-HTTP), tool registration, and dispatch — per `architecture.md § 3` depending ONLY on `src/core/` (NEVER `src/local/` or `src/cloud/`).
- [ ] `package.json` exposes `./agent-tools` subpath export + `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }` for `npx @usetheo/memory/agent-tools` invocation.
- [ ] 4 zod schemas authored for `remember/recall/forget/reflect` with strict argument validation at JSON-RPC boundary; emitted as JSON Schema 2020-12 via `zod-to-json-schema` in `tools/list` response.
- [ ] `AsyncLocalStorage<ScopedContext>` set per JSON-RPC request, reset in `try/finally`; reuses v0.2's `memoryFromCtx(ctx, memory)` for scope→Memory resolution.
- [ ] TWO error mechanisms implemented per MCP spec § Error Handling: Protocol Errors (JSON-RPC `error{code,message,data?}`) for unknown tool / malformed args; Tool Execution Errors (`result.isError: true` + text content) for `MissingScopeError` / `MemoryStoreError` / `EmbedderError`.
- [ ] 3-tier test pyramid: pure unit (zod validators, tool-name sanitization) + unit-with-mocks (mock JSON-RPC transport, assert `tools/list` shape + dispatch) + E2E (spawn stdio subprocess via `node:child_process`, exercise full handshake + tools/call round-trip + scope isolation).
- [ ] README documents `.theokit/mcp.json` install snippet (per Q8 SDK convention) + `THEOMEM_MCP_TRANSPORT={stdio|streamable-http}` env-var for transport selection.

## Dependencies

> Per cycle-plan v1.1 § Phase contracts — mandatory section. Every dep listed with exact version pin + Rule 9 rationale for NEW entries (per `deps-audit-golden-rule.md`).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| pg | ^8.13.0 | npm | Postgres driver, used by `src/local/pgvector-store.ts` (v0.1). MCP server delegates to v0.1 runtime via injected `MemoryStore`. |
| drizzle-orm | ^0.45.0 | npm | ORM used by `src/local/`. Agent-tools NEVER imports drizzle directly per `architecture.md § 3` DIP (lives in `src/local/`). |
| vitest | ^4.0.0 | npm (dev) | Test framework; agent-tools tests follow v0.1+v0.2 pattern (`tests/unit/`, `tests/integration/`, `tests/e2e/`). |
| vitest-mock-extended | ^4.0.0 | npm (dev) | DIP mocking for unit tests. |

### Changed — version bump required

| Package | From | To | Reason |
|---|---|---|---|
| zod | ^3.24.0 | ^3.25.0 | Satisfies `@modelcontextprotocol/sdk` peer-dep (`^3.25 \|\| ^4.0` per blueprint Q2 snapshot). Patch-level change within zod's stable major; no API breakage. v0.1's existing zod usage in `src/core/` validators is forward-compatible. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| @modelcontextprotocol/sdk | ^1.29.0 | npm | Evaluated: (a) handroll JSON-RPC 2.0 + transports from scratch — REJECTED per Inquebrável Rule 9 (the protocol exists for exactly this) + violates blueprint ADR D1; (b) `mcp-framework` (community fork, smaller dep tree, last release > 6mo) — REJECTED for staleness (deps-audit-golden-rule § auditor_unavailable signal); (c) `fastmcp` Python SDK Node port — does not exist in npm registry per blueprint Q2. | Official Anthropic-maintained TS SDK; symmetric server/client design (Q2 + Q7); ships `./server/stdio` + `./server/streamableHttp`; MIT; ~1.5-2 MB transitive deps accepted per ADR D1. |
| zod-to-json-schema | ^3.x | npm | Evaluated: (a) handroll JSON-Schema-2020-12 literals per tool — REJECTED per Rule 9 + manual JSON-Schema is error-prone; (b) `zod-to-openapi` — REJECTED: emits OpenAPI 3.x shape, not pure JSON Schema 2020-12 (blueprint Q7 mandates 2020-12 default dialect); (c) `@anatine/zod-to-openapi` — same rejection. | Bundled as peer-dep of `@modelcontextprotocol/sdk` per Q2; emits `required` arrays correctly (proves LangMem `_ToolWithRequired` workaround unneeded per blueprint Q6 + ADR D2 followup F-zod-schema-fixture-test). |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | This plan is additive; no removals. |

## ADRs

> D1-D6 mirror the blueprint's locked ADRs (verbatim short-form here; full Context/Alternatives/Consequences in `.claude/knowledge-base/discoveries/blueprints/v0-3-agent-tools-mcp-blueprint.md § ADRs`). D7-D8 are v0.3-plan-specific.

### D1 — Transport: stdio (primary) + streamable-HTTP (secondary); skip SSE; skip fastmcp wrapper

**Decision.** Ship stdio + streamable-HTTP transports via `@modelcontextprotocol/sdk/server/stdio` + `@modelcontextprotocol/sdk/server/streamableHttp`. Skip SSE (4× independently confirmed deprecated). Skip fastmcp-style OAuth wrapper (no OAuth in v0.3 scope per CLAUDE.md Item 4).

**Rationale.** Aligns with `architecture.md § 3` DIP (transports are infrastructure; live in `src/agent-tools/transports/`, depend on core contracts only). Blueprint cited 4 independent sources confirming SSE deprecation. Honors Inquebrável Rule 9 (`@modelcontextprotocol/sdk` exists; not reinvented).

**Consequences.** v0.3 ships 2 transport adapters; documentation explicitly notes "SSE not supported — use streamable-HTTP". `THEOMEM_MCP_TRANSPORT` env-var controls runtime choice. Letta's typed error remapping pattern adopted at request-handler boundary.

### D2 — Tool schema: zod-authored + zod-to-json-schema → JSON Schema 2020-12; 4 separate tools

**Decision.** Author 4 separate zod schemas (`rememberSchema`, `recallSchema`, `forgetSchema`, `reflectSchema`) co-located with their dispatch handlers. Pipe through `zod-to-json-schema` for `tools/list` response. Tool names match TheMemory API verbs verbatim (1-128 chars, `[A-Za-z0-9_.-]` per Q7).

**Rationale.** CLAUDE.md Item 4 acceptance: "exactly 4 tools with stable names". LangMem's action-collapsing pattern (Q6) REJECTED: per-action argument requirements (id required for forget, forbidden for remember) cannot be statically encoded in a single schema. zod's strictness eliminates need for LangMem's `_ToolWithRequired` workaround (followup F-zod-schema-fixture-test will prove this).

**Consequences.** Each tool dispatch handler validates input at boundary via zod runtime check before invoking domain logic. `recall` ships `outputSchema` + `structuredContent` for typed results array. Server declares `capabilities.tools.listChanged: false` (4 tools static).

### D3 — Cross-tool isolation via Node.js `AsyncLocalStorage`

**Decision.** Use `node:async_hooks` `AsyncLocalStorage<ScopedContext>` initialized at JSON-RPC request boundary (per-handler `als.run(ctx, () => dispatch(...))`). Tool body calls `memoryFromCtx(als.getStore()!, injectedMemoryFactory())`. Reset is automatic via `als.run`'s lexical scope (no manual try/finally needed — `AsyncLocalStorage` is auto-resetting unlike Python's `contextvars.ContextVar`).

**Rationale.** Native Node.js analog of Mem0's `contextvars.ContextVar` (Q5) and LangMem's `_get_store(initial_store)` runtime fallback (Q6). Reuses v0.2 PR-A's `memoryFromCtx` 3-state resolver — no new scope-resolution code. Honors `architecture.md § 9` (public API surface — `memoryFromCtx` is already a public export at `@usetheo/memory/theokit`).

**Consequences.** Tool handlers stay stateless w.r.t. scope (pure functions). Concurrent requests in streamable-HTTP mode get per-request isolation automatically. Risk: missing `als.run` wrapper = scope undefined → tool returns `MissingScopeError` Tool Execution Error (per D6). Mitigated via E2E test asserting 2 sequential calls with different userIds produce ZERO cross-contamination.

### D4 — SDK integration via SDK's existing MCP client (zero SDK changes)

**Decision.** v0.3 is SERVER-ONLY. Do NOT ship an `@usetheo/memory/agent-tools-client`. SDK at SHA `6d9d553` already consumes via `AgentDefinition.mcpServers` + `.theokit/mcp.json`.

**Rationale.** Blueprint Q8 confirms SDK has full MCP client: `mcpServers?: Array<string | Record<string, McpServerConfig>>`, tool-naming `mcp_<server>_call`, OAuth 2.1 PKCE. Sibling `@usetheo/memory-{supermemory,honcho,mem0}` packages consume `MemoryAdapter` contract (in-process imports) — DIFFERENT layer from TheMemory (managed runtime). Confusing them silently violates `architecture.md § 5` two-runtimes principle.

**Consequences.** README documents canonical `.theokit/mcp.json` snippet. SDK auto-discovers via `buildToolList` on agent boot. No coordination ticket needed with `@usetheo/sdk` team. Doc section "TheMemory is NOT a `MemoryAdapter` — different layer" explicitly added.

### D5 — Test pyramid: 3-tier (pure unit + mocks + E2E stdio subprocess)

**Decision.** Mirror Letta's 3-tier (blueprint Q1): pure unit (zod validators, tool-name sanitization — runs in ms); unit-with-mocks (mock JSON-RPC transport, assert `tools/list` shape + per-tool dispatch); E2E (spawn `node dist/agent-tools/cli.js` via `child_process.spawn`, exercise `initialize` + `tools/list` + `tools/call` for each verb + scope isolation test).

**Rationale.** Honors `testing.md § Pyramid`. Critical paths needing 100% coverage per `testing.md`: JSON-RPC handler dispatch, scope-binding `AsyncLocalStorage` setter/reader, zod validation at boundary, error-mechanism dispatch (Protocol vs Tool Execution). E2E budget 30s matches v0.2 integration tests pattern.

**Consequences.** Adopt Letta's try/finally subprocess cleanup discipline (Q1 `test_mcp.py:266-270`). Catalog of expected error classes per Letta's `EXPECTED_MCP_TOOL_ERRORS` pattern (Q3) — log-level-classify at JSON-RPC boundary. Reject Letta's fresh-venv-per-test (Q1) — Node.js E2E uses cached `node_modules`. F-mcp-e2e-fixture: tiny mock-MCP-client helper.

### D6 — Error shape: TWO mechanisms per MCP spec

**Decision.** Implement BOTH per Q7 § Error Handling:
- **Protocol Errors** (JSON-RPC `error{code, message, data?}`): unknown tool name (`-32601 Method not found`); zod validation fail at boundary (`-32602 Invalid params`); transport crash (`-32603 Internal error`).
- **Tool Execution Errors** (`result.isError: true` + content text): `MissingScopeError` (D3), `MemoryStoreError` (DB unreachable), `EmbedderError` (provider down), `ContentTooLargeError` (input > embedding-dim cap).

**Rationale.** Spec § Error Handling distinguishes recoverable (LLM self-correctable) from structural failures. Mem0's plain-string return shape (Q5) is non-compliant — clients can't distinguish error from success. v0.3 honors `architecture.md § 8` (typed domain errors from `src/core/errors.ts`).

**Consequences.** Catalog of expected error classes maintained at `src/agent-tools/error-classifier.ts`. Adopt Mem0's graceful-degradation pattern (Q5 lines 46-77): DB-unreachable returns Tool Execution Error with actionable text, NOT crash JSON-RPC connection. Test discipline: unit tests assert BOTH error paths produce correct wire shape.

### D7 — Deps-audit absorption: bump zod, add 2 NEW deps, declare allowlist if needed

**Decision.** Bump `zod ^3.24 → ^3.25` (patch-level; no API break). Add `@modelcontextprotocol/sdk ^1.29.0` + `zod-to-json-schema ^3.x` as runtime deps. `/deps-audit v0-3-agent-tools-mcp` MUST run between `/edge-case-plan` and `/plan-confidence` per cycle-plan.md v1.1 § Chain.

**Rationale.** v0.1 already has 4 MODERATE CVE allowlist entries (dev-only esbuild chain) with sunset 2026-08-23 per the v0-1 deps audit. v0.3 inherits those — no expiration risk. Two NEW deps introduce ~1.5-2 MB transitive deps (per blueprint Q2 estimate) — accepted as price of Inquebrável Rule 9 compliance.

**Consequences.** `deps-audit-allowlist.txt` may grow if `@modelcontextprotocol/sdk`'s transitive deps surface unallowlisted CVEs at install time. Allowlist additions require sunset ≤ 90 days per `deps-audit-golden-rule.md`. If audit returns FAIL_INSECURE (CRITICAL/HIGH CVE), plan-confidence caps at 49 → /to-plan loops back to revise dep choice.

### D8 — Package surface: subpath export + bin entry; isolated bundle (no main barrel leak)

**Decision.** Add 2 entries to `package.json`:
1. `exports["./agent-tools"]: { "types": "./src/agent-tools/index.ts", "default": "./src/agent-tools/index.ts" }` — public subpath import for programmatic embedding.
2. `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }` — CLI entry for `npx @usetheo/memory/agent-tools` invocation per Q8 `.theokit/mcp.json` convention.

Default barrel `@usetheo/memory` (src/index.ts) MUST NOT export anything from `src/agent-tools/` — bundle isolation per `architecture.md § 9`.

**Rationale.** Mirrors v0.2 PR-A pattern (`./theokit` subpath isolation). Tripwire test asserts `src/index.ts` contains zero `agent-tools` references (same pattern as v0.2's `public-paths.test.ts` for theokit). bin entry follows SDK's own `bin: { theokit-migrate-config, theokit-migrate-memory }` convention (Q8).

**Consequences.** Consumers who import only `@usetheo/memory` do NOT pull `@modelcontextprotocol/sdk` (~1.5-2 MB savings). Consumers who explicitly import `@usetheo/memory/agent-tools` opt-in to the MCP server. Compiled `dist/` shape required for bin to work post-publish — add to build step if not present.

## Dependency Graph

```
Phase 0: Setup deps + scaffold ──┐
                                  │
                                  ▼
                     Phase 1: Server bootstrap (MCP server class + capabilities)
                                  │
                  ┌───────────────┼───────────────┐
                  │               │               │
                  ▼               ▼               ▼
            Phase 2: Schemas  Phase 3: Scope    Phase 4: Error
            (4 zod + JSON     binding           translation
             Schema)           (AsyncLocalStorage)
                  │               │               │
                  └───────────────┼───────────────┘
                                  │
                                  ▼
                     Phase 5: Tool dispatch (wire 4 verbs end-to-end)
                                  │
                                  ▼
                     Phase 6: Transports (stdio + streamable-HTTP)
                                  │
                                  ▼
                     Phase 7: Tests + docs (3-tier pyramid + README + .theokit/mcp.json example)
                                  │
                                  ▼
                     Final Phase: Integration Validation
```

Phases 2, 3, 4 are parallelizable (independent vertical slices). Phases 5+ are sequential (each builds on prior).

---

## Phase 0: Setup deps + scaffold

**Objective:** Bump `zod`, add 2 NEW deps, create `src/agent-tools/` skeleton, expose subpath + bin entry. Foundation for all subsequent phases.

### T0.1 — Bump zod + add MCP SDK + zod-to-json-schema

#### Objective
Update `package.json` to add 2 NEW runtime deps + bump zod. Verify install + lockfile updates.

#### Evidence
Blueprint Q2 confirmed `@modelcontextprotocol/sdk` peer-dep is `zod ^3.25 || ^4.0`; current `^3.24.0` would fail SDK install. Two NEW deps required: SDK itself + `zod-to-json-schema` for tool schema codegen.

#### Files to edit
```
package.json — bump zod 3.24→3.25, add @modelcontextprotocol/sdk + zod-to-json-schema
package-lock.json — auto-updated by npm install
```

#### Deep file dependency analysis
- `package.json` — declares 3 runtime deps (drizzle-orm, pg, zod). Adding 2 NEW + 1 bump.
- Lockfile changes are derived; no manual edit.
- v0.1's existing `zod` usage in `src/core/dip/*` validators is forward-compatible with 3.25 (patch-level).

#### Deep Dives
- **Lockfile integrity**: after `npm install`, run `/deps-audit v0-3-agent-tools-mcp` per cycle-plan v1.1 § Chain BEFORE this commit lands. If FAIL_INSECURE (CRITICAL/HIGH on declared dep), HALT and revise dep choice in this plan.
- **Transitive bloat**: blueprint estimated ~1.5-2 MB transitive deps; verify with `npm ls --prod --depth=1` post-install.

#### Tasks
1. Edit `package.json`: bump `zod` from `^3.24.0` to `^3.25.0`; add `@modelcontextprotocol/sdk: ^1.29.0` + `zod-to-json-schema: ^3.x`.
2. Run `npm install` to update lockfile.
3. Run `/deps-audit v0-3-agent-tools-mcp` per cycle-plan v1.1 — verdict MUST be PASS or PASS_WITH_CAVEATS before proceeding.
4. Commit `package.json` + `package-lock.json`.

#### TDD
```
RED:    test_zod_version_satisfies_mcp_sdk_peer_dep() — read package.json, assert zod range is "^3.25.0" (matches SDK peer "^3.25 || ^4.0")
RED:    test_mcp_sdk_dep_present() — assert @modelcontextprotocol/sdk in dependencies
RED:    test_zod_to_json_schema_dep_present() — assert zod-to-json-schema in dependencies
GREEN:  Apply the 3 package.json edits + npm install
REFACTOR: None expected
VERIFY: npm test -- tests/unit/agent-tools/package-deps.test.ts
```

#### Acceptance Criteria
- [ ] `package.json` declares all 3 dep changes correctly versioned
- [ ] `npm install` exits 0; lockfile updated
- [ ] `/deps-audit v0-3-agent-tools-mcp` returns PASS or PASS_WITH_CAVEATS
- [ ] Pass: lint — `npm run lint` zero warnings
- [ ] Pass: size — `package.json` ≤ 500 lines (per `architecture.md § Module hygiene`)

#### DoD
- [ ] T0.1 tasks complete and validated
- [ ] `npm test -- tests/unit/agent-tools/package-deps.test.ts` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`

### T0.2 — Scaffold `src/agent-tools/` directory + expose subpath + bin entry (D8)

#### Objective
Create directory skeleton with `index.ts` barrel + `cli.ts` entry stub. Wire `./agent-tools` subpath export + `bin` entry per ADR D8.

#### Evidence
ADR D8 specifies subpath shape mirroring v0.2's `./theokit`. SDK's own `bin` pattern (Q8 — `theokit-migrate-config`, `theokit-migrate-memory`) is the convention.

#### Files to edit
```
src/agent-tools/index.ts (NEW) — public barrel, exports for programmatic embedding
src/agent-tools/cli.ts (NEW) — CLI entry stub (full impl in T6.1)
src/agent-tools/types.ts (NEW) — internal types (McpServerOptions, etc.)
package.json — add ./agent-tools to exports + add bin entry
tests/integration/agent-tools/public-paths.test.ts (NEW) — RED tripwire test
```

#### Deep file dependency analysis
- `src/agent-tools/` is NEW. Per `architecture.md § 3`, it depends ONLY on `src/core/`.
- `src/index.ts` MUST NOT re-export agent-tools (tripwire test in T0.2 enforces).
- `package.json` exports already has `.`, `./contract`, `./theokit` — add `./agent-tools`.

#### Deep Dives
- **Tripwire pattern**: mirror v0.2 PR-A's `tests/integration/public-paths.test.ts` shape — assert `src/index.ts` source contains zero `agent-tools` references via `readFileSync` + `expect(source).not.toContain('agent-tools')`.
- **CLI stub**: `cli.ts` exports a `main(argv: string[])` function returning Promise<void>. Implementation deferred to T6.1 (transport wiring); stub returns immediately with exit 0.
- **bin path**: `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }` — requires compiled `dist/` for runtime. Build step covered in T6.1.

#### Tasks
1. Create `src/agent-tools/` directory.
2. Create `index.ts` barrel exporting `createMcpServer` (placeholder) + `types.ts` re-exports.
3. Create `cli.ts` with stub `main(argv)` returning resolved Promise.
4. Create `types.ts` declaring `McpServerOptions`, `TransportKind = 'stdio' | 'streamable-http'`.
5. Edit `package.json` to add `./agent-tools` subpath export entry (mirror `./theokit` shape).
6. Edit `package.json` to add `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }`.
7. Write tripwire test asserting main barrel does not leak agent-tools symbols.

#### TDD
```
RED:    test_agent_tools_subpath_resolves() — import('@usetheo/memory/agent-tools') succeeds, default export is { createMcpServer: function }
RED:    test_main_barrel_does_not_contain_agent_tools() — readFileSync('src/index.ts'), expect not to contain 'agent-tools'
RED:    test_bin_entry_present() — read package.json, assert bin['themory-mcp'] === './dist/agent-tools/cli.js'
GREEN:  Create directory + stub files + package.json edits
REFACTOR: None expected
VERIFY: npm test -- tests/integration/agent-tools/public-paths.test.ts
```

#### Acceptance Criteria
- [ ] `src/agent-tools/` exists with index.ts + cli.ts + types.ts
- [ ] `package.json` exports['./agent-tools'] points to `./src/agent-tools/index.ts`
- [ ] `package.json` bin['themory-mcp'] declared
- [ ] Tripwire test passes (main barrel isolation)
- [ ] Pass: complexity — every file cyclomatic ≤ 10
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — every file ≤ 500 LoC (stubs <100 each)

#### DoD
- [ ] T0.2 tasks complete
- [ ] `npm test -- tests/integration/agent-tools/public-paths.test.ts` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

---

## Phase 1: MCP server bootstrap + capability declaration

**Objective:** Create `McpServer` class wrapping `@modelcontextprotocol/sdk/server`'s high-level `Server`. Declare `capabilities.tools.listChanged: false` per D2. No tools registered yet (Phase 2). No transports wired yet (Phase 6).

### T1.1 — Create McpServer wrapper class

#### Objective
Thin wrapper class around SDK `Server` that owns: server instance, server metadata (name/version), capability declaration, lifecycle (start/stop).

#### Evidence
Blueprint Q4 (Letta's `AsyncBaseMCPClient`) shows the 4-method lifecycle pattern (connect/list/execute/cleanup); v0.3 server-side mirrors with bootstrap/registerTools/dispatch/cleanup. Q7 mandates `capabilities.tools.listChanged` declaration.

#### Files to edit
```
src/agent-tools/server.ts (NEW) — McpServer class
src/agent-tools/__tests__/server.test.ts (NEW) — unit tests
src/agent-tools/index.ts — export McpServer + createMcpServer factory
```

#### Deep file dependency analysis
- `server.ts` imports `Server` from `@modelcontextprotocol/sdk/server/index.js` (per SDK Q2 entry).
- Imports `McpServerOptions` from `types.ts` (T0.2).
- Pure construction logic; no I/O at this layer (transports + dispatch come later).

#### Deep Dives
- **SDK Server constructor**: `new Server({ name: 'themory', version: process.env.npm_package_version ?? '0.3.0' }, { capabilities: { tools: { listChanged: false } } })`.
- **Static tool count**: v0.3 ships 4 tools, set at server construction; never changes. `listChanged: false` is correct per D2.
- **Lifecycle**: `start(transport)` and `stop()`. `start` connects the server to a transport (Phase 6); `stop` calls `await server.close()` for graceful shutdown.

#### Tasks
1. Create `src/agent-tools/server.ts` with `McpServer` class.
2. Constructor takes `McpServerOptions` (name, version, memoryFactory, env).
3. Internal field: `private readonly sdkServer: Server`.
4. Method `start(transport: Transport): Promise<void>` calls `await sdkServer.connect(transport)`.
5. Method `stop(): Promise<void>` calls `await sdkServer.close()`.
6. Export from `index.ts` barrel.

#### TDD
```
RED:    test_mcp_server_constructs_with_capabilities_declared() — new McpServer({...}), inspect underlying SDK server's capabilities.tools.listChanged === false
RED:    test_mcp_server_name_defaults_to_themory() — new McpServer({}), assert name === 'themory'
RED:    test_mcp_server_version_from_options() — new McpServer({version: '0.3.0-test'}), assert version === '0.3.0-test'
GREEN:  Implement McpServer class
REFACTOR: None expected
VERIFY: npm test -- src/agent-tools/__tests__/server.test.ts
```

#### Acceptance Criteria
- [ ] `McpServer` class exported from `src/agent-tools/index.ts`
- [ ] Capability `tools.listChanged: false` declared
- [ ] Constructor accepts `McpServerOptions` with sensible defaults
- [ ] Pass: complexity — McpServer class cyclomatic ≤ 10
- [ ] Pass: lint — zero warnings on changed files
- [ ] Pass: size — `server.ts` ≤ 500 lines (expected ~100-150)

#### DoD
- [ ] T1.1 tasks complete
- [ ] `npm test -- src/agent-tools/__tests__/server.test.ts` green
- [ ] `npm run typecheck` zero errors

---

## Phase 2: Tool schemas + JSON Schema emission

**Objective:** Author 4 zod schemas (one per verb) co-located with their handlers. Emit JSON Schema 2020-12 via `zod-to-json-schema` for `tools/list` response. Per ADR D2.

### T2.1 — Author 4 zod schemas + tool metadata

#### Objective
Define input/output schemas for `remember/recall/forget/reflect` using zod. Each schema lives next to its dispatch handler (Phase 5). Tool metadata (name, title, description) co-located.

#### Evidence
Blueprint ADR D2 specifies inline zod schemas + `zod-to-json-schema` pipeline. CLAUDE.md API verbs locked: `remember/recall/forget/reflect`. v0.0 contract types from `src/core/` define payload shapes — schemas mirror them.

#### Files to edit
```
src/agent-tools/tools/remember-schema.ts (NEW) — input: { content: string, metadata?: Record<string, unknown> }
src/agent-tools/tools/recall-schema.ts (NEW) — input: { query: string, topK?: number, threshold?: number }; output schema for structuredContent
src/agent-tools/tools/forget-schema.ts (NEW) — input: { id?: string, all?: boolean } with mutual-exclusion refinement
src/agent-tools/tools/reflect-schema.ts (NEW) — input: { /* empty object accepted per Q7 no-params shape */ }
src/agent-tools/tools/__tests__/schemas.test.ts (NEW) — RED tests for each
```

#### Deep file dependency analysis
- Each schema file is leaf — depends only on `zod` + (for recall output) types from `src/core/memory-item.ts`.
- Per `architecture.md § 3`, `src/agent-tools/` imports from `src/core/` allowed.
- No cross-tool imports between schema files.

#### Deep Dives
- **Forget mutual exclusion**: `z.object({id: z.string().uuid().optional(), all: z.boolean().optional()}).refine(d => Boolean(d.id) !== Boolean(d.all), { message: 'Provide exactly one of id or all' })`. Mirror LangMem's argument-contract discipline (Q6).
- **Recall output schema**: array of `{id, text, score, attributedTo?, scope, timestamp}` matching `MemoryItem` from v0.0 contract.
- **No-params reflect**: per Q7 spec, recommended shape is `z.object({}).strict()` which JSON-schemifies to `{type: 'object', additionalProperties: false}`.
- **Tool name validation**: each schema file exports `TOOL_NAME` constant; must match regex `/^[A-Za-z0-9_.-]{1,128}$/` per Q7. Verified in unit test.

#### Tasks
1. Create 4 schema files with zod definitions.
2. Export `TOOL_NAME`, `INPUT_SCHEMA`, `OUTPUT_SCHEMA` (recall only), `DESCRIPTION` constants from each.
3. Write unit tests asserting:
   - Each schema parses valid input successfully.
   - Each schema rejects invalid input with specific zod error.
   - Forget's mutual-exclusion refinement fires correctly.
   - Tool names match spec regex.

#### TDD
```
RED:    test_remember_schema_accepts_content_string() — parses { content: 'foo' }
RED:    test_remember_schema_rejects_missing_content() — rejects {}
RED:    test_recall_schema_default_topK_5() — parses { query: 'foo' }, asserts topK defaults to 5
RED:    test_forget_schema_rejects_both_id_and_all() — rejects { id: 'x', all: true }
RED:    test_forget_schema_rejects_neither_id_nor_all() — rejects {}
RED:    test_reflect_schema_accepts_empty_object() — parses {}
RED:    test_each_tool_name_matches_spec_regex() — TOOL_NAME for each ∈ /^[A-Za-z0-9_.-]{1,128}$/
GREEN:  Implement 4 schema files
REFACTOR: Extract shared zod helpers if duplication exists (rule of three)
VERIFY: npm test -- src/agent-tools/tools/__tests__/schemas.test.ts
```

#### Acceptance Criteria
- [ ] 4 schema files exist with constants exported
- [ ] All RED tests pass after GREEN
- [ ] Forget mutual-exclusion enforced
- [ ] All tool names spec-compliant
- [ ] Pass: complexity — each schema file cyclomatic ≤ 10
- [ ] Pass: coverage — 100% on schema files (critical path)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — each file ≤ 500 LoC (expected ~50-100 each)

#### DoD
- [ ] T2.1 tasks complete
- [ ] `npm test -- src/agent-tools/tools/__tests__/schemas.test.ts` green
- [ ] `npm run typecheck` zero errors

### T2.2 — `tools/list` response emitter

#### Objective
Implement `buildToolsListResponse()` returning the spec-compliant `{tools: [...]}` payload. Pipes each zod schema through `zod-to-json-schema`. Wires SDK's `tools/list` request handler.

#### Evidence
Blueprint Q7 specifies exact response shape verbatim. SDK ships `zod-to-json-schema` peer-dep (Q2). ADR D2 mandates JSON Schema 2020-12 default dialect.

#### Files to edit
```
src/agent-tools/tools/list-handler.ts (NEW) — buildToolsListResponse() + SDK request handler registration
src/agent-tools/tools/__tests__/list-handler.test.ts (NEW) — assert response shape exactly matches Q7
src/agent-tools/server.ts — wire handler in constructor (after T1.1 lands)
```

#### Deep file dependency analysis
- Imports 4 schema files from T2.1.
- Imports `zodToJsonSchema` from `zod-to-json-schema`.
- Calls SDK's `server.setRequestHandler(ListToolsRequestSchema, handler)`.

#### Deep Dives
- **Per-tool entry shape** (per Q7):
  ```ts
  {
    name: TOOL_NAME,
    description: DESCRIPTION,
    inputSchema: zodToJsonSchema(INPUT_SCHEMA, { target: 'jsonSchema2019-09' }),  // or '2020-12' per emitter version
    outputSchema: OUTPUT_SCHEMA ? zodToJsonSchema(OUTPUT_SCHEMA, ...) : undefined,
  }
  ```
- **Required array verification (F-zod-schema-fixture-test from blueprint)**: assert emitted JSON Schema includes `required: ['content']` for remember, `required: ['query']` for recall — proves LangMem `_ToolWithRequired` workaround unneeded.
- **No pagination at v0.3**: 4 static tools, no cursor needed; omit `nextCursor` from response.

#### Tasks
1. Implement `buildToolsListResponse()` returning array of 4 tool entries.
2. Each entry pipes its schema through `zod-to-json-schema`.
3. Register handler via `server.setRequestHandler(ListToolsRequestSchema, ...)`.
4. Write unit test asserting:
   - Response has exactly 4 entries.
   - Tool names are `['remember', 'recall', 'forget', 'reflect']` in declaration order.
   - Each `inputSchema` has `type: 'object'`.
   - Remember's `inputSchema.required` contains `'content'`.
   - Recall has non-empty `outputSchema`.

#### TDD
```
RED:    test_tools_list_returns_exactly_4_tools() — assert response.tools.length === 4
RED:    test_tools_list_names_match_locked_verbs() — assert names === ['remember', 'recall', 'forget', 'reflect']
RED:    test_tools_list_remember_schema_has_required_content() — asserts inputSchema.required includes 'content' (F-zod-schema-fixture-test)
RED:    test_tools_list_recall_has_output_schema() — recall entry has outputSchema with type:'object'
GREEN:  Implement buildToolsListResponse + wire SDK handler
REFACTOR: Extract zodToJsonSchema call into helper if used > 1x (rule of three not yet met but extraction reduces test surface)
VERIFY: npm test -- src/agent-tools/tools/__tests__/list-handler.test.ts
```

#### Acceptance Criteria
- [ ] `tools/list` response shape exactly matches Q7 § Listing Tools
- [ ] Exactly 4 tools returned, names match locked verbs
- [ ] `required` arrays emitted correctly by zod-to-json-schema (proves F-zod-schema-fixture-test)
- [ ] Pass: complexity — list-handler cyclomatic ≤ 10
- [ ] Pass: coverage — 100% (critical path)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — ≤ 500 LoC

#### DoD
- [ ] T2.2 tasks complete
- [ ] `npm test -- src/agent-tools/tools/__tests__/list-handler.test.ts` green
- [ ] `npm run typecheck` zero errors

---

## Phase 3: Scope binding via `AsyncLocalStorage`

**Objective:** Wire per-request scope binding so tool bodies resolve via `memoryFromCtx`. Per ADR D3.

### T3.1 — Implement scope-binding middleware

#### Objective
Create `withScope(ctx, fn)` helper using `AsyncLocalStorage` so dispatch handlers get scope automatically. Reuses v0.2 PR-A's `memoryFromCtx` for scope→Memory resolution.

#### Evidence
ADR D3 + Mem0's `contextvars.ContextVar` pattern (Q5) + LangMem's `_get_store` fallback (Q6). v0.2 PR-A already exports `memoryFromCtx` from `@usetheo/memory/theokit`.

#### Files to edit
```
src/agent-tools/scope.ts (NEW) — AsyncLocalStorage wrapper + getScope/withScope helpers
src/agent-tools/__tests__/scope.test.ts (NEW) — RED tests
src/agent-tools/index.ts — re-export getScope (for testing) and withScope
```

#### Deep file dependency analysis
- Imports `AsyncLocalStorage` from `node:async_hooks` (Node native).
- Imports `ScopedContext` type from `src/theokit/types.ts` (v0.2 PR-A artifact) via `@usetheo/memory/theokit` subpath — but wait, that's an external import shape. Internal cross-subpath imports should use relative paths: `import type { ScopedContext } from '../theokit/types.js'`. This is allowed per `architecture.md § 3` since theokit and agent-tools are sibling layers depending on core; sharing a TYPE from one sibling to another is permissible when the type is structural.
- ALTERNATIVE: move `ScopedContext` to `src/core/scope.ts` so both sibling layers import from core (cleaner DIP). Decision: do this in T3.1 as a sibling refactor commit; v0.2's `src/theokit/types.ts` re-exports from core for backward compat.

#### Deep Dives
- **AsyncLocalStorage API**:
  ```ts
  const als = new AsyncLocalStorage<ScopedContext>();
  // Setter (request boundary)
  await als.run(ctx, async () => { /* dispatch */ });
  // Getter (tool body)
  const ctx = als.getStore();  // returns ScopedContext | undefined
  ```
- **Reset is automatic**: unlike Python's `contextvars`, `AsyncLocalStorage.run()` auto-resets on exit; no manual try/finally needed.
- **MissingScopeError handling**: `getScope()` helper throws `MissingScopeError` if store is undefined (mirrors v0.2 PR-A's `memoryFromCtx` 3-state resolver — state c "absent").
- **Decision: move `ScopedContext` to core**: edit `src/core/scope.ts` (already exists per v0.0 file listing) to declare structural `ScopedContext` type; `src/theokit/types.ts` re-exports. Backward-compat preserved.

#### Tasks
1. Move `ScopedContext` declaration from `src/theokit/types.ts` to `src/core/scope.ts` (NEW addition to existing file).
2. Update `src/theokit/types.ts` to re-export `ScopedContext` from core (backward compat).
3. Create `src/agent-tools/scope.ts` with `AsyncLocalStorage<ScopedContext>` instance + `withScope(ctx, fn)` runner + `getScope()` getter.
4. Write unit tests:
   - `getScope()` outside `withScope` throws `MissingScopeError`.
   - `getScope()` inside `withScope` returns the passed ctx.
   - Nested `withScope(ctx1, () => withScope(ctx2, () => getScope()))` returns ctx2 (inner scope wins).
   - Concurrent `withScope` calls do not leak across each other (Promise.all with different ctxs).

#### TDD
```
RED:    test_getScope_throws_outside_withScope() — expect MissingScopeError
RED:    test_getScope_returns_ctx_inside_withScope() — withScope({session:{userId:'alice'}}, () => expect(getScope()).toEqual(...))
RED:    test_nested_withScope_inner_wins() — withScope(outer, () => withScope(inner, () => expect getScope === inner))
RED:    test_concurrent_withScope_isolation() — Promise.all of 2 ctxs; assert each sees its own
RED:    test_scope_type_imported_from_core() — typecheck assertion: import { ScopedContext } from 'src/core/scope.js' works
GREEN:  Implement scope.ts + move ScopedContext to core
REFACTOR: None expected
VERIFY: npm test -- src/agent-tools/__tests__/scope.test.ts
```

#### Acceptance Criteria
- [ ] `withScope` + `getScope` exported from `src/agent-tools/index.ts`
- [ ] `ScopedContext` moved to `src/core/scope.ts`; v0.2 PR-A backward compat preserved
- [ ] All 5 RED tests pass
- [ ] Concurrent isolation verified
- [ ] Pass: complexity — scope.ts cyclomatic ≤ 10
- [ ] Pass: coverage — 100% (critical path)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — ≤ 500 LoC (expected ~80)

#### DoD
- [ ] T3.1 tasks complete
- [ ] `npm test -- src/agent-tools/__tests__/scope.test.ts` green
- [ ] v0.2 PR-A tests still green (backward compat: `npm test -- tests/integration/theokit-binding.test.ts`)
- [ ] `npm run typecheck` zero errors

---

## Phase 4: Error translation layer

**Objective:** Implement the two-mechanism error shape per ADR D6. Catalog of expected error classes.

### T4.1 — Error classifier + translator

#### Objective
Create `classifyError(err: unknown): {kind: 'protocol' | 'execution', payload}` that maps domain errors to spec-compliant wire shapes. Handles MissingScopeError, MemoryStoreError, EmbedderError, ContentTooLargeError, plus generic catch-all.

#### Evidence
ADR D6 mandates BOTH mechanisms. Mem0's pattern (Q5) returns plain strings (spec-non-compliant); LangMem (Q6) raises Python exceptions (lossy translation). v0.3 must emit proper JSON-RPC `error` vs `result.isError: true`.

#### Files to edit
```
src/agent-tools/error-classifier.ts (NEW)
src/agent-tools/__tests__/error-classifier.test.ts (NEW)
src/core/errors.ts — add MemoryStoreError, EmbedderError, ContentTooLargeError if missing
```

#### Deep file dependency analysis
- `error-classifier.ts` imports domain error classes from `src/core/errors.ts`.
- v0.2 PR-A added `MissingScopeError` to `src/core/errors.ts` — reuse.
- v0.1 may have `MemoryStoreError` already; verify in T4.1 step 0.

#### Deep Dives
- **Classifier rules**:
  - `MissingScopeError` → Tool Execution Error: `{isError: true, content: [{type:'text', text: 'Scope not bound. Caller must invoke memoryFromCtx with ctx.session before tool call.'}]}`.
  - `MemoryStoreError` (DB unreachable, pgvector down) → Tool Execution Error with actionable text: "Memory store unavailable. Retry in a moment.".
  - `EmbedderError` → Tool Execution Error: "Embedding provider unavailable. Retry in a moment.".
  - `ContentTooLargeError` → Tool Execution Error: "Content exceeds maximum embedding dimension ({MAX_EMBEDDING_DIM}).".
  - `ZodError` (from boundary validation, T2.1) → Protocol Error `-32602 Invalid params` with `data: zodError.flatten()`.
  - Unknown tool name (from dispatch, Phase 5) → Protocol Error `-32601 Method not found` with `data: {requestedTool: name}`.
  - Unexpected error (anything else) → Protocol Error `-32603 Internal error` with `data: {message: err.message}`; do NOT leak stack trace.
- **Letta `EXPECTED_MCP_TOOL_ERRORS` discipline (Q3)**: maintain `EXPECTED_DOMAIN_ERRORS` tuple of error class names; classifier uses for log-level decision (info vs warning) — future observability hook, not v0.3 wiring.

#### Tasks
1. Verify/add domain error classes in `src/core/errors.ts`.
2. Implement `classifyError(err)` function.
3. Export `EXPECTED_DOMAIN_ERRORS` const tuple.
4. Write unit tests covering all 7 classification cases.

#### TDD
```
RED:    test_classify_missing_scope_returns_execution_error() — assert kind:'execution', payload has isError:true
RED:    test_classify_memory_store_error_returns_execution_with_retry_text() — text mentions 'Retry'
RED:    test_classify_embedder_error_returns_execution() — similar
RED:    test_classify_content_too_large_returns_execution() — text references MAX_EMBEDDING_DIM
RED:    test_classify_zod_error_returns_protocol_invalid_params_minus_32602() — code === -32602
RED:    test_classify_unknown_tool_returns_protocol_method_not_found_minus_32601() — code === -32601
RED:    test_classify_unexpected_error_returns_protocol_internal_error_minus_32603_no_stack_leak() — code -32603, no stack in data
GREEN:  Implement classifier
REFACTOR: None expected
VERIFY: npm test -- src/agent-tools/__tests__/error-classifier.test.ts
```

#### Acceptance Criteria
- [ ] All 7 classification cases handled
- [ ] No stack trace leaked in unknown-error path
- [ ] Domain errors all sourced from `src/core/errors.ts` (DIP boundary respected)
- [ ] Pass: complexity — classifier cyclomatic ≤ 10
- [ ] Pass: coverage — 100% (critical path)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — ≤ 500 LoC (expected ~150)

#### DoD
- [ ] T4.1 tasks complete
- [ ] `npm test -- src/agent-tools/__tests__/error-classifier.test.ts` green
- [ ] `npm run typecheck` zero errors

---

## Phase 5: Tool dispatch (wire 4 verbs end-to-end)

**Objective:** Implement 4 dispatch handlers calling `memoryFromCtx(getScope(), memory).{remember|recall|forget|reflect}`. Wire SDK `tools/call` request handler. Per ADRs D3 + D6.

### T5.1 — 4 dispatch handlers

#### Objective
One handler per verb. Each: (1) zod-validates `params.arguments` at boundary; (2) resolves scope via `getScope() + memoryFromCtx`; (3) calls underlying Memory method; (4) returns content blocks or routes errors via `classifyError`.

#### Evidence
ADR D3 (scope binding) + D6 (error shapes) + D2 (zod boundary validation). Q7 § Calling Tools shape for response.

#### Files to edit
```
src/agent-tools/tools/remember-handler.ts (NEW)
src/agent-tools/tools/recall-handler.ts (NEW)
src/agent-tools/tools/forget-handler.ts (NEW)
src/agent-tools/tools/reflect-handler.ts (NEW)
src/agent-tools/tools/__tests__/handlers.test.ts (NEW) — assert all 4 via mocked Memory
src/agent-tools/tools/dispatch.ts (NEW) — central dispatch: name → handler
src/agent-tools/server.ts — wire CallToolRequestSchema handler (after T1.1)
```

#### Deep file dependency analysis
- Each handler imports its schema (T2.1) + `getScope` (T3.1) + `memoryFromCtx` from `src/theokit/index.js` + `classifyError` (T4.1).
- `dispatch.ts` is a Map<TOOL_NAME, handler> lookup.
- `server.ts` registers a single `setRequestHandler(CallToolRequestSchema, (req) => dispatch(req.params.name, req.params.arguments))`.

#### Deep Dives
- **Handler signature**: `async (args: unknown, deps: {memoryFactory: () => Memory}) => CallToolResult` where `CallToolResult = {content: ContentBlock[], isError?: boolean, structuredContent?: object}`.
- **Per-handler flow** (remember example):
  ```ts
  const parsed = REMEMBER_SCHEMA.safeParse(args);
  if (!parsed.success) throw parsed.error;  // bubbles to classifyError → Protocol Error -32602
  const memory = memoryFromCtx(getScope(), deps.memoryFactory());  // throws MissingScopeError if scope absent → Tool Execution Error per D6
  await memory.remember(parsed.data.content, parsed.data.metadata);
  return { content: [{type:'text', text:'Memory persisted.'}], isError: false };
  ```
- **Recall structured content**: `{ content: [{type:'text', text: JSON.stringify(results)}], structuredContent: {results}, isError: false }` per Q7 backwards-compat note.
- **Forget**: branch on `id` vs `all`; calls `memory.forget(id)` or `memory.forgetAll()` (verify v0.1 exposes the latter; if not, log followup for v0.4 — for v0.3 only `id` mode supported and `all: true` returns Tool Execution Error "bulk delete not yet supported, pending v0.4").
- **Reflect**: calls `memory.reflect()` which delegates to `ManualReflectionPolicy` per v0.0 ADR-0005. Returns text content with reflection count.

#### Tasks
1. Implement 4 handler files following the per-handler flow.
2. Implement `dispatch.ts` Map lookup; unknown name returns Protocol Error via `classifyError`.
3. Wire `setRequestHandler(CallToolRequestSchema, ...)` in `server.ts`.
4. Write unit tests with mocked `Memory` (via `mock<Memory>()` from `vitest-mock-extended`) covering:
   - Happy path each verb.
   - MissingScope rejection (no `withScope` wrapper).
   - Invalid args rejection (zod fail).
   - Unknown tool name dispatch.
   - Memory error propagation (MemoryStoreError → Tool Execution Error).

#### TDD
```
RED:    test_remember_happy_path() — call dispatch('remember', {content:'foo'}) inside withScope, assert isError:false + memory.remember called
RED:    test_recall_returns_structured_content() — call dispatch('recall', {query:'foo'}), assert structuredContent present
RED:    test_forget_id_mode() — dispatch('forget', {id:'uuid'}), assert memory.forget(uuid) called
RED:    test_forget_all_mode_returns_not_yet_supported() — dispatch('forget', {all:true}), assert isError:true with deferred-text
RED:    test_reflect_calls_memory_reflect() — dispatch('reflect', {}), assert memory.reflect called
RED:    test_dispatch_without_scope_returns_execution_error() — dispatch outside withScope, assert isError:true with MissingScope text
RED:    test_dispatch_invalid_args_returns_protocol_error() — dispatch('remember', {}), assert thrown error classifies to -32602
RED:    test_dispatch_unknown_tool_returns_method_not_found() — dispatch('xxx', {}), assert -32601
RED:    test_memory_store_error_returns_execution_error() — mock memory.remember throws MemoryStoreError, assert wire shape isError:true
GREEN:  Implement 4 handlers + dispatch + server wiring
REFACTOR: Extract common pre-validation/scope-resolution pattern into handlerHelper if rule-of-three met (likely after 3rd handler)
VERIFY: npm test -- src/agent-tools/tools/__tests__/handlers.test.ts
```

#### Acceptance Criteria
- [ ] All 4 handlers implemented + dispatch wired
- [ ] All 9 RED tests pass
- [ ] `forget all:true` honest deferral with explicit message (not silent failure)
- [ ] Pass: complexity — each handler cyclomatic ≤ 10
- [ ] Pass: coverage — 100% on handlers + dispatch (critical path)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — each handler file ≤ 500 LoC (expected ~80 each)

#### DoD
- [ ] T5.1 tasks complete
- [ ] `npm test -- src/agent-tools/tools/__tests__/handlers.test.ts` green
- [ ] `npm run typecheck` zero errors

---

## Phase 6: Transport adapters (stdio + streamable-HTTP)

**Objective:** Wire 2 transports per ADR D1. CLI entry point invokes selected transport based on `THEOMEM_MCP_TRANSPORT` env-var. Default: stdio.

### T6.1 — stdio transport + CLI entry

#### Objective
Connect `McpServer` (T1.1) to `StdioServerTransport` from SDK. Implement `cli.ts` main entry that reads env vars, constructs server, starts on stdio.

#### Evidence
ADR D1 (stdio primary). SDK Q2 ships `@modelcontextprotocol/sdk/server/stdio`. SDK Q8 reads `.theokit/mcp.json` and spawns via `command: 'npx', args: ['@usetheo/memory/agent-tools']` — bin entry must match.

#### Files to edit
```
src/agent-tools/transports/stdio.ts (NEW)
src/agent-tools/cli.ts — full implementation replacing T0.2 stub
src/agent-tools/__tests__/cli.test.ts (NEW) — unit test on main(argv) with mocked transport
src/agent-tools/index.ts — export connectStdio
package.json — add build script for cli.ts → dist/agent-tools/cli.js if not present
```

#### Deep file dependency analysis
- `stdio.ts` imports `StdioServerTransport` from SDK.
- `cli.ts` imports `createMcpServer` factory + `connectStdio`.
- Build step: if `tsc` not configured for emit-to-dist, add minimal config or use tsup/esbuild (verify v0.1 build pipeline first).

#### Deep Dives
- **Env-var reading**: `THEOMEM_PG_URI` (required for memory backend), `THEOMEM_AGENT_ID` (optional, sets default scope at server boot for single-agent stdio), `THEOMEM_MCP_TRANSPORT` (defaults to 'stdio').
- **Bootstrap shape**:
  ```ts
  export async function main(argv = process.argv.slice(2)) {
    const memoryFactory = () => createLocalMemory({ /* from env */ });
    const server = new McpServer({ name: 'themory', memoryFactory });
    const transport = new StdioServerTransport();
    // Optional: pre-bind scope from THEOMEM_AGENT_ID if set
    await server.start(transport);
    // Process stays alive until stdio closes
  }
  ```
- **Per-message scope binding** (stdio specific): stdio is single-session; bind scope ONCE from env at boot OR per-message via custom JSON-RPC notification (deferred to v0.4 for multi-tenant stdio).
- **Build step**: verify `tsconfig.json` emits to `dist/`; if not, add `"outDir": "./dist"` + `npm run build` script. v0.1's pipeline may already cover this.

#### Tasks
1. Verify v0.1 build pipeline emits `dist/`; add if missing.
2. Implement `src/agent-tools/transports/stdio.ts` — thin wrapper exporting `connectStdio(server)`.
3. Implement `cli.ts` full main function.
4. Write unit test for `main()` with mocked StdioTransport + mocked memoryFactory.
5. Add `prepublishOnly` script ensuring dist/cli.js exists.

#### TDD
```
RED:    test_main_bootstraps_with_env_vars() — set process.env, call main(), assert StdioServerTransport.connect called
RED:    test_main_uses_themory_pg_uri_for_memory_factory() — assert createLocalMemory invoked with parsed URI
RED:    test_cli_exits_cleanly_on_sigterm() — send SIGTERM, assert server.stop called within 5s
GREEN:  Implement stdio.ts + cli.ts + verify build pipeline
REFACTOR: None expected
VERIFY: npm test -- src/agent-tools/__tests__/cli.test.ts
```

#### Acceptance Criteria
- [ ] CLI exits 0 on clean shutdown
- [ ] SIGTERM triggers graceful server.stop within 5s
- [ ] `npm run build` produces `dist/agent-tools/cli.js` (or equivalent path)
- [ ] Pass: complexity — cli.ts cyclomatic ≤ 10
- [ ] Pass: coverage — ≥ 90% on cli.ts (E2E covers the rest)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — cli.ts + stdio.ts each ≤ 500 LoC

#### DoD
- [ ] T6.1 tasks complete
- [ ] `npm test -- src/agent-tools/__tests__/cli.test.ts` green
- [ ] `npm run build` produces invokable dist
- [ ] `npm run typecheck` zero errors

### T6.2 — Streamable-HTTP transport

#### Objective
Add streamable-HTTP transport for HTTP-deployed scenarios (TheoCloud v0.5 alignment). Per-request scope binding via `X-Agent-Id` header (Letta convention, Q4).

#### Evidence
ADR D1 (streamable-HTTP secondary). SDK ships `@modelcontextprotocol/sdk/server/streamableHttp`. Letta + Mem0 both use `X-Agent-Id` header.

#### Files to edit
```
src/agent-tools/transports/streamable-http.ts (NEW)
src/agent-tools/__tests__/streamable-http.test.ts (NEW)
src/agent-tools/cli.ts — extend to branch on THEOMEM_MCP_TRANSPORT='streamable-http'
```

#### Deep file dependency analysis
- Imports `StreamableHTTPServerTransport` from SDK.
- Imports `withScope` + `getScope` from `src/agent-tools/scope.ts` (T3.1).
- Per-request middleware extracts `X-Agent-Id` header → constructs `ScopedContext` → wraps dispatch in `withScope`.

#### Deep Dives
- **Stateless mode**: per Mem0 line 546 (Q5), run with `stateless: true` for simpler scaling. v0.3 doesn't need session persistence across requests.
- **Header → ctx parsing**: extract `X-Agent-Id` (or fallback to `Authorization` bearer parsed for `THEOKIT_API_KEY` per v0.0 ADR-0009). Builds `{session: {agentId: header}}` ctx.
- **Typed error remapping** (Letta `streamable_http_client.py:61-81` Q4 pattern adapted to server side): catch transport-level exceptions, return typed HTTP responses (5xx for server, 4xx for client).
- **Port + host**: read from `THEOMEM_MCP_HTTP_PORT` (default 8080) and `THEOMEM_MCP_HTTP_HOST` (default 127.0.0.1).

#### Tasks
1. Implement `streamable-http.ts` with `connectStreamableHttp(server, {port, host})`.
2. Middleware extracts scope from headers; wraps dispatch in `withScope`.
3. Extend `cli.ts` branch to select transport.
4. Unit tests using node `http` module + mock requests.

#### TDD
```
RED:    test_http_request_with_x_agent_id_binds_scope() — POST tools/call, assert dispatch sees scope.session.agentId
RED:    test_http_request_without_x_agent_id_returns_execution_error() — POST tools/call, assert MissingScope wire shape
RED:    test_http_runs_stateless_no_session_persistence() — 2 sequential requests with different agentIds; assert no cross-contamination
RED:    test_http_listens_on_configured_port() — boot on port 8081, assert listening
GREEN:  Implement streamable-http transport
REFACTOR: Extract common scope-binding-from-headers helper if applicable
VERIFY: npm test -- src/agent-tools/__tests__/streamable-http.test.ts
```

#### Acceptance Criteria
- [ ] HTTP server boots on configured port
- [ ] `X-Agent-Id` header binds scope per-request
- [ ] Cross-request isolation verified
- [ ] Pass: complexity — streamable-http.ts cyclomatic ≤ 10
- [ ] Pass: coverage — ≥ 90% (critical path: 100% on scope-binding middleware)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — ≤ 500 LoC

#### DoD
- [ ] T6.2 tasks complete
- [ ] `npm test -- src/agent-tools/__tests__/streamable-http.test.ts` green
- [ ] `npm run typecheck` zero errors

---

## Phase 7: E2E tests + documentation

**Objective:** E2E round-trip test (the Goal metric) + README + canonical `.theokit/mcp.json` snippet + CHANGELOG update.

### T7.1 — E2E round-trip + scope isolation test (THE GOAL METRIC)

#### Objective
Spawn the built CLI as stdio subprocess via `child_process.spawn`. Send `initialize` + `tools/list` + `tools/call` for each verb. Assert exact wire shapes per Q7. Verify zero cross-userId overlap by paired calls with different scopes.

#### Evidence
This IS the Goal metric. Mirror v0.2 PR-A's THE GOAL test pattern (`tests/integration/theokit-binding.test.ts` § "two distinct userIds produce disjoint recall result sets (ZERO overlap)") extended through MCP boundary.

#### Files to edit
```
tests/e2e/agent-tools/round-trip.test.ts (NEW) — THE GOAL TEST
tests/e2e/agent-tools/fixtures/mock-mcp-client.ts (NEW) — F-mcp-e2e-fixture from blueprint
tests/e2e/agent-tools/example-mcp-config.json (NEW) — canonical .theokit/mcp.json shape
```

#### Deep file dependency analysis
- E2E imports `child_process.spawn` from `node:child_process`.
- Mock client sends JSON-RPC messages over subprocess stdin; parses responses from stdout (line-delimited JSON per stdio spec).
- Requires `THEOMEM_PG_URI` env var (skip with hard fail if CI=true per v0.1 EC-17 pattern).

#### Deep Dives
- **Mock client helper shape**:
  ```ts
  class MockMcpClient {
    constructor(private cmd: string, private args: string[]) {}
    async send(method: string, params?: object, id = nextId()): Promise<RpcResponse> { /* spawn, write, read line, parse */ }
    async close(): Promise<void> { /* SIGTERM + wait */ }
  }
  ```
- **THE GOAL test outline**:
  ```
  Given: stdio subprocess spawned via npx
  When: send initialize handshake → assert capabilities.tools.listChanged: false
  When: send tools/list → assert exactly 4 tools, names match locked verbs
  When: bind scope alice via env var THEOMEM_AGENT_ID=alice; send tools/call remember 'alice secret about coffee'
  When: respawn with THEOMEM_AGENT_ID=bob; send tools/call remember 'bob secret about coffee'
  When: respawn with THEOMEM_AGENT_ID=alice; send tools/call recall 'secret'
  Then: alice recall returns ONLY alice's memories (zero overlap with bob)
  Cleanup: SIGTERM all subprocesses; truncate DB
  ```
- **Subprocess cleanup discipline** (Letta `test_mcp.py:266-270` Q1 adapted): try/finally ensures all spawned subprocesses terminate cleanly to prevent test-leak.
- **Timeout**: 30s matches v0.2 integration tests.

#### Tasks
1. Implement `MockMcpClient` helper.
2. Write THE GOAL test (round-trip + isolation).
3. Write 4 per-verb happy-path tests (remember/recall/forget/reflect via subprocess).
4. Write error-path test: invalid tools/call args → assert `error.code === -32602`.
5. Write example `.theokit/mcp.json` snippet committed as fixture.

#### TDD
```
RED:    test_e2e_initialize_handshake_succeeds() — capabilities response shape per Q7
RED:    test_e2e_tools_list_returns_4_locked_verbs() — names + count
RED:    test_e2e_remember_then_recall_round_trip() — single-scope happy path
RED:    test_e2e_alice_bob_zero_overlap_THE_GOAL() — see outline above
RED:    test_e2e_invalid_args_returns_protocol_error_minus_32602() — wire shape per Q7 § Error Handling
RED:    test_e2e_subprocess_cleanup_on_sigterm() — assert no zombie processes after suite
GREEN:  Implement MockMcpClient + 6 E2E tests + ensure dist builds before tests
REFACTOR: Extract common spawn/wait helper if rule-of-three met across tests
VERIFY: npm test -- tests/e2e/agent-tools/round-trip.test.ts
```

#### Acceptance Criteria
- [ ] All 6 E2E tests pass against real pgvector container
- [ ] THE GOAL TEST passes (zero overlap between alice + bob)
- [ ] Subprocess cleanup verified (no zombie processes)
- [ ] E2E suite runs in < 30s
- [ ] Pass: complexity — MockMcpClient cyclomatic ≤ 10
- [ ] Pass: coverage — n/a for E2E (covers prod paths from above)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — each test file ≤ 500 LoC

#### DoD
- [ ] T7.1 tasks complete
- [ ] `npm test -- tests/e2e/agent-tools/round-trip.test.ts` green
- [ ] THE GOAL METRIC achieved (test passes verifiably)
- [ ] `npm run typecheck` zero errors

### T7.2 — README + CHANGELOG + canonical install snippet

#### Objective
Document the new subpath + CLI + `.theokit/mcp.json` install shape. Update CHANGELOG under `[Unreleased]` per Inquebrável Rule 6.

#### Evidence
ADR D4 mandates README must include canonical install snippet. CLAUDE.md Inquebrável Rule 6 requires CHANGELOG entries per change.

#### Files to edit
```
README.md — new "## Agent loops via MCP" section with .theokit/mcp.json example + npx command
CHANGELOG.md — add [Unreleased] Added entry (file may not exist yet — create per Inquebrável Rule 6 if absent)
```

#### Deep file dependency analysis
- README has existing sections per v0.2 PR-A merge. Add new section after "How it works" but before "Roadmap".
- CHANGELOG: if file does not exist, create with full Keep-a-Changelog structure per Inquebrável Rule 6.

#### Deep Dives
- **README section content**: copy the canonical snippet from blueprint Q8:
  ```json
  {
    "servers": {
      "themory": {
        "command": "npx",
        "args": ["@usetheo/memory/agent-tools"],
        "env": { "THEOMEM_PG_URI": "postgres://...", "THEOMEM_AGENT_ID": "alice" }
      }
    }
  }
  ```
- **README discipline**: keep STATUS section honest — v0.3 ships agent-tools, but mark "consumer must install via clone or path-local until first npm publish per ADR D7" (since publish is post-v0.2-PR-B).

#### Tasks
1. Add README section after "How it works" with subpath + bin entry docs + `.theokit/mcp.json` snippet.
2. Update STATUS section line if applicable.
3. Update CHANGELOG (or create) with Added entries for v0.3.

#### TDD
```
RED:    test_readme_contains_canonical_mcp_json_snippet() — grep readme for "themory" key + "npx @usetheo/memory/agent-tools"
RED:    test_changelog_unreleased_added_section_mentions_v03() — grep changelog under [Unreleased] for "v0.3" or "agent-tools"
GREEN:  Edit README + CHANGELOG
REFACTOR: None expected
VERIFY: npm test -- tests/integration/docs.test.ts (if pattern from v0.2 exists; else manual review)
```

#### Acceptance Criteria
- [ ] README documents subpath + CLI + canonical `.theokit/mcp.json`
- [ ] CHANGELOG entry under `[Unreleased]` mentions v0.3 + agent-tools
- [ ] STATUS section honest about install path
- [ ] Pass: lint — zero warnings on markdown
- [ ] Pass: size — README ≤ ... (no hard cap on docs)

#### DoD
- [ ] T7.2 tasks complete
- [ ] Doc tests green (if applicable)
- [ ] Manual review confirms accuracy

---

## Coverage Matrix

Maps blueprint recommendations + ADRs to plan tasks. Per cycle-plan.md § Quality Rules item 10 (100% coverage).

| # | Gap / Requirement (source) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Blueprint Rec #1 — Adopt MCP SDK + zod-to-json-schema; bump zod ^3.24→^3.25 | T0.1 | Phase 0 setup with deps audit gate |
| 2 | Blueprint Rec #2 — Ship stdio first; streamable-HTTP for v0.5; skip SSE + fastmcp | T6.1 + T6.2 | Phase 6 two transports per D1 |
| 3 | Blueprint Rec #3 — Reuse v0.2 memoryFromCtx via AsyncLocalStorage | T3.1 + T5.1 | Phase 3 scope binding + Phase 5 dispatch reuses memoryFromCtx |
| 4 | Blueprint Rec #4 — Author 4 zod schemas; no action collapsing; recall has outputSchema; listChanged: false | T2.1 + T2.2 + T1.1 | Phase 2 schemas + T1.1 capability declaration |
| 5 | Blueprint Rec #5 — 3-tier test pyramid (pure unit + mocks + E2E stdio subprocess) | T2.1, T3.1, T4.1, T5.1 (unit + mocks) + T7.1 (E2E) | Tests distributed per phase per D5 |
| 6 | Blueprint Rec #6 — TWO error mechanisms per spec | T4.1 (classifier) + T5.1 (dispatch routing) + T7.1 (E2E error-path test) | Phases 4 + 5 + E2E coverage |
| 7 | Blueprint Rec #7 — Zero SDK code changes; subpath + bin only | T0.2 (subpath + bin) + T7.2 (canonical .theokit/mcp.json README) | D8 surface + doc |
| 8 | Blueprint Rec #8 — Honest scope; no reflect scheduler / skill library / asOf | T5.1 reflect handler (calls ManualReflectionPolicy synchronously) + T7.1 explicit out-of-scope note | Honest deferral; no extra tasks |
| 9 | Blueprint ADR D1 — Transport selection | T6.1 + T6.2 | (See #2) |
| 10 | Blueprint ADR D2 — Schema + 4-tool split | T2.1 + T2.2 | (See #4) |
| 11 | Blueprint ADR D3 — AsyncLocalStorage scope binding | T3.1 | (See #3) |
| 12 | Blueprint ADR D4 — SDK integration via existing MCP client | T0.2 (subpath + bin only) + T7.2 (docs) | (See #7) |
| 13 | Blueprint ADR D5 — Test pyramid | All Phase 2-7 tests | (See #5) |
| 14 | Blueprint ADR D6 — TWO error mechanisms | T4.1 + T5.1 + T7.1 error-path | (See #6) |
| 15 | Plan ADR D7 — Deps audit absorption (run /deps-audit between /edge-case-plan and /plan-confidence) | T0.1 (deps audit gate) | Cycle-plan v1.1 § Chain |
| 16 | Plan ADR D8 — Package surface (subpath + bin + bundle isolation) | T0.2 | Tripwire test + bin entry |
| 17 | CLAUDE.md Roadmap Item 4 acceptance — "MCP server boots; tools/list returns exactly 4 tools with stable names" | T1.1 (boot) + T2.2 (tools/list shape) + T7.1 (E2E verification) | Goal metric |
| 18 | CLAUDE.md Roadmap Item 4 acceptance — "End-to-end via @usetheo/sdk agent: each verb invoked successfully" | T7.1 (full E2E round-trip) | Goal metric |
| 19 | CLAUDE.md Roadmap Item 4 acceptance — "Schema validation rejects malformed payloads with structured error" | T2.1 (schemas) + T4.1 (classifier) + T7.1 (E2E error test) | (See #6 + #4) |
| 20 | CLAUDE.md Roadmap Item 4 acceptance — "JSON-RPC trace test confirms no cross-tool state leakage" | T3.1 (scope isolation tests) + T7.1 (THE GOAL TEST alice/bob zero overlap) | (See #3 + #5) |
| 21 | architecture.md § 3 — DIP boundary src/agent-tools/ → src/core/ only | All phases (compliance per task acceptance) + tripwire test in T0.2 | Enforced |
| 22 | architecture.md § 6 — Naming conventions (kebab-case files, etc.) | All phases (lint enforcement) | Enforced by lint gate |
| 23 | architecture.md § 9 — Public API surface (subpath + tripwire) | T0.2 | Tripwire test |
| 24 | testing.md § Pyramid — 3 tiers | All tests T2-T7 | (See #5) |
| 25 | dogfood-golden-rule.md — Do not claim production until v1.0 + dogfood | T7.2 README STATUS section honest | "Pre-release" preserved |

**Coverage: 25/25 (100%)** — every blueprint recommendation, blueprint ADR, plan ADR, CLAUDE.md acceptance criterion, and applicable architecture/testing/dogfood rule mapped to at least one task.

## Global Definition of Done

- [ ] All phases (0-7) completed
- [ ] All tests passing — `npm test` green (unit + integration + e2e)
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] Coverage ≥ 90% on changed files; 100% on critical paths (schemas, dispatch, scope, error-classifier, list-handler) per `testing.md`
- [ ] File-size budget respected (per `architecture.md § Module hygiene` 500 LoC guideline)
- [ ] CHANGELOG.md updated under `[Unreleased]` per Inquebrável Rule 6
- [ ] Backward compatibility preserved across public API (v0.1 + v0.2 PR-A tests still green)
- [ ] DIP boundaries respected (`src/agent-tools/` imports only from `src/core/` and `src/theokit/`) — verified by `.claude/hooks/boundary-check.sh`
- [ ] Tripwire test verifies main barrel does NOT leak agent-tools symbols (per ADR D8)
- [ ] **Runtime-metric proof — THE GOAL TEST passes**: `tests/e2e/agent-tools/round-trip.test.ts` test "alice/bob zero overlap" observed verifiably (not just compiled) in integration workload against real pgvector container.
- [ ] `/deps-audit v0-3-agent-tools-mcp` returns PASS or PASS_WITH_CAVEATS (per cycle-plan v1.1 § Chain — between `/edge-case-plan` and `/plan-confidence`)
- [ ] `/plan-confidence v0-3-agent-tools-mcp` returns verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] `/review v0-3-agent-tools-mcp` returns READY_TO_MERGE before final merge
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND PR merged to `main`, move `.claude/knowledge-base/plans/v0-3-agent-tools-mcp-plan.md` to `.claude/knowledge-base/plans/completed/`. NEVER move before merge.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER all Phase 0-7 tasks complete. The plan is NOT done until this chain passes.

**Objective:** Validate the implemented MCP server works in a real workload — not just isolated unit tests.

### Execution

```bash
npm test                        # unit + integration + e2e tests
npm run test:coverage           # coverage report (≥ 90% on changed files)
npm run typecheck               # zero TS errors
npm run lint                    # zero lint warnings
npm run build                   # produces dist/agent-tools/cli.js for bin entry
THEOMEM_PG_URI=postgres://... npm test -- tests/e2e/agent-tools/round-trip.test.ts
```

Manual smoke (after build):

```bash
# Spawn the server manually
THEOMEM_PG_URI=postgres://... THEOMEM_AGENT_ID=smoke-test \
  node dist/agent-tools/cli.js < /dev/null &
# Send initialize via JSON-RPC stdin and verify response
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' | \
  THEOMEM_PG_URI=... node dist/agent-tools/cli.js
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration + e2e)
- [ ] Coverage ≥ 90% on changed files; 100% on critical paths
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] `npm run build` produces invokable `dist/agent-tools/cli.js`
- [ ] **THE GOAL METRIC observed**: `tests/e2e/agent-tools/round-trip.test.ts` THE GOAL TEST passes (alice/bob zero overlap verified at runtime)
- [ ] Manual smoke: stdio subprocess responds to JSON-RPC initialize handshake
- [ ] v0.1 + v0.2 PR-A test suites still green (backward compat)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run validation chain to confirm fixes
4. Pre-existing issues logged in PR description; do NOT block plan completion
