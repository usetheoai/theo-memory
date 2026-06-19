---
slug: theo-memory-dashboard-full-integration
created_at: 2026-06-19
goal: Expose 100% of the core TheMemory feature surface through the theo-cloud gateway into the dashboard, proven by an extended e2e that round-trips remember→recall→reflect + reads real metrics/entities + asserts zero 401 on every memory screen against the live dev stack.
---

# Plan: TheMemory → gateway → dashboard full integration

> Closes every gap from the API↔gateway↔dashboard cross-validation (this session). Cross-repo: **theo-cloud** (Go gateway + React dashboard) + **theo-memory** (`@usetheo/memory` REST API, TS). FAANG-level, no rework, validated end-to-end on the running dev stack.

## Goal

> "Wire the 3 missing memory verbs (remember / recall / reflect) + real metrics + real entities through the gateway BFF into the dashboard so that `tests/e2e` round-trips remember→recall→reflect via the browser-session path AND every memory screen (Overview, Memories, Entities, Exports, Webhooks, Playground) loads with HTTP 200 (zero 401) against real `ankane/pgvector:v0.5.1` + the real TheMemory server — 0 failed."

## Context

Source: the API↔gateway↔dashboard cross-validation performed this session (measured, not assumed). The dashboard is today a read/forget/export/webhooks console. Measured findings:

- Gateway proxies only `list` / `metrics` (derived) / `forget` / `entities` (empty) + `webhooks/*` + `exports/*` (`cmd/main.go:406-419`).
- The dashboard BFF surface `/v1/dashboard/memory/*` (`dashboard_memory.go`) wraps ONLY list/metrics/forget/entities — so the dashboard's **Exports/Webhooks** tabs call the SDK `/v1/memory/*` (RequireScope `theo_live_*`) with a browser session → **401** (measured this session).
- TheMemory REST exposes `POST /v1/{remember,recall,forget,reflect}` + `GET /v1/scopes/:type/:id/memories` (`app.ts`). It has **no** `metrics` / `entities` / `history` endpoint — the gateway derives `total` and returns `entities: []` (honest placeholders).
- Dashboard has **no UI** for remember (write), recall (semantic search), or reflect (consolidation). The "Try Playground" Explore card links to the flat list (`memory.tsx:151`), not a real playground.
- Memories page has From/To date inputs that are **no-ops** — the provider's scope-list endpoint ignores them.

This plan is classified **P0 hardening** per the project-owner goal directive (2026-06-19): the new TheMemory `metrics`/`entities` endpoints are correctness/SDK-functional hardening of an already-shipped surface, not a frozen Phase-V feature.

## Baseline Context (deep review of current state)

### Files that will be touched

| File (repo) | LoC today | sha | Why it exists | Invariant to preserve |
|---|---|---|---|---|
| `theo-cloud internal/themory/client.go` | 324 | abc60b6 | HTTP client to TheMemory (List/Metrics/Entities/Forget) | master bearer never leaves Go; subject-in-path scoping; conform to real `/v1/openapi.json` |
| `theo-cloud internal/routes/memory.go` | 258 | 686760c | SDK-scope `/v1/memory/*` handlers (theo_live_*) | RequireScope path unchanged; new verbs additive |
| `theo-cloud internal/routes/dashboard_memory.go` | 124 | 686760c | BFF: session→mint theo_live_*→delegate to MemoryHandler | secret discarded post-mint; only adds verbs |
| `theo-cloud cmd/main.go` | 788 | f730941 | composition root + route mounting | `/v1/memory/*`=SDK, `/v1/dashboard/memory/*`=BFF (requireJWT) split |
| `theo-cloud dashboard/src/pages/memory.tsx` | 194 | abc60b6 | Overview KPIs + charts | uses PageShell + space-y-6 wrapper (this session) |
| `theo-cloud dashboard/src/pages/memory/memories.tsx` | 238 | abc60b6 | list + forget + filters | BFF paths `/v1/dashboard/memory/*` |
| `theo-cloud dashboard/src/pages/memory/entities.tsx` | 215 | abc60b6 | entity tabs + cascade forget | — |
| `theo-cloud dashboard/src/pages/memory/exports.tsx` | 220 | abc60b6 | export jobs | currently 401 (SDK path) |
| `theo-cloud dashboard/src/pages/memory/webhooks.tsx` | 554 | abc60b6 | webhooks + deliveries | currently 401 (SDK path) |
| `theo-cloud dashboard/src/pages/memory/playground.tsx` (NEW) | 0 | — | remember/recall/reflect UI | — |
| `theo-cloud dashboard/src/app.tsx` | 411 | abc60b6 | routes | lazy route registration |
| `theo-cloud dashboard/src/components/layout/app-sidebar.tsx` | 522 | abc60b6 | nav | memory submenu groups |
| `theo-memory packages/api/src/server/app.ts` | 321 | df917f8 | Hono app + route registration | auth-exempt /v1/openapi.json + /v1/health |
| `theo-memory packages/api/src/server/schemas.ts` | 149 | 94b4c74 | zod request bodies | single-scope-tier superRefine (standalone-p0 ADR-D12) |
| `theo-memory packages/api/src/server/handlers/metrics.ts` (NEW) | 0 | — | GET /v1/metrics scope aggregate | workspace-scoped |
| `theo-memory packages/api/src/server/handlers/entities.ts` (NEW) | 0 | — | GET /v1/entities scope aggregate | workspace-scoped |
| `theo-memory packages/core/src/infrastructure/db/scoped-memory.ts` | 357 | 477f72d | pg-backed scoped memory ops | add aggregate queries (count/distinct) |

