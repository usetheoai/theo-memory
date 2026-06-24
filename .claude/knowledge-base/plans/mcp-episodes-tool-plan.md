---
slug: mcp-episodes-tool
milestone_id: G3-MCP
created_at: 2026-06-23
goal: Make the already-shipped first-class episodic tier (v0.14.0, SDK + REST) first-class on the MCP surface too — add a native `episodes` MCP tool that reuses the EXISTING ScopedMemory.episodes() via the same getScope()+memoryFromCtx() binding as recall, so an agent/MCP client (the primary TheMemory consumer + dogfood anchor) can list a scope's cursor-paginated, bi-temporal episodic log, measured by handler unit tests (happy paths + cursor/asOf/queryText passthrough + error paths) GREEN and the tools/list sentinel updated 7→8 with `episodes` registered — no change to ScopedMemory.episodes(), no schema/migration, no themory core change.
---

# Plan: mcp-episodes-tool (G3 — MCP surface completion)

> The first-class episodic read surface (gap G3) was SHIPPED in v0.14.0 on the **SDK** (`ScopedMemory.episodes()`) and **REST** (`GET /v1/scopes/:type/:id/episodes`) — but NOT on **MCP**. The MCP server (`packages/mcp`) exposes `remember`/`recall`/`forget`/`reflect` + 3 skill tools, with NO episodes tool (confirmed: zero `episode` references in `packages/mcp/src`). Agents/MCP clients are the primary TheMemory consumer (the `/dogfood` anchor "Claude Code auto-memory backed by TheMemory" + OpenMemory-wired clients) — so the episodic tier is not truly "first-class for the consumer" until it is reachable over MCP. This plan adds a native `episodes` MCP tool that REUSES the shipped `ScopedMemory.episodes()` (zero rework of the read surface). It is the MCP twin of the already-shipped SDK/REST surface, exactly as M3 was the SDK twin of the dashboard BFF route.

## Goal

> "Add a native `episodes` MCP tool (`packages/mcp/src/tools/episodes-{schema,handler}.ts`) registered in `dispatch.ts` + `list-handler.ts`, that resolves scope via the SAME `getScope()` + `memoryFromCtx()` binding as `recall` and delegates to the EXISTING `ScopedMemory.episodes(options)`, returning a cursor-paginated episodic page (items + `nextCursor`) — measured by `packages/mcp/src/tools/episodes.test.ts` (happy paths: empty options, `limit`/`order`/`queryText`/`asOf`/`after` passthrough; error paths: missing-scope, malformed cursor) GREEN, the `tools/list` sentinel updated 7→8 with `episodes` present + name spec-valid, with `ScopedMemory.episodes()` + `episode.ts` + the REST/SDK surface byte-unchanged."

## Context

Discover (2026-06-23, two Explore sweeps) established the ground truth:
- **G3 read surface SHIPPED v0.14.0** — `ScopedMemory.episodes(options?: EpisodeListOptions): Promise<EpisodePage>` (`memory-store.ts:110`), `VectorStore.listEpisodes` (pgvector + in-memory), REST handler + route + OpenAPI, 9 integration tests. Re-implementing ANY of this is forbidden re-work.
- **The genuine gap:** no MCP tool for episodes (`packages/mcp/src` has zero `episode`). The MCP dispatch (`dispatch.ts:27-37`) + tools/list (`list-handler.ts:64-107`) register 7 tools; episodes is absent.
- **The pattern to mirror is `recall`** — a scope-bound, structured-output tool: `recall-schema.ts` (zod INPUT + OUTPUT + TOOL_NAME + DESCRIPTION) + `recall-handler.ts` (`memoryFromCtx(getScope(), deps.memoryFactory())` → `scoped.recall(...)` → `toWireResult` mapping Date→ISO + `structuredContent`).

