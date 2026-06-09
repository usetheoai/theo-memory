# Plan: theo-memory-standalone-p0 Fixes Cycle 2 — 3 MAJOR + 2 MINOR spec-side absorption

> **Version 1.1** (2026-06-03) — Absorbs `/edge-case-plan theo-memory-standalone-p0-fixes-cycle-2` report (6 edge cases: 1 MUST FIX + 3 SHOULD TEST + 2 DOCUMENT). **1 MUST FIX absorbed**: EC-1 (T1.4 test #8 assertion path assumes `parameters[i].schema.description` but zod-to-openapi may serialize `.describe()` to `parameters[i].description` directly — verified empirically: NO existing `.describe()` usage in `src/server/` to validate against; fallback chain `(param as { description? }).description ?? param.schema?.description` adopted). **3 SHOULD TEST absorbed inline** in TDD/acceptance blocks: EC-2 (T1.1 `vi.stubEnv('THEOMEM_MCP_TRANSPORT', '')` in beforeEach prevents test pollution); EC-3 (per-task AC checkbox: existing `openapi.test.ts` test #1 swagger-parser OpenAPI 3.1 validation still PASSES after spec addition); EC-4 (T1.1 commit message MUST contain literal `Verified RED by temporarily commenting lines 95-103` for grep-able audit trail). **2 DOCUMENT absorbed** as Dependency Graph + T1.1 JSDoc notes: EC-5 (T1.2/T1.3/T1.4 edit same file `openapi-registration.ts` — halt-loop serializes regardless of "parallelizable" topical claim); EC-6 (T1.1 new test JSDoc cites the FOLLOW-UP coupling at `run-mcp-server.ts:93-94` so future gating-change auditor knows to update the test).
>
> **Version 1.0** (2026-06-03) — Lift `/review theo-memory-standalone-p0-fixes-cycle-1` (report at `.claude/knowledge-base/reviews/theo-memory-standalone-p0-fixes-cycle-1-review-2026-06-03.md`) verdict from **READY_TO_MERGE_WITH_CAVEATS** to **READY_TO_MERGE clean**. Absorbs 3 NEW MAJOR findings introduced by fixes-cycle-1 itself: F-arch-7=F-wire-1 (MCP-side stub-embedder warning runtime-wired but NO RED test), F-dom-api-1 (OpenAPI spec missing 501 `SKILL_LISTING_NOT_IMPLEMENTED` for `listScopeMemories`), F-dom-api-2 (OpenAPI spec missing 413 `CONTENT_TOO_LARGE` for all 4 verb endpoints) + 2 MINOR that fix in the same OpenAPI edit (F-arch-2 + F-dom-api-6 `ScopeTypeEnum` description gap). Scope ~35 LoC across 3 files. All other findings (F-arch-4/6 LoC budget, F-xval-1 plan-template cosmetic, F-wire-2 pre-existing orphan export, F-tests-1/2/3 test-style cosmetic, 8 pre-existing-debt MAJORs) remain accepted-with-caveats per the cycle-1 review report's `## Honest disclosure` section.

## Goal

> "Lift `/review theo-memory-standalone-p0-fixes-cycle-1` verdict from READY_TO_MERGE_WITH_CAVEATS to READY_TO_MERGE clean by absorbing the 3 cycle-introduced MAJOR findings + 2 paired MINOR findings, measured by `/review theo-memory-standalone-p0-fixes-cycle-2` re-run returning 0 BLOCKER + 0 CRITICAL + 0 MAJOR-INTRODUCED-BY-THIS-CYCLE on the same diff base."

## Context

### What exists today (post-fixes-cycle-1 review 2026-06-03)

- The `/implement theo-memory-standalone-p0-fixes-cycle-1` halt-loop completed 6/6 tasks (commits `6e3b4ee` through `c9fc343`). F-rev-1 CRITICAL closed; F-rev-3/4/9/12 MAJOR absorbed.
- `/review theo-memory-standalone-p0-fixes-cycle-1` spawned 6 specialized agents in parallel. Verdict **READY_TO_MERGE_WITH_CAVEATS** with 3 NEW MAJORs introduced by the cycle itself + 11 MINOR + 17 INFO.
- Quality gates GREEN: 952 contract tests + 2 skipped + 121 test files; `npm run typecheck` 0 errors; `npm run lint` 0 warnings.
- **`/dogfood` gate** remains EVIDENCE_INSUFFICIENT (audit `6f7ff87`). This plan does NOT unblock production-ready claims; Roadmap Item 11 v1.0 gate still requires the anchor scenario running ≥ 30 days.

### What's broken (the 5 findings absorbed by this plan)

1. **F-arch-7 = F-wire-1 MAJOR (same root, two reviewers)** — fixes-cycle-1 `T2.2` added a 3-line stderr stub-embedder warning to BOTH `src/agent-tools/run-server.ts:81-92` (REST composition root) AND `src/agent-tools/run-mcp-server.ts:91-103` (MCP composition root). `FC1-T2.2-RED` in `src/agent-tools/__tests__/run-server.test.ts` pins the REST-side emission. The MCP-side emission is runtime-wired but un-pinned by CI — future silent drop risk (a next refactor cycle could remove the 3 stderr lines without any failing test surface). Inquebrável Rule 5 (TDD) + Rule 3 (honesty): if it MUST fire at runtime to honor Rule 3, it MUST have a test that fails when it doesn't fire.

2. **F-dom-api-1 MAJOR** — `src/server/openapi-registration.ts:138-163` declares `listScopeMemories` advertising only `200/400/404/422` responses. Runtime at `src/server/handlers/scopes.ts:91-100` short-circuits `scope.type === 'skill'` to 501 `SKILL_LISTING_NOT_IMPLEMENTED` (closed F-rev-1). Spec drift: consumers using `openapi-generator` or contract testing (Pact) see no 501 declaration and emit SDK methods that surface an undocumented status code. Spec must match runtime.

3. **F-dom-api-2 MAJOR** — `src/server/openapi-registration.ts:55-110` declares the 4 verb operations (`remember`/`recall`/`forget`/`reflect`) advertising only `201/202/204/400/422` (+500 on remember only). Runtime at `src/server/app.ts:96-107` mounts `hono/body-limit` with `onError` returning 413 envelope (closed F-rev-4). Same drift: 413 is undocumented. Spec must match runtime.

4. **F-arch-2 + F-dom-api-6 MINOR (paired with F-dom-api-1)** — `src/server/openapi-registration.ts:24` declares `ScopeTypeEnum = z.enum(['user', 'session', 'agent', 'skill'])` WITHOUT a description distinguishing the runtime semantics. Consumers reading the spec see all 4 path-param values as semantically equivalent, but `skill` returns 501 not 200 (per F-dom-api-1 fix). A `.describe()` clarifying that `skill` is a documented 501-yielding scope (SDK-only listing) closes the honesty gap in the same edit.

### Evidence motivating NOW (not later)

1. **Cycle-1 review explicitly halted with these 3 MAJORs** — letting them ship as caveats sets a precedent that "/review found something but we'll fix it later" becomes the default. Inquebrável Rule 2 (Task Completion) + Rule 3 (Honesty): the previous task isn't 100% done while spec drift exists.
2. **All 3 MAJORs are spec-side gaps** — pure documentation drift. Runtime is correct. Cost is ~35 LoC across 3 files, all under 1 hour. The diff is reviewable in one sitting.
3. **OpenAPI spec is the consumer contract.** Codegen SDKs (`openapi-generator`, `openapi-fetch`, `oazapfts`) consume `/v1/openapi.json` and emit typed clients. Spec missing 413 + 501 means codegen-emitted SDKs lack the typed branches for those error paths — consumers fall back to untyped catch-all, defeating the whole point of OpenAPI 3.1.
4. **MCP-side test gap is one test reusing existing mocks** (~30 LoC mirroring `FC1-T2.2-RED`). Cheap insurance against silent drop in a future refactor.

## Objective

- [ ] Sub-goal 1 — F-arch-7=F-wire-1: `src/agent-tools/__tests__/run-mcp-server.test.ts` exists with FC2-T1.1-RED test pinning the MCP-side stub-embedder stderr warning; test asserts stderr matches `/stub embedder/i` AND `/themory mcp/i`
- [ ] Sub-goal 2 — F-dom-api-1: `openapi-registration.ts` `listScopeMemories` responses include `501` with `ErrorEnvelopeSchema` description "Listing memories on `skill` scope is not implemented at P0 (SDK-only via `Memory.skills(...)` per ADR-0010)"; `openapi.test.ts` EC-5 walker extended with FC2-T1.2-RED assertion
- [ ] Sub-goal 3 — F-dom-api-2: 4 verb operations (`remember`/`recall`/`forget`/`reflect`) include `413` with `ErrorEnvelopeSchema` description "Request body exceeds 1 MB cap (`T2.1` / F-rev-4)"; FC2-T1.3-RED walker test asserts presence on all 4
- [ ] Sub-goal 4 — F-arch-2 + F-dom-api-6: `ScopeTypeEnum` carries `.describe('...')` honestly documenting that `skill` path-param returns 501; FC2-T1.4-RED asserts description contains the literal substring `'501'` or `'SDK-only'`
- [ ] Sub-goal 5 — `/review theo-memory-standalone-p0-fixes-cycle-2` re-run returns **0 BLOCKER + 0 CRITICAL + 0 MAJOR-INTRODUCED-BY-THIS-CYCLE**; verdict moves to `READY_TO_MERGE` clean

## Dependencies

Per `cycle-plan.md` v1.1 § Trigger conditions — every plan declares its dependency surface, even when it introduces ZERO new packages.

### Existing — use as-is (NO version changes)

| Package | Version (current in `package.json`) | Ecosystem | Why this plan uses it |
|---|---|---|---|
| `@asteasolutions/zod-to-openapi` | (transitive via `@hono/zod-openapi ^0.18.0`) | npm | T1.2/T1.3/T1.4 extend the existing `OpenAPIRegistry` calls in `openapi-registration.ts`. Pin already locked via source plan ADR D14 (sunset 2026-09-01). |
| `zod` | `^3.25.0` | npm | T1.4 uses `z.enum(...).describe(...)` (existing zod feature). |
| `vitest` | `^4.0.0` | npm | All 4 RED tests run on the existing vitest install. |
| `pg` | `^8.13.0` | npm | T1.1 RED test mocks `pg.Pool` — same mock pattern as `run-server.test.ts`. |
| `@modelcontextprotocol/sdk` | `^1.29.0` | npm | T1.1 RED test exercises `run-mcp-server.ts` which boots the SDK transport but mocks `connectStdio`/`connectStreamableHttp` to no-ops. |
| `hono` | `^4.6.0` | npm | No new hono usage; T1.3 only documents the existing `hono/body-limit` 413 path. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| **(none)** | — | — | — | This fix-up plan introduces ZERO new dependencies. All 4 tasks edit existing files OR add a new test file consuming existing mocks. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| **(none)** | — | — |

## ADRs

### D1 — `OpenAPIRegistry.registerPath` is the single source of spec truth (no separate handcrafted YAML)

- **Decision:** Add 413 + 501 response declarations directly to the existing `registry.registerPath` calls in `src/server/openapi-registration.ts`. Reuse the existing `ErrorEnvelopeSchema` for all new error responses. Do NOT introduce a separate handcrafted OpenAPI YAML/JSON file.
- **Rationale:** SoT discipline per CLAUDE.md `architecture.md § 4 (single source of truth — zod schemas → spec)`. The source plan T1.4 already locked `@hono/zod-openapi` + `@asteasolutions/zod-to-openapi` as the auto-derivation path. Adding new response codes via the same `registerPath` mechanism keeps the spec in sync with runtime by construction.
- **Alternatives considered:**
  - **B (Handcrafted OpenAPI YAML overlay):** rejected — re-introduces the drift problem this plan exists to fix. Two sources of truth always desync.
  - **C (Skip OpenAPI documentation; ship runtime-only):** rejected — that's the cycle-1 state being lifted. OpenAPI consumers (codegen SDKs, Pact contract testing) MUST see truthful response codes.

### D2 — `ScopeTypeEnum.describe('...')` clarifies `skill` semantics inline (no separate doc)

- **Decision:** Apply `.describe('...')` directly on the `ScopeTypeEnum` zod schema at `openapi-registration.ts:24`. The description text MUST include the literal `'501'` (status code) and/or `'SDK-only'` so codegen SDK consumers see the runtime semantic in the type doc-string.
- **Rationale:** YAGNI per Inquebrável Rule 11 — a separate `ENUM_SEMANTICS.md` doc would be one more place to drift. zod's `.describe()` propagates into the OpenAPI spec's `description` field per `@asteasolutions/zod-to-openapi` convention. Closes F-arch-2 + F-dom-api-6 in the same edit as T1.2.
- **Alternatives considered:**
  - **B (Remove `'skill'` from the enum entirely):** rejected — breaks EC-13 (case-sensitive validation per the source plan); existing `scopes.test.ts` test #6 (`User` capitalized → 404) relies on the 'skill' value reaching the handler dispatch. The handler short-circuits to 501; the enum stays.
  - **C (Split into two enums `ScopeTypeEnum` for path params + `ListableScopeTypeEnum` for the response shape):** rejected — over-engineering for one path-param value with documented 501 semantics; bloats the spec surface.

### D3 — MCP-side RED test mirrors the REST-side `FC1-T2.2-RED` pattern (no test framework drift)

- **Decision:** New test file `src/agent-tools/__tests__/run-mcp-server.test.ts` reuses the same `vi.mock('pg')` + `vi.mock('../../local/index.js')` + `vi.mock('./transports/stdio.js')` + `vi.spyOn(process.stderr, 'write')` pattern from `run-server.test.ts`. The RED test asserts `stderrSpy.mock.calls.flat()` contains text matching both `/stub embedder/i` AND `/themory mcp/i`.
- **Rationale:** DRY per CLAUDE.md `architecture.md § 7` (module hygiene) — mirroring the proven mock infrastructure avoids reinventing test scaffolding. The test costs ~30 LoC (one `describe` + one `it` + `beforeEach`/`afterEach`).
- **Alternatives considered:**
  - **B (Extend `cli.test.ts` with an MCP-stderr assertion):** rejected — `cli.test.ts` covers commander routing surface, not composition root behavior. Adding stderr assertions there violates SRP for the test file.
  - **C (Integration test under `tests/integration/`):** rejected — overkill for asserting one stderr line. Unit-level test with mocked `pg` + stubbed transports is sufficient.

### D4 — `ContentTooLargeError` 413 description references "`T2.1` / F-rev-4" inline (no paper names)

- **Decision:** 413 response description text in `openapi-registration.ts` references the plan task ID (`T2.1`) + finding ID (`F-rev-4`), NOT any paper or marketing name. Same convention for 501 (`F-rev-1` + `ADR-0010`).
- **Rationale:** `.claude/rules/no-paper-names-in-code.md` mandates description text + JSDoc + runtime strings cite task IDs / finding IDs / ADR coordinates, not paper names. The `## related` knowledge-base docs cite the source plans / reviews; the spec description text cites the filesystem coordinates.
- **Alternatives considered:**
  - **B (Omit task/finding IDs from the description — keep purely consumer-facing):** rejected — consumers fetching the spec see only the description; including the task ID gives the SDK author a breadcrumb to trace WHY this response exists.

### D5 — Test naming convention `FC2-T{N}-RED` mirrors cycle-1 `FC1-T{N}-RED` for grep-ability

- **Decision:** All 4 RED tests in this cycle use the `FC2-T{N}-RED` prefix in the test name (e.g., `it('FC2-T1.2-RED — openapi.json declares 501 SKILL_LISTING_NOT_IMPLEMENTED for listScopeMemories', ...)`).
- **Rationale:** `cycle-implement.md` halt-loop driver greps for RED test names to confirm RED phase landed before GREEN. Following the `FC1-T{N}-RED` convention from fixes-cycle-1 keeps the grep stable + the audit trail consistent.
- **Alternatives considered:**
  - **B (Free-form test names):** rejected — breaks the grep-ability the halt-loop relies on.

## Dependency Graph

```
Phase 1: All 4 tasks parallelizable (independent file edits + new test file)
  ┌── T1.1 (F-arch-7=F-wire-1) MCP-side stub-embedder RED test ──┐
  ├── T1.2 (F-dom-api-1) OpenAPI 501 for listScopeMemories ──────┤
  ├── T1.3 (F-dom-api-2) OpenAPI 413 for 4 verbs ────────────────┤
  └── T1.4 (F-arch-2+F-dom-api-6) ScopeTypeEnum.describe() ──────┤
                                                                  │
                                                                  ▼
Phase 2 (FINAL): Integration validation + /review re-run
```

All 4 tasks are independent at the topic level. Halt-loop processes tasks sequentially.

**EC-5 absorption (DOCUMENT):** T1.2, T1.3, T1.4 ALL edit the same file (`src/server/openapi-registration.ts`). The halt-loop's task-at-a-time processing naturally serializes these edits — no parallel-edit conflict is possible under the current `/implement` semantics. The "parallelizable" claim above means "independent by topic" (501 absorption vs 413 absorption vs description absorption), NOT "safe to run by concurrent automation". If a future automation parallelizes by task ID, T1.2/T1.3/T1.4 MUST be coalesced into a single commit OR strictly serialized via dependency arrows. T1.1 (new file `run-mcp-server.test.ts`) remains genuinely independent.

Phase 2 runs after all Phase 1 commits land.

---

## Phase 1: 3 MAJOR + 2 MINOR absorption

**Objective:** Close the 3 cycle-introduced MAJORs + 2 paired MINORs from the cycle-1 review report.

### T1.1 — MCP-side stub-embedder warning RED test (F-arch-7 = F-wire-1 absorption)

#### Objective
Add `src/agent-tools/__tests__/run-mcp-server.test.ts` with one RED test pinning the 3-line stub-embedder stderr warning emitted at `src/agent-tools/run-mcp-server.ts:91-103`. Test asserts stderr matches both `/stub embedder/i` AND `/themory mcp/i` via `vi.spyOn(process.stderr, 'write')`.

#### Evidence
- `src/agent-tools/run-mcp-server.ts:91-103` emits 3 `process.stderr.write` calls verbatim (verified via Read 2026-06-03): `'themory mcp: WARNING — Stub embedder + Stub LLM in use...'` + `'themory mcp: Recall returns shape-correct results...'` + `'themory mcp: For production, wire OpenAIEmbedder or LocalTransformerEmbedder...'`.
- `src/agent-tools/__tests__/run-server.test.ts:202-208` (verified) has the symmetric `FC1-T2.2-RED` test: `expect(captured).toMatch(/stub embedder/i); expect(captured).toMatch(/themory server/i);`.
- `ls src/agent-tools/__tests__/` does NOT show `run-mcp-server.test.ts` — the file does not exist; new file required.
- Wiring agent verdict (cycle-1 review): `pillar_b: PARTIAL` — "`FC1-T2.2-RED` in `run-server.test.ts` covers REST path only; MCP path uncovered (F-wire-1)".

#### Files to edit
```
src/agent-tools/__tests__/run-mcp-server.test.ts  (NEW) — single describe block; FC2-T1.1-RED test
```

#### Deep file dependency analysis
- **`src/agent-tools/__tests__/run-mcp-server.test.ts` (NEW):** mirrors `run-server.test.ts` mock infra (`vi.mock('pg')` + `vi.mock('../../local/index.js')` + `vi.mock('./transports/stdio.js')` + `vi.mock('./transports/streamable-http.js')` + `vi.spyOn(process.stderr, 'write')`). Imports `runMcpServer` from `../run-mcp-server.js`. No downstream files depend on this test (test files are leaves).
- **No edits to `src/agent-tools/run-mcp-server.ts`** — the runtime is already correct (cycle-1 `T2.2` shipped the 3 stderr lines). This task adds CI coverage; no production code change.

#### Deep Dives

**Mock surface** (mirror of `run-server.test.ts:23-67`):
- `vi.mock('pg', () => ({ Pool: class { end = vi.fn(); query = vi.fn().mockResolvedValue({ rows: [] }); } }))` — same as REST test.
- `vi.mock('../../local/index.js', () => ({ createLocalMemory: vi.fn().mockResolvedValue({}), runMigrations: vi.fn().mockResolvedValue(undefined), StubEmbedder: class {}, StubLLM: class {} }))` — same.
- `vi.mock('../../local/pgvector-store.js', () => ({ PgvectorStore: class {} }))` — same.
- `vi.mock('./transports/stdio.js', () => ({ connectStdio: vi.fn().mockResolvedValue(undefined) }))` — NEW vs REST test (REST doesn't use this transport).
- `vi.mock('./transports/streamable-http.js', () => ({ connectStreamableHttp: vi.fn().mockResolvedValue(undefined) }))` — same NEW.
- `vi.mock('./server.js', () => ({ McpServer: class { stop = vi.fn().mockResolvedValue(undefined); } }))` — NEW (REST uses `@hono/node-server`, MCP uses local McpServer class).

**Env precondition (EC-2 absorption):** in `beforeEach`, set BOTH:
- `vi.stubEnv('THEOMEM_PG_URI', 'postgres://themem:themem@localhost:5432/themem')` — required for `run-mcp-server.ts:73` non-empty check.
- `vi.stubEnv('THEOMEM_MCP_TRANSPORT', '')` — defensive clearing. Without this, an outer suite OR system env carrying `THEOMEM_MCP_TRANSPORT=streamable-http` routes `resolveTransport()` at `run-mcp-server.ts:46-51` to `connectStreamableHttp` and hits the `resolvePort`/`resolveHost` paths the mock infrastructure isn't set up for. Empty-string env routes to `'stdio'` default (per `resolveTransport`'s precedence: undefined env → `'stdio'`; the empty-string normalizes to the same default branch).

**Stderr spy:** identical to `run-server.test.ts:75-88` — `stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)` in `beforeEach`, `stderrSpy.mockRestore()` in `afterEach`.

**Signal cleanup:** `process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT')` in `afterEach` (the shutdown handler at `run-mcp-server.ts:117-128` registers both).

**Assertion shape** (mirror `run-server.test.ts:202-208`):
```ts
const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
expect(captured).toMatch(/stub embedder/i);
expect(captured).toMatch(/themory mcp/i);
```

#### Tasks
1. Read `src/agent-tools/__tests__/run-server.test.ts` lines 16-95 for the mock + beforeEach/afterEach pattern.
2. Create `src/agent-tools/__tests__/run-mcp-server.test.ts` with:
   - File-level JSDoc citing `Plan theo-memory-standalone-p0-fixes-cycle-2 § T1.1` + `F-arch-7=F-wire-1 absorption`.
   - **EC-6 absorption (DOCUMENT):** JSDoc MUST also include a "FOLLOW-UP coupling" note referencing `run-mcp-server.ts:93-94` — the existing `FOLLOW-UP: gate this warning when run-mcp-server.ts gains real-provider config` comment. Text verbatim: `"This test pins the CURRENT unconditional behavior. When the FOLLOW-UP at run-mcp-server.ts:93-94 lands (gating the warning when real provider configured), this test MUST be updated to assert conditional emission (stub path emits; real-provider path does NOT emit)."` A future test-updater grepping for `FOLLOW-UP at run-mcp-server.ts:93-94` lands on this test.
   - Identical mock setup adapted for MCP composition root (5 `vi.mock` calls per Deep Dives above).
   - `StderrSpy` interface (mirror of REST test's lines 69-73).
   - `beforeEach` (stub env + stderr spy + reset mocks).
   - `afterEach` (unstub env + restore spy + remove signal listeners).
   - One `describe('T1.1 — runMcpServer stub-embedder warning', ...)` block with one `it('FC2-T1.1-RED — runMcpServer writes stub-embedder warning to stderr on startup (F-arch-7 = F-wire-1)', async () => {...})`.
3. Run `npm test -- run-mcp-server.test.ts` — confirm RED phase (test runs, may PASS immediately if the warning is already emitted, but the test pins it against future drift).

Note: This is a "PASS-on-first-run" RED test by design (the runtime already emits the warning from cycle-1 `T2.2`). The "RED" semantic is "this test would FAIL if the warning lines were removed" — verified by temporarily commenting lines 95-103 of `run-mcp-server.ts` during the RED phase (run test, confirm FAIL, restore lines, run test, confirm PASS, then commit). This honors the TDD discipline per Inquebrável Rule 5 even though the production code lands BEFORE the test (precedent: F-rev-9 fix-up in cycle-1).

#### TDD

```
RED:     FC2-T1.1-RED — runMcpServer writes stub-embedder warning to stderr on startup (F-arch-7 = F-wire-1)
         Assertion: captured stderr matches /stub embedder/i AND /themory mcp/i
         Manual RED verification: comment lines 95-103 of run-mcp-server.ts → confirm test FAILS → restore → confirm PASS
GREEN:   No production code change required (warning is already emitted from cycle-1 `T2.2`)
REFACTOR: None expected
VERIFY:  npm test -- run-mcp-server.test.ts
```

#### Acceptance Criteria
- [ ] `src/agent-tools/__tests__/run-mcp-server.test.ts` exists with file-level JSDoc citing plan + finding ID + EC-6 FOLLOW-UP coupling note (`run-mcp-server.ts:93-94`)
- [ ] One `it('FC2-T1.1-RED — ...', ...)` test present and passing
- [ ] **EC-4 absorption (SHOULD TEST):** Commit message MUST contain the literal substring `Verified RED by temporarily commenting lines 95-103` so a future auditor running `git log --grep='Verified RED by temporarily commenting lines 95-103'` can confirm the manual-RED discipline. The full attestation text is: `Verified RED by temporarily commenting lines 95-103 of run-mcp-server.ts → test FAILS → restored → test PASSES`.
- [ ] EC-2 absorption: `beforeEach` stubs BOTH `THEOMEM_PG_URI` AND `THEOMEM_MCP_TRANSPORT` (empty string) to prevent system-env routing to streamable-http mock-uncovered path
- [ ] Test reuses identical mock pattern as `run-server.test.ts` (no test framework drift)
- [ ] Pass: complexity — new test file ≤ 100 LoC (well below the 500-LoC budget per `architecture.md § Module hygiene`)
- [ ] Pass: coverage — `npm run test:coverage` ≥ 90% on the new file (test files are exercised by their own assertions)
- [ ] Pass: lint — `npm run lint` zero warnings on the new file
- [ ] Pass: size — file ≤ 100 LoC

#### DoD
- [ ] Task completed and validated
- [ ] `npm test` green (952 + 1 new = 953 contract PASS)
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File ≤ 100 LoC

---

### T1.2 — OpenAPI 501 for `listScopeMemories` (F-dom-api-1 absorption)

#### Objective
Add `501` response declaration to the `listScopeMemories` `registerPath` call at `src/server/openapi-registration.ts:138-163`. Extend `openapi.test.ts` with one FC2-T1.2-RED test asserting the 501 is present in the published spec.

#### Evidence
- `src/server/openapi-registration.ts:150-162` (verified via Read 2026-06-03): `responses: { 200: {...}, 400: {...}, 404: {...}, 422: {...} }` — NO 501.
- `src/server/handlers/scopes.ts:91-100` (per fixes-cycle-1 T1.1) short-circuits `scope.type === 'skill'` to 501 `SKILL_LISTING_NOT_IMPLEMENTED` runtime response.
- `src/server/__tests__/openapi.test.ts:54-71` test #3 already walks operations by `operationId`; extending with a 501 check is one new test or one extension.
- API-design agent verdict (cycle-1 review): `F-dom-api-1 MAJOR — OpenAPI spec missing 501 SKILL_LISTING_NOT_IMPLEMENTED for listScopeMemories. Consumers using codegen (openapi-generator) or contract testing (Pact) will see undocumented status codes.`

#### Files to edit
```
src/server/openapi-registration.ts  — add 501 response to listScopeMemories registerPath responses block
src/server/__tests__/openapi.test.ts  — add FC2-T1.2-RED test walking spec.paths['/v1/scopes/{type}/{id}/memories'].get.responses['501']
```

#### Deep file dependency analysis
- **`openapi-registration.ts`:** the only consumer of the spec generation. Adding one response entry to the `responses` object is type-safe (TypeScript shape from `@asteasolutions/zod-to-openapi`). No downstream code reads the spec at runtime; only consumers fetching `/v1/openapi.json` see the change.
- **`openapi.test.ts`:** extending with one `it(...)` block. Existing test #3 (operationId walker) provides the type shape for the spec; we adapt that for response-code presence assertion.
- No production code change to `src/server/handlers/scopes.ts` — the 501 runtime branch already exists.

#### Deep Dives

**Exact edit to `openapi-registration.ts:150-162`** (insert one new response entry between 422 and the closing brace):
```ts
      404: { description: 'Unknown scope type or empty id.' },
      422: { description: 'Invalid query parameters.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      501: {
        description:
          "Listing memories on 'skill' scope is not implemented at P0 (SDK-only via Memory.skills(...) per ADR-0010; closes F-rev-1 from theo-memory-standalone-p0 review).",
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
```

**Description text discipline (D4):** cites ADR-0010 + F-rev-1 inline, no paper names.

**Test assertion** (insert as new test #6 in `openapi.test.ts`):
```ts
test('6. FC2-T1.2-RED — listScopeMemories advertises 501 SKILL_LISTING_NOT_IMPLEMENTED (F-dom-api-1 absorption)', async () => {
  const app = createServer({ memory: stubMemory() });
  const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
  interface Op { responses?: Record<string, { description?: string }> }
  interface PathItem { get?: Op }
  interface Spec { paths: Record<string, PathItem> }
  const spec = (await res.json()) as Spec;
  const responses = spec.paths['/v1/scopes/{type}/{id}/memories']?.get?.responses;
  expect(responses?.['501']).toBeDefined();
  expect(responses?.['501']?.description).toMatch(/skill/i);
  expect(responses?.['501']?.description).toMatch(/ADR-0010|SDK-only|not implemented/i);
});
```

#### Tasks
1. Edit `src/server/openapi-registration.ts` — add the 501 response entry verbatim per Deep Dives.
2. Add test #6 to `src/server/__tests__/openapi.test.ts` per Deep Dives.
3. Run `npm test -- openapi.test.ts` — confirm test #6 PASSES after the 501 entry lands.
4. Manual RED verification: run test BEFORE adding 501 entry → confirm FAIL with `expected 501 to be defined`. Then add entry → confirm PASS. Commit both together.

#### TDD

```
RED:     FC2-T1.2-RED — listScopeMemories advertises 501 SKILL_LISTING_NOT_IMPLEMENTED
         (without the production edit, test FAILS with `expected 501 to be defined`)
GREEN:   Add 501 response entry to listScopeMemories.responses in openapi-registration.ts
REFACTOR: None expected
VERIFY:  npm test -- openapi.test.ts
```

#### Acceptance Criteria
- [ ] `openapi-registration.ts` has 501 entry in `listScopeMemories.responses` with `ErrorEnvelopeSchema` content + description citing ADR-0010 + F-rev-1
- [ ] `openapi.test.ts` test #6 (FC2-T1.2-RED) present and passing
- [ ] Spec walker test asserts both `responses['501']` defined AND description matches `/skill/i` + `/ADR-0010|SDK-only|not implemented/i`
- [ ] **EC-3 absorption (SHOULD TEST):** Existing `openapi.test.ts` test #1 (`returns valid OpenAPI 3.1 spec (swagger-parser validates)`) MUST still PASS after the 501 addition. The structural sentinel catches malformed `description` field OR missing required keys in the new response entry. Verified inline: `npm test -- openapi.test.ts` shows test #1 green AFTER the spec change.
- [ ] Manual RED verification documented in commit message
- [ ] No paper names in description text (cites task ID + ADR coordinate per `.claude/rules/no-paper-names-in-code.md`)
- [ ] Pass: complexity — single object-literal edit + single test; cyclomatic complexity unchanged
- [ ] Pass: coverage — `npm run test:coverage` ≥ 90% on `openapi-registration.ts` (existing coverage preserved)
- [ ] Pass: lint — `npm run lint` zero warnings
- [ ] Pass: size — `openapi-registration.ts` ≤ 180 LoC after edit (currently 164; +8 lines well below 500 budget)

#### DoD
- [ ] Task completed and validated
- [ ] `npm test` green (953 + 1 = 954 contract PASS)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] File ≤ 200 LoC

---

### T1.3 — OpenAPI 413 for 4 verb endpoints (F-dom-api-2 absorption)

#### Objective
Add `413` response declaration to all 4 verb `registerPath` calls in `src/server/openapi-registration.ts` (`/v1/remember`, `/v1/recall`, `/v1/forget`, `/v1/reflect`). Extend `openapi.test.ts` with one FC2-T1.3-RED test walking all 4 verbs and asserting 413 presence on each.

#### Evidence
- `src/server/openapi-registration.ts:55-110` (verified): all 4 verbs declare `400/422` + (`500` on remember; `201`/`202`/`204`/`200` per verb). NONE declare 413.
- `src/server/app.ts:96-107` (per fixes-cycle-1 `T2.1`) mounts `bodyLimit({ maxSize: 1_000_000, onError: ... })` returning 413 envelope via `mapDomainErrorToResponse(new ContentTooLargeError(1_000_000, -1))`.
- `src/server/__tests__/openapi.test.ts:81-96` test #5 (FC1-T1.1 EC-5) provides the walker pattern across 4 verbs — extending is mechanical.
- API-design agent verdict (cycle-1 review): `F-dom-api-2 MAJOR — OpenAPI spec missing 413 CONTENT_TOO_LARGE for all 4 verb endpoints. Same blast radius as F-dom-api-1.`

#### Files to edit
```
src/server/openapi-registration.ts  — add 413 response to /v1/remember + /v1/recall + /v1/forget + /v1/reflect registerPath responses
src/server/__tests__/openapi.test.ts  — add FC2-T1.3-RED test asserting 413 on all 4 verbs
```

#### Deep file dependency analysis
- **`openapi-registration.ts`:** 4 `responses` object literals get one new entry each. Same type-safe edit as T1.2.
- **`openapi.test.ts`:** one new walker test reusing the for-loop pattern from existing test #5. No new test helper needed.
- No production code change to `src/server/app.ts` — 413 runtime branch already exists via `hono/body-limit` middleware.

#### Deep Dives

**Exact edit to `openapi-registration.ts`** — apply the same insertion pattern to all 4 responses blocks. The 413 entry is identical across verbs:
```ts
      413: {
        description:
          'Request body exceeds 1 MB cap (`T2.1` / F-rev-4 absorption; mapped from ContentTooLargeError via mapDomainErrorToResponse).',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
```

Insert positions:
- **`/v1/remember` (lines 55-63):** insert between `422` and `500`.
- **`/v1/recall` (lines 72-79):** insert between `422` and the closing brace.
- **`/v1/forget` (lines 88-92):** insert between `422` and the closing brace.
- **`/v1/reflect` (lines 101-108):** insert between `422` and the closing brace.

**Description text discipline (D4):** cites `T2.1` + F-rev-4 + `mapDomainErrorToResponse`, no paper names.

**Test assertion** (insert as test #7 in `openapi.test.ts`):
```ts
test('7. FC2-T1.3-RED — all 4 verbs advertise 413 CONTENT_TOO_LARGE (F-dom-api-2 absorption)', async () => {
  const app = createServer({ memory: stubMemory() });
  const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
  interface Op { responses?: Record<string, { description?: string }> }
  interface PathItem { post?: Op }
  interface Spec { paths: Record<string, PathItem> }
  const spec = (await res.json()) as Spec;
  for (const verb of ['/v1/remember', '/v1/recall', '/v1/forget', '/v1/reflect']) {
    const responses = spec.paths[verb]?.post?.responses;
    expect(responses?.['413']).toBeDefined();
    expect(responses?.['413']?.description).toMatch(/1\s*MB|body|content too large/i);
  }
});
```

#### Tasks
1. Edit `src/server/openapi-registration.ts` — add the 413 response entry to all 4 verb `responses` blocks per Deep Dives.
2. Add test #7 to `src/server/__tests__/openapi.test.ts` per Deep Dives.
3. Run `npm test -- openapi.test.ts` — confirm test #7 PASSES.
4. Manual RED verification: run test BEFORE adding 413 entries → confirm FAIL (loop assertion fails on `/v1/remember`).

#### TDD

```
RED:     FC2-T1.3-RED — all 4 verbs advertise 413 CONTENT_TOO_LARGE
         (without the production edit, test FAILS with `expected 413 to be defined`)
GREEN:   Add 413 response entry to all 4 verb responses blocks
REFACTOR: None expected
VERIFY:  npm test -- openapi.test.ts
```

#### Acceptance Criteria
- [ ] All 4 verb operations (`remember`/`recall`/`forget`/`reflect`) have 413 entry with `ErrorEnvelopeSchema` content
- [ ] Description text cites `T2.1` + F-rev-4 + `mapDomainErrorToResponse` (per D4)
- [ ] `openapi.test.ts` test #7 (FC2-T1.3-RED) present and passing
- [ ] Walker asserts both `responses['413']` defined AND description matches `/1\s*MB|body|content too large/i` on ALL 4 verbs
- [ ] **EC-3 absorption (SHOULD TEST):** Existing `openapi.test.ts` test #1 swagger-parser OpenAPI 3.1 validation MUST still PASS after the 4× 413 additions. 4 new entries with identical description text — verify swagger-parser doesn't reject duplicate-description OR malformed schema reference.
- [ ] Manual RED verification documented in commit message
- [ ] No paper names in description text
- [ ] Pass: complexity — 4 identical object-literal edits; cyclomatic complexity unchanged
- [ ] Pass: coverage — `npm run test:coverage` preserved
- [ ] Pass: lint — `npm run lint` zero warnings
- [ ] Pass: size — `openapi-registration.ts` ≤ 200 LoC after edit (currently 164 + 8 from T1.2 + 24 from T1.3 = ~196; under 500 budget)

#### DoD
- [ ] Task completed and validated
- [ ] `npm test` green (954 + 1 = 955 contract PASS)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings

---

### T1.4 — `ScopeTypeEnum.describe()` clarifies `skill` semantics (F-arch-2 + F-dom-api-6 absorption)

#### Objective
Apply `.describe('...')` to `ScopeTypeEnum` at `src/server/openapi-registration.ts:24` documenting that `skill` path-param returns 501 (SDK-only listing). Add FC2-T1.4-RED test asserting the description propagates into the published spec.

#### Evidence
- `src/server/openapi-registration.ts:24` (verified): `const ScopeTypeEnum = z.enum(['user', 'session', 'agent', 'skill']);` — no `.describe()`.
- API-design agent verdict (cycle-1 review): `F-dom-api-6 MINOR — ScopeTypeEnum description gap — 'skill' advertised as equivalent to 'user/session/agent' semantically.`
- Architecture agent verdict (cycle-1 review): `F-arch-2 MINOR — OpenAPI ScopeTypeEnum still advertises 'skill' as valid path param — codegen clients will emit guaranteed-501 SDK methods.`
- Bundling F-arch-2 + F-dom-api-6 into T1.4 honors KISS (one edit closes two findings) and YAGNI (rejected alternative B was "split into two enums").

#### Files to edit
```
src/server/openapi-registration.ts  — replace `z.enum([...])` with `z.enum([...]).describe('...')`
src/server/__tests__/openapi.test.ts  — add FC2-T1.4-RED test asserting description contains '501' OR 'SDK-only'
```

#### Deep file dependency analysis
- **`openapi-registration.ts:24`:** single-line edit. `.describe()` is a documented zod method that propagates into the `@asteasolutions/zod-to-openapi` output as the `description` field of the spec's path-param schema. No type changes; no consumer-of-the-enum breakage.
- **`openapi.test.ts`:** one new test walking the listScopeMemories path params for the description.
- No production runtime change.

#### Deep Dives

**Exact edit to `openapi-registration.ts:24`:**
```ts
const ScopeTypeEnum = z
  .enum(['user', 'session', 'agent', 'skill'])
  .describe(
    "Scope type for path params. Values 'user'|'session'|'agent' list memories under the corresponding tier. Value 'skill' returns 501 SKILL_LISTING_NOT_IMPLEMENTED — skill listing is SDK-only via Memory.skills(...) per ADR-0010.",
  );
```

**Description text discipline (D4):** cites ADR-0010; no paper names; includes literal `'501'` substring to satisfy the test assertion (D2 rationale).

**Test assertion (EC-1 MUST FIX absorption — fallback chain across both possible serialization paths):**

Empirically verified 2026-06-03: NO existing `.describe()` usage in `src/server/` to validate which OpenAPI field zod-to-openapi propagates `.describe()` into. The library may serialize the enum's description to EITHER `parameters[i].description` (OpenAPI 3.1 Parameter Object level) OR `parameters[i].schema.description` (Schema Object level) depending on version + how the enum is referenced inside `z.object({ type: ScopeTypeEnum, ... })`. Both are OpenAPI 3.1-conformant; the test MUST walk BOTH paths via a fallback chain.

Insert as test #8 in `openapi.test.ts`:
```ts
test('8. FC2-T1.4-RED — ScopeTypeEnum description documents 501-for-skill semantic (F-arch-2 + F-dom-api-6 absorption)', async () => {
  const app = createServer({ memory: stubMemory() });
  const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
  interface Param { name?: string; description?: string; schema?: { description?: string } }
  interface Op { parameters?: Param[] }
  interface PathItem { get?: Op }
  interface Spec { paths: Record<string, PathItem> }
  const spec = (await res.json()) as Spec;
  const params = spec.paths['/v1/scopes/{type}/{id}/memories']?.get?.parameters ?? [];
  const typeParam = params.find((p) => p.name === 'type');
  // EC-1 absorption: zod-to-openapi may put .describe() at Parameter Object level
  // OR Schema Object level depending on version. Walk BOTH paths via fallback chain.
  // Both are OpenAPI 3.1-conformant; both equally satisfy the F-arch-2/F-dom-api-6
  // honesty intent (codegen consumers see the description regardless of nesting).
  const descr = typeParam?.description ?? typeParam?.schema?.description;
  expect(descr).toBeDefined();
  expect(descr).toMatch(/501|SDK-only/);
  expect(descr).toMatch(/skill/i);
});
```

#### Tasks
1. Edit `src/server/openapi-registration.ts:24` — apply `.describe(...)` per Deep Dives.
2. Add test #8 to `src/server/__tests__/openapi.test.ts` per Deep Dives.
3. Run `npm test -- openapi.test.ts` — confirm test #8 PASSES.
4. Manual RED verification: run test BEFORE applying `.describe()` → confirm FAIL with `expected description to be defined` OR matcher mismatch.

#### TDD

```
RED:     FC2-T1.4-RED — ScopeTypeEnum description documents 501-for-skill semantic
         (without the production edit, test FAILS — description is undefined)
GREEN:   Apply .describe(...) to ScopeTypeEnum
REFACTOR: None expected
VERIFY:  npm test -- openapi.test.ts
```

#### Acceptance Criteria
- [ ] `ScopeTypeEnum` carries `.describe(...)` with text containing `'501'` AND `'SDK-only'` (per D2 + D4)
- [ ] Description cites ADR-0010 inline
- [ ] `openapi.test.ts` test #8 (FC2-T1.4-RED) present and passing
- [ ] **EC-1 absorption (MUST FIX):** Test #8 uses fallback chain `typeParam?.description ?? typeParam?.schema?.description` to handle BOTH zod-to-openapi serialization paths (Parameter Object level vs Schema Object level). Verified inline by running `npm test -- openapi.test.ts` after GREEN — test passes regardless of which field the library populates.
- [ ] **EC-3 absorption (SHOULD TEST):** Existing `openapi.test.ts` test #1 swagger-parser OpenAPI 3.1 validation MUST still PASS after the `.describe()` addition. Spec-level description is OpenAPI 3.1-conformant; swagger-parser should accept.
- [ ] Manual RED verification documented in commit message
- [ ] No paper names in description text
- [ ] Pass: complexity — single-line edit; cyclomatic complexity unchanged
- [ ] Pass: coverage — `npm run test:coverage` preserved
- [ ] Pass: lint — `npm run lint` zero warnings
- [ ] Pass: size — `openapi-registration.ts` ≤ 200 LoC after edit (cumulative T1.2 + T1.3 + T1.4)

#### DoD
- [ ] Task completed and validated
- [ ] `npm test` green (955 + 1 = 956 contract PASS)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | F-arch-7 = F-wire-1 (MCP-side stub-embedder warning has NO RED test) | T1.1 | New `run-mcp-server.test.ts` with FC2-T1.1-RED asserting stderr matches `/stub embedder/i` + `/themory mcp/i` |
| 2 | F-dom-api-1 (OpenAPI missing 501 for listScopeMemories) | T1.2 | `registerPath` for `listScopeMemories` gains 501 entry; openapi.test.ts test #6 walker asserts it |
| 3 | F-dom-api-2 (OpenAPI missing 413 for 4 verbs) | T1.3 | 4 `registerPath` calls gain 413 entries; openapi.test.ts test #7 walker asserts on all 4 |
| 4 | F-arch-2 (ScopeTypeEnum advertises 'skill' without 501 caveat) | T1.4 | `ScopeTypeEnum.describe('...501... SDK-only...')` propagates into spec; openapi.test.ts test #8 asserts |
| 5 | F-dom-api-6 (ScopeTypeEnum description gap — same root as F-arch-2) | T1.4 | Same edit closes both findings (D2 alternative B rejected) |
| 6 | Re-review returns 0 BLOCKER + 0 CRITICAL + 0 MAJOR-INTRODUCED-BY-THIS-CYCLE | T1.1 + T1.2 + T1.3 + T1.4 | After all 4 task commits land, the Final Phase runs `/review theo-memory-standalone-p0-fixes-cycle-2`; success requires every task's contribution honored simultaneously |
| 7 | `npm test` 956 PASS (952 baseline + 4 new) | T1.1 + T1.2 + T1.3 + T1.4 | Each task's DoD includes `npm test` green; Final Phase verifies the cumulative pass count |
| 8 | `npm run typecheck` 0 errors | T1.1 + T1.2 + T1.3 + T1.4 | Each task's DoD includes typecheck; Final Phase verifies cumulative |
| 9 | `npm run lint` 0 warnings | T1.1 + T1.2 + T1.3 + T1.4 | Each task's DoD includes lint; Final Phase verifies cumulative |
| 10 | CHANGELOG entries for T1.1/T1.2/T1.3/T1.4 | T1.1 + T1.2 + T1.3 + T1.4 | Each task's commit updates `CHANGELOG.md` under `[Unreleased]` `### Fixed` (cycle absorbs review findings) per Inquebrável Rule 6 |
| 11 | Source plan reference preserved by T1.2 description text | T1.2 | 501 description cites ADR-0010 + F-rev-1 inline |
| 12 | Source plan reference preserved by T1.3 description text | T1.3 | 413 description cites `T2.1` + F-rev-4 inline |
| 13 | Cycle-1 plan archived after merge | T1.1 + T1.2 + T1.3 + T1.4 | Global DoD checkbox; plan archived per `audit-trail-rotation.md` lifecycle (active → completed) after PR merge — applies to the chain (cycle-1 + cycle-2 + source plan) |
| 14 | EC-1 MUST FIX (T1.4 assertion path fallback for zod-to-openapi serialization) | T1.4 | Test #8 uses `typeParam?.description ?? typeParam?.schema?.description` fallback chain — walks BOTH OpenAPI 3.1-conformant placements |
| 15 | EC-2 SHOULD TEST (T1.1 `THEOMEM_MCP_TRANSPORT` env clearing) | T1.1 | `beforeEach` stubs the env to empty string preventing system-env routing to streamable-http mock-uncovered path |
| 16 | EC-3 SHOULD TEST (existing openapi.test.ts test #1 swagger-parser sentinel) | T1.2 + T1.3 + T1.4 | Per-task AC checkbox: each spec addition MUST keep test #1 PASSING |
| 17 | EC-4 SHOULD TEST (T1.1 commit message audit trail) | T1.1 | Commit message MUST contain literal `Verified RED by temporarily commenting lines 95-103` for grep-able discipline audit |
| 18 | EC-5 DOCUMENT (T1.2/T1.3/T1.4 edit same file; halt-loop serializes) | T1.2 + T1.3 + T1.4 | Dependency Graph section amended with explicit serialization note that applies to these 3 tasks |
| 19 | EC-6 DOCUMENT (T1.1 new test FOLLOW-UP coupling to `run-mcp-server.ts:93-94`) | T1.1 | New test's JSDoc carries the FOLLOW-UP-coupling note so future gating-change auditor lands on this test |
| 20 | Cycle-1 `T2.1` reference preserved (body-limit middleware shipped by fixes-cycle-1) | T1.3 | T1.3 cites cycle-1 `T2.1` inline in 413 description text + Deep Dives + AC; cycle-2 does NOT modify the body-limit middleware shipped by cycle-1 `T2.1` |
| 21 | Cycle-1 `T2.2` reference preserved (stub-embedder warning shipped by fixes-cycle-1) | T1.1 | T1.1 cites cycle-1 `T2.2` inline as the warning's emission origin; cycle-2 does NOT modify the warning lines themselves, only adds CI coverage |
| 22 | Source plan `T1.7` reference preserved (OpenAPI registration shipped by source plan) | T1.2 + T1.3 + T1.4 | All 3 spec-side tasks extend source plan `T1.7`'s `OpenAPIRegistry.registerPath` calls; F-dom-api-3 (3-of-4-verbs-missing-500) accepted-with-caveats as source plan `T1.7` pre-existing debt |

**Coverage: 22/22 gaps covered (100%)**

## Accepted-with-caveats (out of scope per cycle-1 review § Honest disclosure)

The following findings from `/review theo-memory-standalone-p0-fixes-cycle-1` are explicitly DEFERRED per the cycle-1 review report's `## Honest disclosure` section. They are NOT gaps for THIS plan; they are tracked separately for future refactor cycles. Listed here for completeness per Inquebrável Rule 3:

| Finding | Severity | Why deferred (per cycle-1 review) |
|---|---|---|
| F-arch-4 | MINOR | `_body-parsing.ts` location debate — cosmetic; not introduced by cycle-1 or cycle-2 |
| F-arch-6 | MINOR | `ContentTooLargeError(1_000_000, -1)` sentinel produces "-1 bytes" string at logger surface — cycle-1 chose `-1` sentinel deliberately; cosmetic logger-surface issue |
| F-tests-1/2/3 | MINOR | Test-style cosmetic (`vi.stubEnv` vs direct env / tautological assertions / scoped.remember spy strengthening) — all optional polish |
| F-dom-api-3 | MINOR | 3 of 4 verbs missing 500 INTERNAL_ERROR in OpenAPI spec — pre-existing source plan `T1.7` debt; NOT introduced by cycle-1 or cycle-2 |
| F-xval-1 | MINOR | T1.1 AC "ZERO hits" literal-grep didn't match (JSDoc + test-history references) — plan-template wording clarification; cosmetic |
| F-wire-2 | INFO | `MemoryLike` interface exported but consumed only by `resolveScope` param type — pre-existing orphan; bundle with next `src/server/` refactor cycle |
| F-rev-2/5/6/7/10/11/13/14 | MAJOR | Pre-existing-debt from source `/review theo-memory-standalone-p0` — out of fix-up scope; tracked for dedicated follow-up cycle |

These findings are bundled into a future `src/server/` refactor cycle OR follow-up source-plan-debt cycle. They do NOT block merge of this plan.

## Global Definition of Done

- [ ] All phases completed (Phase 1 + Final Phase)
- [ ] All tests passing — `npm test` green (956 contract / 2 skipped)
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene`):
  - `src/agent-tools/__tests__/run-mcp-server.test.ts` (NEW) ≤ 100 LoC
  - `src/server/openapi-registration.ts` ≤ 200 LoC (currently 164; +35 LoC budget)
  - `src/server/__tests__/openapi.test.ts` ≤ 250 LoC (currently ~100; +60 LoC for 3 new tests)
- [ ] CHANGELOG.md updated under `[Unreleased]` `### Fixed` with one entry per task (Inquebrável Rule 6):
  - T1.1: `Add MCP-side stub-embedder warning RED test (F-arch-7 = F-wire-1 absorption from theo-memory-standalone-p0-fixes-cycle-1 review)`
  - T1.2: `Add 501 SKILL_LISTING_NOT_IMPLEMENTED to OpenAPI spec for listScopeMemories (F-dom-api-1 absorption)`
  - T1.3: `Add 413 CONTENT_TOO_LARGE to OpenAPI spec for /v1/remember + /v1/recall + /v1/forget + /v1/reflect (F-dom-api-2 absorption)`
  - T1.4: `Document ScopeTypeEnum 'skill'-returns-501 semantic in OpenAPI spec via .describe() (F-arch-2 + F-dom-api-6 absorption)`
- [ ] Backward compatibility preserved across public API — none of the 4 tasks touches `src/index.ts` OR any subpath export OR any consumer-facing runtime behavior. Pure spec + test additions.
- [ ] `.claude/rules/no-paper-names-in-code.md` honored: all description text + test names cite task IDs (`T2.1`, T1.1) + finding IDs (F-rev-1, F-rev-4, F-dom-api-1) + ADR coordinates (ADR-0010), no paper names
- [ ] **Runtime-metric proof** — N/A. This plan introduces ZERO new metrics; the existing OTel `http.server.requests` counter already observes 413 + 501 responses (no new instrumentation required).
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move BOTH `theo-memory-standalone-p0-fixes-cycle-2-plan.md` AND `theo-memory-standalone-p0-fixes-cycle-1-plan.md` AND the source plan `theo-memory-standalone-p0-plan.md` to `.claude/knowledge-base/plans/completed/`. The chain ships as a unit.

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all Phase 1 task commits land. The plan is NOT done until the validation chain passes AND `/review` re-run returns the target verdict.

**Objective:** Validate that the 4 absorptions work in a real workload AND that the re-review verdict moves from READY_TO_MERGE_WITH_CAVEATS to READY_TO_MERGE clean.

### Execution

Run the full validation chain:

```bash
npm test                        # 956 contract / 2 skipped
npm run test:coverage           # coverage preserved on edited files
npm run typecheck               # zero TS errors
npm run lint                    # zero lint warnings
```

Then invoke `/review theo-memory-standalone-p0-fixes-cycle-2` to re-spawn the 6 specialized review agents on the cycle-2 diff (same diff base as cycle-1 + cycle-2 commits).

### Acceptance Criteria

- [ ] `npm test` 956 PASS / 2 skipped
- [ ] `npm run test:coverage` ≥ 90% on changed files (critical paths unchanged)
- [ ] `npm run typecheck` zero TS errors
- [ ] `npm run lint` zero lint warnings
- [ ] `/review` re-run returns:
  - 0 BLOCKER
  - 0 CRITICAL
  - 0 MAJOR INTRODUCED-BY-THIS-CYCLE (the 3 cycle-1 MAJORs are closed; new MAJORs introduced by THIS cycle, if any, would re-trigger NEEDS_FIXES)
  - Verdict `READY_TO_MERGE` (clean — no caveats from cycle-2 itself)
  - Pre-existing accepted-with-caveats MAJORs (F-rev-2/5/6/7/10/11/13/14) remain caveated per source-plan-review honest disclosure

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing (cycle-1 caveats vs cycle-2 introductions).
2. Fix all cycle-2-caused failures before declaring the plan complete.
3. Re-run the validation chain + `/review` to confirm fixes.
4. Pre-existing issues are logged but do NOT block plan completion (document them in the PR description as continuing accepted-with-caveats).

### If `/review` re-run surfaces NEW MAJOR/CRITICAL introduced by THIS cycle

- HALT per `cycle-review.md` § Hard gates. Spawn `theo-memory-standalone-p0-fixes-cycle-3-plan.md` only if absolutely required; honesty discipline prefers closing the chain at cycle-2 unless a real defect lands.
- Honest "exhausted" report is preferable to a false-positive `READY_TO_MERGE` claim per Inquebrável Rule 3.