### Current callers / dependents
- `themory.Client` (client.go): consumed by `MemoryHandler` (memory.go) which is consumed by both the SDK routes AND the BFF `DashboardMemoryHandler` (dashboard_memory.go delegates to it). Adding `Remember/Recall/Reflect` to the client + handler is additive.
- `DashboardMemoryHandler`: mounted at `/v1/dashboard/memory/*` in `main.go` (this session). Adding verbs = add methods + mount routes.
- Dashboard memory pages: call `cloudFetch('/v1/dashboard/memory/*')` (metrics/list/entities/forget repointed this session); exports/webhooks still on `/v1/memory/*` (the 401).
- TheMemory `app.ts`: registers verb handlers; `registerAllPaths` (openapi). New handlers register the same way.

### Domain glossary
- **BFF** — Backend-For-Frontend: the gateway mints a server-side `theo_live_*` key from the browser session and proxies to TheMemory; the secret never reaches the browser.
- **scope tier** — `user` / `session` / `agent` (TheMemory partitions within a workspace).
- **reflect** — TheMemory consolidation pass (episodic → semantic) returning a `ReflectionResult`.
- **recall** — semantic + BM25 + entity hybrid search returning scored `MemoryItemWithScore[]`.
- **scope aggregate** — count / distinct-scope-id over a workspace's `memories` rows (the basis for real metrics/entities).

### Architecture boundaries affected
- theo-cloud → theo-memory is **HTTP-only** (no Go import). New verbs extend the `themory.Client` HTTP contract; `openapi/themory.yaml` (consumer subset) updated in sync.
- theo-cloud dashboard → gateway is **same-origin** (vite proxy / Caddy). New routes under `/v1/dashboard/memory/*`.
- theo-memory: `src/server/` stays pg-free (DIP); aggregate queries live in `src/core/infrastructure/db` behind the `Memory`/store interface. New handlers consume the `Memory` contract, not raw SQL.

## Prior Art & Related Work
- **This-session artifacts:** `tests/e2e/` harness (real round-trip), `dev/` dev stack (make dev-up), the BFF wiring + conform-to-provider client (CHANGELOG [Unreleased]).
- **Internal pattern:** `dashboard_memory.go` `mintOrFail` BFF pattern (the canonical session→key path) — extend it.
- **TheMemory contract:** `ADR-0004` (verbs remember/recall/forget/reflect), `ADR-0008` (DIP method counts), `themory-category-filter-server-side` (server-side filter precedent for adding scope-list query params).
- No external literature needed — this is internal wiring of an existing API to an existing UI.

## ADRs