This is the MCP-surface twin of an already-shipped capability — surface exposure, not a new memory capability (mirrors M3 skills-cross-repo SDK symmetry).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha) | Why it exists | Invariant to preserve |
|---|---|---|---|---|
| `packages/mcp/src/tools/episodes-schema.ts` (NEW) | 0 | — | zod INPUT + OUTPUT schemas + `TOOL_NAME='episodes'` + DESCRIPTION | mirrors `recall-schema.ts` shape |
| `packages/mcp/src/tools/episodes-handler.ts` (NEW) | 0 | — | dispatch handler: `getScope()`+`memoryFromCtx()` → `scoped.episodes(options)` → wire | mirrors `recall-handler.ts`; calls the SHIPPED `episodes()` unchanged |
| `packages/mcp/src/tools/dispatch.ts` | 66 | (existing) | tool-name → handler Map (`:27-37`) | existing 7 entries UNCHANGED; ADD `[EPISODES, episodesHandler]` |
| `packages/mcp/src/tools/list-handler.ts` | 107 | (existing) | `buildToolsListResponse()` (`:64-107`) — 7 tools | existing 7 UNCHANGED; ADD episodes (with outputSchema, like recall) |
| `packages/mcp/src/tools/list-handler.test.ts` | 77 | (existing) | sentinel: tool count + names (`:23,36-44`) | UPDATE 7→8 + add `'episodes'` to the names array |
| `packages/mcp/src/tools/schemas.test.ts` | 95+ | (existing) | per-tool name-spec regex (`:89-93`) | ADD `EPISODES_TOOL_NAME` to the regex assertion |
| `packages/mcp/src/tools/episodes.test.ts` (NEW) | 0 | — | handler happy + error paths (mirror `handlers.test.ts`) | dispatch via `withScope` + mocked `ScopedMemory.episodes` |
| `tests/e2e/agent-tools/round-trip.test.ts` | ~140 | (existing) | CLI subprocess `tools/list` over real stdio; asserts names (`:132`) | IF the assertion is reachable, update to include `episodes` (see Drawback #2) |
| `packages/core/src/domain/episode.ts` | 232 | (existing) | `EpisodeListOptions`/`EpisodePage`/`EpisodeCursor` + cursor codec | READ-ONLY (reuse exported types) |
| `packages/core/src/domain/memory-store.ts` | (existing) | — | `ScopedMemory.episodes()` (`:110`) | READ-ONLY (the method I call) |
| `CHANGELOG.md` | (existing) | — | Inquebrável Rule 6 | one `Added` entry |

### Current callers / dependents

- **`ScopedMemory.episodes(options?)`** (`memory-store.ts:110`) — SHIPPED v0.14.0; consumed by SDK + the REST `episodesHandler`. The new MCP handler is a THIRD caller. UNCHANGED.
- **`memoryFromCtx(getScope(), memory)`** (`@usetheo/memory/theokit` + `@usetheo/memory-agent-core`) — the scope-resolution used by every scoped MCP tool (`recall-handler.ts:39`). Resolves `{ session: { userId } }` (set by the MCP server's `withScope` at request boundary) → `memory.user(userId)`. REUSED verbatim.
- **`dispatch`** (`dispatch.ts:45`) — wraps handler in try/catch + `classifyError` (protocol thrown as `McpError`; execution returned as `isError:true`). A malformed cursor → `InvalidScope` thrown by `episodes()` → classified. UNCHANGED (the new entry rides the existing machinery).
- **`buildToolsListResponse`** (`list-handler.ts:64`) — emits the `tools/list` payload; the new tool is appended.

### Domain glossary

- **episode (MCP)** — a scope's memories as a cursor-paginated, bi-temporal temporal log, surfaced as an MCP tool. NOT semantic (that's `recall`); NOT a new storage kind (a read projection of `memories`).
- **scope binding** — the MCP server sets `withScope({ session: { userId } })` at the request boundary (from `_meta` user_id or env); `getScope()` reads it inside the handler. The `episodes` tool operates on that scope's memories — no `scope` arg in the tool input (same as `recall`).
- **opaque cursor** — `after`/`before` are base64url `(created_at|id)` strings the consumer echoes back from a prior `nextCursor`; decoded inside `episodes()` (throws `InvalidScope` if malformed).

### Architecture boundaries affected

- **No DIP/layer/runtime boundary crossed.** The change is two new files in the MCP adapter (`packages/mcp/src/tools`) + two registration edits + tests. NO change to `@usetheo/memory` core (`ScopedMemory.episodes()`, `episode.ts`, `VectorStore.listEpisodes`), NO schema/migration, NO REST/SDK change, NO new dependency.
- **MCP tool-surface boundary:** the native MCP toolset grows 7→8. The OpenMemory compat toolset is NOT touched (native-only — OpenMemory's `list_memories` is unordered full-fetch with no cursor pagination; no analogue; adding episodes there would break the "same 4 wire names" interop contract).
- **Locked-names boundary:** `episodes` is an MCP TOOL name, NOT a CLI verb — the CLI locked-names sentinel (`cli-locked-names.test.ts`, 4 verbs) is NOT touched. The MCP tool name is new surface (pre-release, additive).

## Prior Art & Related Work

- **In-repo twin:** `recall` (scope-bound, structured-output MCP tool) is the exact shape — `recall-schema.ts` + `recall-handler.ts` + its dispatch/list registration. This plan mirrors it for episodes.
- **In-repo precedent for "surface twin of a shipped capability":** M3 (`skills-cross-repo-sdk-symmetry`) added the SDK route for an already-shipped BFF capability; this plan adds the MCP tool for an already-shipped SDK/REST capability. Same discipline (reuse the handler/method, add the surface).
- **The shipped G3 work:** `first-class-episodes-plan.md` + `first-class-episodes-review-2026-06-22.md` (v0.14.0) — the read surface this tool exposes. The MCP exposure was explicitly noted as future work in that cycle's investigation.
- **External shape:** Letta exposes the message/event log as a first-class paginated tier its agent loop reads; an MCP `episodes` tool brings TheMemory to parity for MCP-driven agents.

## Dependencies

(none — zero new runtime or dev dependencies. Reuses `zod` (existing), `@modelcontextprotocol/sdk` (existing), `@usetheo/memory/contract` + `/theokit` + `@usetheo/memory-agent-core` (existing workspace deps). The episode types + cursor codec are already exported from `@usetheo/memory/contract`.)

## ADRs

### D1 — Native MCP tool reusing `ScopedMemory.episodes()`, NOT a new core method

- **Decision:** add `episodes-schema.ts` + `episodes-handler.ts` that call the SHIPPED `ScopedMemory.episodes(options)`; no change to the core method, episode types, or stores.
- **Rationale:** the read surface is shipped + tested (v0.14.0); the only gap is MCP exposure. Reusing the method is KISS + DRY + honors "SEM RE-TRABALHO". Mirrors `recall-handler` delegating to `scoped.recall`.
- **Alternatives rejected:** (a) a new episodes core path — re-work of shipped code; (b) widening `recall` to do temporal listing — conflates semantic + temporal (the shipped design deliberately separated them, ADR D4 of first-class-episodes).

### D2 — Scope from `getScope()` (session binding), NO `scope`/`userId` tool-input arg

- **Decision:** resolve scope via `memoryFromCtx(getScope(), ...)` exactly like `recall`; the tool input carries only episode options (after/before/limit/order/queryText/asOf), never a scope/subject arg.
- **Rationale:** the MCP server binds scope at the request boundary (`withScope`, from `_meta` user_id / env); a scope arg in the input would be an anti-spoof hole (mirrors the M3 bare-subject anti-spoof discipline) + diverges from every other scoped tool. Missing scope → `MissingScopeError` (the existing guard).
- **Alternatives rejected:** a `scope` input arg — inconsistent with recall/remember/forget; security smell (caller-supplied scope).

### D3 — Ship `outputSchema` + `structuredContent` (like `recall`), wire-marshal MemoryItem

- **Decision:** the tool ships an `OUTPUT_SCHEMA` and returns `structuredContent: { items, nextCursor }`; each item is the LLM-visible subset of `MemoryItem` (id, text, scope, `createdAt` as ISO string, metadata) — dropping `hash`/`updatedAt`/`tValid`/`tInvalid`/`attributedTo` (same honest subset as `recall`'s `toWireResult`, minus `score`).
- **Rationale:** episodes returns structured paginated data; `recall` is the precedent for an MCP tool with `outputSchema` + `structuredContent`. The dropped fields match recall's documented rationale (internal/bi-temporal/ADD-only).
- **Alternatives rejected:** text-only content (no structuredContent) — loses machine-readable pagination (the `nextCursor` an agent needs to page); exposing all MemoryItem fields — leaks internal `hash`/bi-temporal columns (recall's precedent drops them).

### D4 — `after`+`before` mutual exclusion at the zod boundary (mirror REST EC-4)

- **Decision:** the INPUT_SCHEMA `.refine()`s that `after` and `before` are not both present → zod failure → Protocol Error -32602.
- **Rationale:** the REST handler 422s on both (EC-4 of first-class-episodes); MCP parity + fail-fast at the boundary. `asOf` accepted as an ISO `datetime` string (transformed/parsed to `Date` for the core option), invalid → zod/Date guard → -32602 (mirrors REST NaN→422).
- **Alternatives rejected:** silently ignoring one — divergence from REST + ambiguous semantics.

## Dependency Graph

```
T1.1 (RED: episodes.test.ts — handler happy+error, dispatch-level) ─┐
T1.2 (RED: list-handler + schemas sentinels updated to expect episodes) ─┤
       ↓ both precede
T2.1 (GREEN: episodes-schema.ts + episodes-handler.ts)
       ↓ precedes
T2.2 (GREEN: register in dispatch.ts + list-handler.ts)
       ↓ precedes
T3.1 (build + full mcp/core/api suites green + round-trip sentinel reconciled + CHANGELOG)
```

Sequential TDD; T1.1/T1.2 are the RED tests written first.

## Phase 1 — RED: failing tests pin the contract

### T1.1 — RED: episodes handler dispatch tests

#### Why this step
**Action:** create `packages/mcp/src/tools/episodes.test.ts` mirroring `handlers.test.ts`: dispatch `'episodes'` via `withScope(ALICE_CTX, () => dispatch('episodes', args, { memoryFactory }))` against a mocked `ScopedMemory.episodes`. Cover: (a) empty `{}` → `episodes(undefined)` called, `structuredContent.items` returned; (b) `{limit, order, queryText}` passthrough; (c) `{asOf: ISO}` → `episodes({asOf: Date})`; (d) `{after: cursor}` passthrough; (e) missing scope (no `withScope`) → `isError:true` (MissingScopeError → execution error); (f) malformed cursor → the error path the shipped `episodes()`/decode produces (assert the dispatch classification, not a fabricated code).
**Reasoning:** TDD RED — before the handler exists, `dispatch('episodes', ...)` throws `UnknownToolError` (tool not registered) → tests fail. They pin the delegation contract (args forwarded verbatim to the shipped method) + the wire shape.

#### Files to edit
- `packages/mcp/src/tools/episodes.test.ts` (NEW)

#### TDD
- `it('dispatches episodes with no options → scoped.episodes(undefined|{}), returns items')`
- **EC-1 (MUST FIX): `it('emits page.nextCursor into structuredContent.nextCursor')`** — mock `episodes` → `{ items:[item], nextCursor:'abc' }`; assert `result.structuredContent.nextCursor === 'abc'` AND `items` present. Without this, MCP pagination is dead (the whole point of an episodic log is iterating it). Omit the key (not `null`) when `nextCursor` is undefined.
- **EC-2 (omit-absent-options): `it('omits absent options — episodes({}) not episodes({queryText:"",order:undefined})')`** — input `{}` → `scoped.episodes` called with `undefined` OR an object with ONLY present keys (build options conditionally, mirror recall's `parsed.x ? {...} : {}`); never forward `queryText:''` (would become `ILIKE '%%'`).
- `it('forwards limit/order/queryText to scoped.episodes')`
- `it('parses asOf ISO string to a Date for scoped.episodes')`
- `it('forwards an opaque after-cursor to scoped.episodes')`
- **EC-3 (scope union): `it('serializes a session-scope item (kind+sessionId+userId) through OUTPUT_SCHEMA')`** — reuse recall's 3-variant SCOPE_SCHEMA; assert OUTPUT_SCHEMA `.parse()` accepts a session-scoped wired item (regression guard against dropping a union variant).
- `it('episodes outside withScope returns a Tool Execution Error (missing scope)')`
- `it('episodes with after+before both set throws McpError -32602 (mutual exclusion)')`

> **EC-4 (DOCUMENT):** a valid-but-absurd `asOf` (year 3000 / 1970) is accepted and forwarded — same as the shipped REST/SDK surface (no clamping there); the bi-temporal predicate returns whatever is valid at that instant. Only `NaN`/invalid ISO is rejected (zod `.datetime()`). No clamp — clamping would diverge the MCP surface from REST/SDK.

#### Concurrency tests
(none — single-threaded) — AsyncLocalStorage scope is per-call, asserted via withScope wrapping.

#### Acceptance criteria
- Running `npx vitest run packages/mcp/src/tools/episodes.test.ts` exits non-zero (RED) before T2 — the tool is unregistered (`UnknownToolError`) / schema absent.

#### DoD
- RED captured in the iteration log (tests fail for the right reason: tool not yet registered).

### T1.2 — RED: tools/list + name-spec sentinels expect episodes

#### Why this step
**Action:** update `list-handler.test.ts` (count 7→8; add `'episodes'` to the names array in declaration order — after `reflect`, before `add_skill`) and `schemas.test.ts` (import `EPISODES_TOOL_NAME`, assert it matches `TOOL_NAME_SPEC_REGEX`).
**Reasoning:** these sentinels lock the tool registry; updating them FIRST (RED) asserts the new tool will be registered + named spec-validly. They fail until T2.2 registers episodes.

#### Files to edit
- `packages/mcp/src/tools/list-handler.test.ts`
- `packages/mcp/src/tools/schemas.test.ts`

#### TDD
- `list-handler.test.ts`: `toHaveLength(8)` + names array includes `'episodes'` at index 4.
- `schemas.test.ts`: `expect(EPISODES_TOOL_NAME).toMatch(TOOL_NAME_SPEC_REGEX)`.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- Both sentinels FAIL before T2.2 (count is 7, no episodes name) — RED proven.

#### DoD
- RED captured.

## Phase 2 — GREEN: schema + handler + registration

### T2.1 — GREEN: episodes-schema.ts + episodes-handler.ts

#### Why this step
**Action:** create `episodes-schema.ts` (`TOOL_NAME='episodes'`, DESCRIPTION, INPUT_SCHEMA = `{ after?, before?, limit? (int 1-200), order? enum['asc','desc'], queryText? (≤ MAX_QUERY_BYTES), asOf? (ISO datetime) }` with a `.refine()` for after+before mutual exclusion (D4), OUTPUT_SCHEMA = `{ items: [{id,text,scope,createdAt,metadata}], nextCursor? }` mirroring recall's SCOPE_SCHEMA) + `episodes-handler.ts` (`INPUT_SCHEMA.parse(args)` → `memoryFromCtx(getScope(), deps.memoryFactory())` → build `EpisodeListOptions` (asOf string→Date) → `scoped.episodes(options)` → `toWireResult` Date→ISO → `structuredContent: { items, nextCursor }`).
**Reasoning:** this is the deliverable — the schema + handler that make T1.1 GREEN. Reuses the recall handler shape verbatim; the only new logic is asOf string→Date + the cursor passthrough.

#### Files to edit
- `packages/mcp/src/tools/episodes-schema.ts` (NEW)
- `packages/mcp/src/tools/episodes-handler.ts` (NEW)

#### TDD
- T1.1 tests turn GREEN once the handler is registered (T2.2).

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `episodes-schema.ts` exports `TOOL_NAME`/`DESCRIPTION`/`INPUT_SCHEMA`/`OUTPUT_SCHEMA`; `episodes-handler.ts` exports `episodesHandler` + `TOOL_NAME`; `tsc` clean.

#### DoD
- typecheck green for the new files.

### T2.2 — GREEN: register in dispatch.ts + list-handler.ts

#### Why this step
**Action:** in `dispatch.ts` import `{ episodesHandler, TOOL_NAME as EPISODES }` and add `[EPISODES, episodesHandler]` to `HANDLERS` (after REFLECT, before ADD_SKILL); in `list-handler.ts` import the episodes schema exports and append the tool entry (with `outputSchema`, after reflect, before add_skill).
**Reasoning:** wires the tool into the live MCP surface — makes T1.1 + T1.2 GREEN. Declaration order (after the 4 verbs, before skills) matches the dispatch + list convention.

#### Files to edit
- `packages/mcp/src/tools/dispatch.ts`
- `packages/mcp/src/tools/list-handler.ts`

#### TDD
- T1.1 (handler dispatch) + T1.2 (sentinels) all GREEN.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `git diff` shows exactly: 2 new files + dispatch.ts (1 import + 1 Map entry) + list-handler.ts (1 import block + 1 tool entry) + the 2 updated sentinels + the new test. No core/REST/SDK file changed.

#### DoD
- `npx vitest run packages/mcp/src/tools/` GREEN (episodes.test + list-handler.test + schemas.test + existing handlers/list tests).

## Phase 3 — Integration validation

### T3.1 — Full suites + round-trip sentinel + CHANGELOG

#### Why this step
**Action:** run the mcp + core + api test suites; reconcile the e2e `round-trip.test.ts:132` sentinel (`['remember','recall','forget','reflect']`) — VERIFY whether it is reachable (it is `THEOMEM_PG_URI`-gated / `describe.skip`); if reachable, update it to include `episodes` + the skills tools; if it is already stale vs the 7-tool reality, fix it honestly in the same commit (it must reflect the true tool list). Update CHANGELOG `Added`.
**Reasoning:** ensures no regression + the tool is consistently registered everywhere the tool list is asserted. The round-trip sentinel must not be left asserting a false tool list.

#### Files to edit
- `tests/e2e/agent-tools/round-trip.test.ts` (only if its assertion is reachable / stale)
- `CHANGELOG.md`

#### TDD
- mcp + core + api suites GREEN; round-trip sentinel consistent with the real tool list.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `npm test` (root) green for mcp+core; `packages/api` suite green; round-trip sentinel reflects the true tool list (incl. `episodes`); CHANGELOG has one `Added` entry.

#### DoD
- All suites green; `git diff --stat` = 2 new src files + 2 registration edits + ≤3 test files + CHANGELOG; no core/REST/SDK change.

## Coverage Matrix

| Goal claim / requirement | Task |
|---|---|
| `episodes-schema.ts` + `episodes-handler.ts` created (reuse `ScopedMemory.episodes`) | T2.1 |
| Registered in dispatch.ts (handler) + list-handler.ts (tools/list, with outputSchema) | T2.2 |
| Scope via getScope()+memoryFromCtx (no scope arg; missing-scope guard) | T2.1 + T1.1(e) |
| Options passthrough (limit/order/queryText/after) + asOf ISO→Date | T1.1(a-d) + T2.1 |
| after+before mutual exclusion → -32602 (REST EC-4 parity) | T1.1(f) + T2.1(D4) |
| Wire-marshal items (id/text/scope/createdAt ISO/metadata) + nextCursor | T2.1(D3) |
| `nextCursor` emitted into structuredContent (pagination not dead) — TESTED | T1.1(EC-1) |
| Absent options omitted (no `queryText:''`) — TESTED | T1.1(EC-2) |
| Session-scope union serialized faithfully — TESTED | T1.1(EC-3) |
| tools/list sentinel 7→8 + episodes name + spec-valid | T1.2 |
| round-trip e2e sentinel reconciled | T3.1 |
| No change to ScopedMemory.episodes/episode.ts/REST/SDK; no schema/migration; no new dep | ADR D1 + T2.2 (diff scope) |
| CHANGELOG Added | T3.1 |

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | `asOf` zod transform (string→Date) changes inferred input type / round-trips wrong | LOW | accept `z.string().datetime()` and convert to `Date` in the handler (explicit, like the REST handler) rather than a schema transform; a unit test asserts `episodes({asOf: Date})` was called | implementer |
| 2 | `round-trip.test.ts:132` asserts only 4 names but the real list is already 7 (pre-existing staleness) | MEDIUM | T3.1 VERIFIES reachability first; the assertion is `THEOMEM_PG_URI`-gated (`describe.skip` without it) so it likely does not run in CI — but if reachable it is ALREADY wrong (7≠4); fix it honestly to the true list incl. episodes (do NOT leave a false sentinel) | implementer |
| 3 | malformed-cursor error path: `episodes()` throws `InvalidScope` from the store/decode; the MCP classification may differ from REST 422 | LOW | the handler does not pre-decode; it lets `episodes()` throw and `dispatch`'s `classifyError` handle it; the test asserts the ACTUAL classification (execution error or protocol), not a fabricated code | implementer |
| 4 | OpenMemory compat drift (should episodes be added there too?) | LOW | NATIVE-ONLY by decision — OpenMemory `list_memories` is unordered full-fetch, no cursor analogue; adding episodes would break the 4-name interop contract; documented, not implemented | accepted |

## Unresolved Questions

(none — every decision is resolved at plan time: the read surface is shipped + its types exported; the MCP tool shape is the `recall` precedent verbatim; scope binding + error classification + sentinels are all existing machinery the new tool rides.)

## Failure scenarios

External I/O: the MCP handler calls `scoped.episodes()` which (in production) hits Postgres; the handler unit tests use a mocked `ScopedMemory` (no I/O). Scenarios:

| Dependency | Failure mode | Test reproduces? | Expected behavior |
|---|---|---|---|
| scope context | tool called outside `withScope` (no user bound) | yes (T1.1e — no withScope) | `MissingScopeError` → Tool Execution Error (`isError:true`), not a crash |
| cursor input | malformed `after`/`before` | yes (T1.1 — invalid cursor) | `episodes()` throws `InvalidScope` → dispatch `classifyError` → error result (not a 500/uncaught) |
| input shape | after+before both set | yes (T1.1f) | zod `.refine()` fail → `McpError` -32602 |
| upstream (prod) | Postgres down | n/a (unit mocks) | the same path as recall — error surfaces via dispatch classification (covered by recall's precedent) |

## Global Definition of Done

- [ ] `npx vitest run packages/mcp/src/tools/` GREEN (episodes.test + updated sentinels + existing).
- [ ] `npm run typecheck` zero errors; `npm run lint` zero warnings on touched files.
- [ ] core + api suites green (no regression); round-trip sentinel reflects the true tool list (incl. episodes).
- [ ] `git diff --stat` = 2 new src files + dispatch.ts + list-handler.ts + ≤3 test files + CHANGELOG — NO core/REST/SDK/schema/migration change.
- [ ] `CHANGELOG.md` `[Unreleased] § Added` entry.
- [ ] `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- [ ] `/review` verdict READY_TO_MERGE.

## Final Phase: Integration Validation

- `npm run build && npm run typecheck && npm run lint`
- `npx vitest run packages/mcp/src/tools/` + core + `packages/api` suites.
- Verify `git diff --stat`: no `packages/core/src/domain/episode.ts`, no `memory-store.ts`, no REST handler, no migration touched.
- The plan is NOT complete until the above pass AND `/code-quality` + `/review` are green.