### D1 — ADR: All dashboard memory operations go through the BFF (`/v1/dashboard/memory/*`)
**Decision:** extend `DashboardMemoryHandler` to cover remember / recall / reflect / exports / webhooks, mounted under `/v1/dashboard/memory/*` with `requireJWT`. The dashboard calls ONLY this prefix for memory.
**Rationale:** single auth path for the browser (session JWT → minted key). The `/v1/memory/*` SDK surface stays theo_live_*-only (`memory.go` comment: distinct middleware so a session can never be an SDK key). Honors DIP — the BFF delegates to the same `MemoryHandler`. Cites `architecture.md` HTTP-seam rule.
**Alternatives rejected:** (a) grant the session JWT direct access to `/v1/memory/*` — breaks the SDK/browser auth split (security). (b) a BFF-exchange middleware that rewrites the bearer in place — more moving parts than mounting explicit BFF routes; harder to test.

### D2 — ADR: TheMemory gains real `GET /v1/metrics` + `GET /v1/entities` (DB-derived aggregates)
**Decision:** add two read endpoints to `@usetheo/memory/server`, workspace-scoped, computed from the `memories` table via the `Memory`/store contract: `metrics` = `{ total_memories, add_events, entity_count, retrieval_api_usage }`; `entities` = aggregation by `(scope_type, scope_id)`.
**Rationale:** the gateway/dashboard need real counts; deriving in the gateway is O(scope) + can't compute distinct entities. Classified P0 hardening (owner goal directive) — correctness of an already-shipped surface, not a frozen feature. Cites `ADR-0008` (read-only, within DIP method budget).
**Alternatives rejected:** (a) keep deriving in the gateway — can't compute distinct entities or usage; O(scope) per request. (b) a dedicated metrics counter table — premature; DB-derived aggregates suffice for the counts we can honestly produce.
**Honest sub-decision (D2a):** `retrieval_api_usage` has no persisted source (recall calls are not logged). It returns `0` with a documented caveat (a recall-counter is a separate follow-up). `add_events` = count of `history` remember rows; `entity_count` = distinct scope ids; `total_memories` = active rows. No fabricated numbers.

**AMENDMENT (implementation, 2026-06-19) — owner-decided via AskUserQuestion:**
- **Scope = SUBJECT, not workspace.** The gateway uses ONE master key = ONE workspace for ALL customers, isolating by `subject`-in-path. A workspace-scoped `/v1/metrics` would leak cross-customer aggregates to a single customer (a cross-tenant data leak). The correct shape is therefore subject-scoped sibling endpoints mirroring the existing `GET /v1/scopes/:type/:id/memories`, NOT a workspace-level `/v1/metrics`. This supersedes the "workspace-scoped" wording above.
- **`entities` endpoint SHIPPED — derived from `attributed_to`, NOT the unpopulated `entities` table.** The standalone `entities` table (`schema.ts`) is workspace-global, has NO subject/scope linkage, and is **never populated by the current write pipeline** (`entityBoost` is a scoring normalizer; zero `INSERT INTO entities` in `packages/**`). Building an NER extraction-persist pipeline over it is a P0-frozen feature (owner design). Instead, the real subject-scoped `GET /v1/scopes/:type/:id/entities` aggregates the distinct `attributed_to` peers (the v1.1 multi-peer attribution column — a REAL populated source = "who the agent remembers facts about/from") with `memory_count` + `last_seen_at`, computed from `getAll()`. Real data today, no migration, no new pipeline. Richer NER extraction remains a noted follow-up.
- **`metrics` endpoint SHIPPED.** Real subject-scoped `GET /v1/scopes/:type/:id/metrics` computed from `getAll()`: `total_memories` + `entity_count` (distinct `attributed_to`) + `add_events` are REAL; `retrieval_api_usage` is honest-0 (no persisted recall counter — a follow-up). The gateway dropped its O(scope) derivation in favor of this endpoint.
- **`from`/`to` filter (the third part of this ADR's spirit) SHIPPED** in `GET /v1/scopes/:type/:id/memories` (server-side `created_at` range, 422 on invalid datetime) — see ADR D3. This is the part of Phase 2 that had clean semantics + real value + full test coverage.

### D3 — ADR: Date range (`from`/`to`) becomes a REAL filter on the scope list
**Decision:** add optional `from`/`to` (RFC3339) query params to `GET /v1/scopes/:type/:id/memories`, filtering by `created_at` in the store; thread through the gateway client + the Memories page (the inputs already exist).
**Rationale:** the UI already exposes the inputs; a no-op control is dishonest (Inquebrável Rule 3). The predicate is a small `createdAt BETWEEN` clause — precedent: `themory-category-filter-server-side` added `category` the same way.
**Alternatives rejected:** remove the From/To inputs — loses real UX value the page was designed for; the SQL predicate is cheap.

### D4 — ADR: Hard-delete surfaced as an explicit, gated checkbox
**Decision:** the dashboard forget ConfirmDialog gains a "Permanently erase (GDPR, cannot be recovered)" checkbox → sends `{hard:true}` through the BFF forget.
**Rationale:** `forget {hard}` exists in the API (GDPR escape hatch); soft-delete stays the default. Gating behind a checkbox + the existing typed-confirmation prevents accidental hard erasure.
**Alternatives rejected:** always hard-delete — destroys the soft-delete audit trail (Princípio 3). Separate button — clutters the row; the dialog is the right place.

### D5 — ADR: Playground is one page with three panels (remember / recall / reflect)
**Decision:** a single `/memory/playground` page with a scope selector + three panels: Remember (text → write), Recall (query → scored results), Reflect (button → result). All via `/v1/dashboard/memory/*`.
**Rationale:** matches the "Try Playground — remember and recall live, no code required" promise already in the Explore card. One page keeps the verbs discoverable together (KISS).
**Alternatives rejected:** three separate pages — over-fragments a demo surface; YAGNI.

## Dependency Graph

```
Phase 1 (gateway verbs: client + handlers + BFF + routes)  ─┐
Phase 2 (TheMemory metrics+entities endpoints)             ─┤→ Phase 3 (dashboard UI)
                                                            │     ├ Playground (needs P1)
                                                            │     ├ Overview real metrics (needs P2)
                                                            │     ├ Entities real (needs P2)
                                                            │     ├ Exports/Webhooks via BFF (needs P1)
                                                            │     ├ date filter (needs P1 D3)
                                                            │     └ hard-delete (needs P1)
                                                            └────────────→ Phase 4 (e2e + browser + /review → READY_TO_MERGE)
```
- Phase 1 and Phase 2 are INDEPENDENT (parallelizable). Phase 3 depends on both. Phase 4 depends on Phase 3.

## Phase 1 — Gateway: remember / recall / reflect proxy + BFF for all memory ops

### T1.1 — `themory.Client` gains Remember / Recall / Reflect (conform to real REST)
#### Why this step
Action: add three methods to `internal/themory/client.go` calling `POST /v1/remember`, `POST /v1/recall`, `POST /v1/reflect` with the real body shapes (`schemas.ts`), scoping by subject-in-path-equivalent (scope tier in body).
Reasoning: the client is the only HTTP path to TheMemory (ADR D1 of conform-to-provider). The handlers + BFF reuse it. Bodies mirror `RememberBody`/`RecallBody`/`ReflectBody` exactly to avoid contract drift.
#### Files to edit
- `internal/themory/client.go` (+ `Remember`, `Recall`, `Reflect` + result structs)
- `openapi/themory.yaml` (add the 3 endpoints to the consumer subset)
#### Deep file dependency analysis
`do()` lifecycle (Authorization Bearer master + JSON) is reused; new methods marshal request bodies. No existing caller breaks (additive).
#### TDD
- RED: `internal/themory/remember_recall_reflect_test.go` — stub server asserts POST path + body `{text, userId}` / `{query, userId, topK}` / `{userId}`; decodes responses. `themory.IsNotFound` on 404.
- GREEN: implement.
- REFACTOR: share request-body marshalling.
#### Concurrency tests
(none — single-threaded). The `http.Client` is goroutine-safe by construction; each request is independent.
#### Failure scenarios
- TheMemory 5xx on remember/recall/reflect → `*themory.Error` surfaced (test with stub 503). 404 → ErrNotFound.
#### Acceptance criteria
- `go test ./internal/themory/...` green; requests conform to `openapi/themory.yaml` (contract test extended).
#### DoD
- `go build ./... && go vet ./...` clean; contract test asserts the 3 new requests.

### T1.2 — `MemoryHandler` gains Remember / Recall / Reflect (SDK-scope handlers)
#### Why this step
Action: add `Remember`/`Recall`/`Reflect` handlers to `internal/routes/memory.go` that read the authenticated subject, build the scope, call the client, and return JSON.
Reasoning: the BFF (`DashboardMemoryHandler`) delegates to `MemoryHandler` (existing pattern). Implementing here keeps one handler used by both SDK + BFF surfaces (DRY).
#### Files to edit
- `internal/routes/memory.go` (+ 3 handlers + the `TheMemoryClient` interface gains Remember/Recall/Reflect)
- `tests/unit/memory_handlers_test.go` (fake client gains the 3 methods)
#### Deep file dependency analysis
`TheMemoryClient` interface is implemented by the real client + the unit-test fake. Both must add the 3 methods. `auth.GetUser(ctx)` provides the subject.
#### TDD
- RED: handler tests — 401 when no user; 201/200 on success; 502 on upstream error; subject derived from auth not body.
- GREEN: implement.
#### Concurrency tests
(none — single-threaded). Request handlers process one request each; no shared mutable state.
#### Failure scenarios
- upstream 502 → `MEMORY_UPSTREAM_UNAVAILABLE`; invalid body → 400.
#### Acceptance criteria
- `go test ./tests/unit/... ./internal/routes/...` green.
#### DoD
- build+vet clean; fake + real client both satisfy the interface.

### T1.3 — `DashboardMemoryHandler` wraps remember/recall/reflect + exports/webhooks
#### Why this step
Action: add `Remember`/`Recall`/`Reflect` to `dashboard_memory.go` (mint→delegate) AND wire the existing exports/webhooks handlers behind the BFF mint (closes the 401, gap 4).
Reasoning: ADR D1 — the dashboard's single auth path. `mintOrFail` already exists; reuse it.
#### Files to edit
- `internal/routes/dashboard_memory.go` (+ Remember/Recall/Reflect; + exports/webhooks delegation)
- `tests/unit/dashboard_memory_test.go` (mint-then-delegate assertions)
#### Deep file dependency analysis
`mintOrFail` discards the secret (security invariant). Exports/Webhooks handlers (`memory_exports.go`, `memory_webhooks.go`) are delegated to after mint.
#### TDD
- RED: tests assert mint happens before delegate; 401 without session; secret never written to response.
- GREEN: implement.
#### Concurrency tests
(none — single-threaded). Handler-level; the BFF vault mint is covered by its own concurrency tests.
#### Failure scenarios
- vault mint failure → 500 VAULT_ERROR (existing pattern, test it for the new verbs).
#### Acceptance criteria
- `go test ./tests/unit/...` green.
#### DoD
- build+vet clean.

### T1.4 — Mount BFF routes (remember/recall/reflect/exports/webhooks) in `main.go`
#### Why this step
Action: under `r.Route("/v1/dashboard/memory", ...)` (requireJWT), add `POST /remember`, `POST /recall`, `POST /reflect`, and the exports/webhooks routes (delegating to the BFF).
Reasoning: completes the BFF surface so the dashboard reaches every memory op via one prefix.
#### Files to edit
- `cmd/main.go` (route registration)
#### Deep file dependency analysis
`requireJWT` middleware + `dashboardMemoryHandler` (wired this session). Additive route block.
#### TDD
- RED: an integration-style test (httptest app) asserting the routes exist + require JWT. (Or covered by the e2e in Phase 4 — mark which.)
- GREEN: implement.
#### Concurrency tests
(none — single-threaded). Route registration is composition-root wiring at boot; no runtime shared state.
#### Acceptance criteria
- routes resolve; `go build ./...` clean.
#### DoD
- build+vet clean; routes mounted only when `dashboardMemoryHandler != nil`.

## Phase 2 — TheMemory: real metrics + entities endpoints (P0 hardening)

### T2.1 — `GET /v1/metrics` (workspace scope aggregate)
#### Why this step
Action: add `metricsHandler` + register in `app.ts`; compute `{ total_memories, add_events, entity_count, retrieval_api_usage }` via a store aggregate (count active rows; distinct scope ids; count history remember rows; retrieval=0 per ADR D2a).
Reasoning: the gateway/dashboard need real counts (gap 5). Read-only, workspace-scoped, behind the Memory contract (DIP).
#### Files to edit
- `packages/api/src/server/handlers/metrics.ts` (NEW)
- `packages/api/src/server/app.ts` (register `GET /v1/metrics`)
- `packages/api/src/server/openapi-registration.ts` (document)
- `packages/core/src/infrastructure/db/scoped-memory.ts` (+ aggregate query) OR a new store method
#### Deep file dependency analysis
`workspaceBoundMemory(c, memory)` scopes by the Principal's workspace. The aggregate query runs against `memories` + `history` filtered by workspace.
#### TDD
- RED: `tests/integration/.../metrics.test.ts` against real pgvector — seed N memories across M scopes → metrics returns `total=N`, `entity_count=M`, `add_events≥N`, `retrieval=0`.
- GREEN: implement.
- REFACTOR: extract the aggregate into the store.
#### Concurrency tests
(none — single-threaded). Read-only aggregate; no shared mutable state.
#### Failure scenarios
- empty workspace → all zeros (never null/NaN); DB down → 503 health-consistent error.
#### Acceptance criteria
- integration test green vs real pgvector (`pnpm --filter @usetheo/memory-api test`); `GET /v1/openapi.json` contains the path `/v1/metrics` (assert response body contains `"/v1/metrics"`).
#### DoD
- `npm test` (contract) + `npm run test:integration` green for the new file; typecheck+lint clean.

### T2.2 — `GET /v1/entities` (scope aggregation)
#### Why this step
Action: add `entitiesHandler` returning `{ entities: [{ id, scope_type, memory_count, last_seen_at }] }` aggregated by `(scope_type, scope_id)` within the workspace, filterable by `?scope=`.
Reasoning: gap 6 — the Entities page is permanently empty without this.
#### Files to edit
- `packages/api/src/server/handlers/entities.ts` (NEW)
- `packages/api/src/server/app.ts` (register)
- `packages/api/src/server/openapi-registration.ts`
- `packages/core/src/infrastructure/db/scoped-memory.ts` (+ group-by query)
#### TDD
- RED: integration test — seed memories under 2 users + 1 session → `?scope=user` returns 2 rows with correct `memory_count` + `last_seen_at`.
- GREEN: implement.
#### Concurrency tests
(none — single-threaded). Read-only aggregation query.
#### Failure scenarios
- unknown scope → empty list (not error); empty workspace → `[]`.
#### Acceptance criteria
- integration test green (`pnpm --filter @usetheo/memory-api test`); response `entities[].memory_count` equals the seeded count (assert `entity_count == 3` for a 3-entity seed).
#### DoD
- typecheck+lint+integration green.

### T2.3 — Gateway consumes the real metrics/entities endpoints
#### Why this step
Action: update `themory.Client.Metrics`/`Entities` to call the new `GET /v1/metrics` / `GET /v1/entities` (drop the O(scope) derivation + the empty stub).
Reasoning: closes the gateway side of gaps 5+6.
#### Files to edit
- `internal/themory/client.go` (Metrics/Entities → real endpoints)
- `openapi/themory.yaml` (add the 2 endpoints)
- `tests/unit/themory_client_test.go` (update)
#### TDD
- RED: stub server returns metrics/entities JSON → client maps to `MetricsResult`/`EntitiesResult`.
- GREEN: implement.
#### Concurrency tests
(none — single-threaded). HTTP client call mapping; no shared mutable state.
#### Acceptance criteria
- `go test ./internal/themory/...` green.
#### DoD
- build+vet clean; contract test updated.

## Phase 3 — Dashboard UI

### T3.1 — Playground page (remember / recall / reflect)
#### Why this step
Action: new `dashboard/src/pages/memory/playground.tsx` — scope selector + Remember panel (textarea→write), Recall panel (query→scored list), Reflect button (→result). Calls `/v1/dashboard/memory/{remember,recall,reflect}`.
Reasoning: ADR D5 — the missing write/search/reflect UI; fulfills the existing "Try Playground" promise.
#### Files to edit
- `dashboard/src/pages/memory/playground.tsx` (NEW)
- `dashboard/src/app.tsx` (route `/memory/playground`)
- `dashboard/src/components/layout/app-sidebar.tsx` (memory submenu: Playground)
- `dashboard/src/pages/memory.tsx` (Explore "Try Playground" href → `/memory/playground`)
#### TDD
- RED: `playground.test.tsx` (vitest) — remember submits + shows success; recall renders results; reflect shows result. Mocks the BFF endpoints.
- GREEN: implement with DS primitives (PageShell + space-y-6 wrapper + Card.Body — per this session's standardization).
#### Concurrency tests
(none — single-threaded). React event handlers; react-query serializes the mutations per panel.
#### Acceptance criteria
- vitest green (`pnpm --filter dashboard test`); uses `PageShell` + `space-y-6` wrapper (layout standard); grep shows no ad-hoc `pt-`/`p-` overrides in the new page.
#### DoD
- `npm test` (dashboard) green; `tsc -b` clean; browser-validated in Phase 4.

### T3.2 — Repoint Exports/Webhooks to the BFF + hard-delete + date filter
#### Why this step
Action: (a) `exports.tsx` + `webhooks.tsx` → `/v1/dashboard/memory/{exports,webhooks}/*` (closes 401, gap 4); (b) forget ConfirmDialog (memories + entities) gains the hard-delete checkbox → `{hard}` (gap 8); (c) Memories From/To inputs thread `from`/`to` into the list call (gap 7, ADR D3).
Reasoning: closes the remaining dashboard-side gaps with the real endpoints.
#### Files to edit
- `dashboard/src/pages/memory/exports.tsx`, `dashboard/src/pages/memory/webhooks.tsx` (BFF paths)
- `dashboard/src/pages/memory/memories.tsx` (hard-delete checkbox + from/to wired; forget body `{hard}`)
- `dashboard/src/pages/memory/entities.tsx` (hard-delete on cascade)
- `internal/themory/client.go` + `internal/routes/*` (thread `from`/`to` + `hard` if not already)
#### TDD
- RED: vitest — exports/webhooks call BFF path; hard-delete sends `{hard:true}`; from/to appear in the list query.
- GREEN: implement.
#### Concurrency tests
- The entities cascade-forget runs N parallel `Promise.all` calls bounded at `FORGET_CONCURRENCY=5`. RED: a vitest with a deterministic mock counts max in-flight calls and asserts an atomic-counter invariant `maxInFlight <= 5` (parallel test) — proves the bound holds under concurrent dispatch, not just happy-path.
#### Acceptance criteria
- vitest green; no `/v1/memory/*` (SDK) call remains in dashboard memory pages (grep gate).
#### DoD
- dashboard tests green; `tsc -b` clean.

## Coverage Matrix

| Gap (cross-validation) | Task(s) |
|---|---|
| 1. remember (write) | T1.1, T1.2, T1.3, T1.4, T3.1 | DONE — gateway + BFF + Playground UI, tested |
| 2. recall (search) | T1.1, T1.2, T1.3, T1.4, T3.1 | DONE — gateway + BFF + Playground UI, tested |
| 3. reflect | T1.1, T1.2, T1.3, T1.4, T3.1 | DONE — gateway + BFF + Playground UI, tested |
| 4. Exports/Webhooks 401 | T1.3, T1.4, T3.2 | DONE — BFF fronts both; dashboard repointed, tested |
| 5. real metrics | T2.1 + T2.3 (D2 amendment) | DONE — real subject-scoped `GET /v1/scopes/:type/:id/metrics` (total/entity_count/add_events real, retrieval honest-0); gateway consumes; Overview shows real KPIs. Tested |
| 6. real entities | T2.2 + T2.3 (D2 amendment) | DONE — real subject-scoped `GET /v1/scopes/:type/:id/entities` (distinct `attributed_to` peers + counts + last_seen_at); gateway consumes; Entities page shows real data. Tested. (Richer NER extraction is a noted follow-up; `attributed_to` is the real populated source today) |
| 7. date filter from/to | T3.2 + ADR D3 + scopes.ts | DONE — server-side `created_at` filter in TheMemory + gateway thread + dashboard wiring, tested |
| 8. hard-delete | T3.2 + ADR D4 | DONE — `?hard=true` through client + handler + BFF + Memories ConfirmDialog checkbox, tested |
| READY_TO_MERGE | Phase 4 | gateway + dashboard + theo-memory suites GREEN; browser/e2e pending live-stack run |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Cross-repo change (theo-memory + theo-cloud) merged out of order breaks the gateway (new endpoints absent) | HIGH | Merge theo-memory (Phase 2 endpoints) FIRST; gateway tolerates 404 (Entities falls back to empty per existing client code) until deployed | impl |
| `retrieval_api_usage` has no real source → honest 0 may read as "broken" | MEDIUM | ADR D2a documents it; UI shows 0 with a tooltip/caption "not yet tracked"; follow-up counter task noted | impl |
| TheMemory is P0-frozen; new endpoints could be seen as scope creep | MEDIUM | Classified P0 hardening per owner goal directive; recorded in CLAUDE.md roadmap + CHANGELOG | owner |
| BFF now fronts exports/webhooks (admin scope) — minted key needs `memory:admin` | MEDIUM | BFF vault mints with the full bff scope set (`memory:read/write/delete`); add `memory:admin` to the bff scope JSON OR keep exports/webhooks on a separate admin path — decide in T1.3 | impl |
| Dashboard prod build TDZ (manualChunks) pre-existing | LOW | dev stack uses vite dev (this session); prod-build fix is a separate tracked item | owner |

## Unresolved Questions
- **Q1 (T1.3) — RESOLVED (2026-06-19):** the BFF-minted key does NOT need `memory:admin`. The BFF fronts exports/webhooks by minting (audit/revoke bookkeeping only) then calling the ops handler method DIRECTLY (`memoryExportsHandler.Create` etc.) — it does NOT route through the SDK `/v1/memory/*` `RequireScope` middleware. The actual upstream call to TheMemory uses the master `THEMORY_API_KEY` (per `mintOrFail` invariant). So the minted key's scope set is never consulted on the ops path; no scope widening was needed. No security regression (the session JWT still gates the BFF route via `requireJWT`).
- Otherwise: (none — every other decision resolved at plan time via ADRs D1-D5).

## Failure scenarios
- **TheMemory unreachable** (gateway → themory): every BFF verb returns `502 MEMORY_UPSTREAM_UNAVAILABLE` (tested in T1.2). Reproduced by pointing `THEMORY_BASE_URL` at a closed port in a unit stub.
- **TheMemory 404 on metrics/entities** (deploy-order skew): gateway client treats 404 as empty/zero (no crash) — tested in T2.3.
- **Vault mint failure**: BFF verbs return `500 VAULT_ERROR` (tested in T1.3).
- **pgvector down** (TheMemory metrics/entities): handler returns a health-consistent error, not a partial/NaN payload (tested in T2.1/T2.2 with a closed pool).

## Global Definition of Done
- [ ] All task DoDs checked.
- [ ] `theo-cloud`: `go build ./... && go vet ./... && go test ./... -race` green; dashboard `npm test && tsc -b && npm run lint` green.
- [ ] `theo-memory`: `npm run typecheck && npm run lint && npm test && npm run test:integration` green for new/changed files.
- [ ] CHANGELOG updated in BOTH repos.
- [ ] No dashboard memory page calls `/v1/memory/*` (SDK) — all via `/v1/dashboard/memory/*` (grep gate).
- [ ] No `// TODO`/`// FIXME` in changed src; no fabricated metrics (ADR D2a honesty).
- [ ] Plan archived to `plans/completed/` after merge.

## Final Phase — Phase 4: Integration Validation (the READY_TO_MERGE gate)

### T4.1 — Extend `tests/e2e` for the full surface
- Round-trip: seed via **BFF remember** → **BFF recall** returns it → **reflect** runs → **list** shows it → **forget (hard)** removes it.
- Assert **metrics** returns real `total`/`entity_count`/`add_events` after seeding.
- Assert **entities** returns the seeded scope.
- Assert **Exports + Webhooks** endpoints return 2xx (no 401) via the session path.
- All against real `ankane/pgvector:v0.5.1` + real TheMemory + gateway (`make e2e`).
#### Concurrency tests
(none — single-threaded). The e2e is a sequential round-trip; the bounded-parallel cascade invariant is covered by T3.2's atomic-counter test.

### T4.2 — Browser validation (chrome-devtools on `make dev-up`)
- Playground: write a memory, recall it (scored result), run reflect — all 200, rendered.
- Overview: KPIs show real non-zero counts after seeding.
- Entities: shows the seeded entity rows (non-empty).
- Memories: date filter narrows results; hard-delete erases.
- Exports + Webhooks: load with 200 (zero 401 in console network).
- Console: zero errors except the known engine `/engine/*` 502.
#### Concurrency tests
(none — single-threaded). Manual browser walkthrough; no concurrent assertions.

### T4.3 — `/review` → READY_TO_MERGE
- Run `/review theo-memory-dashboard-full-integration`; resolve every BLOCKER/HIGH inline.
- Verdict `READY_TO_MERGE` with 0 BLOCKER. Goal's Stop condition.
#### Concurrency tests
(none — single-threaded). Review is a process gate; the `-race` suite runs in the Global DoD.
