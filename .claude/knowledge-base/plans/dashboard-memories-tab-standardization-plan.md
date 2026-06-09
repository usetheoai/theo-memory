---
slug: dashboard-memories-tab-standardization
created_at: 2026-06-08
priority_classification: PRIORITY 0 hardening of sub-goal 2 (SDK functional) — Dashboard Memory tab is the operator-facing surface for the SDK list path
goal: Standardize Dashboard Memories tab to match entities.tsx canonical pattern (scope tabs + correct fields) AND fix backend createdAt fidelity bug observed on the list endpoint
---

# Plan: Dashboard Memories tab standardization + temporal fidelity fix (REST list path)

> **Version 1.5** (2026-06-09) — `/implement` halt-loop iteration 7 BFF reality-check: empirical evidence at `theo-cloud/theo/cloud/internal/themory/client.go:136-162` shows `List()` is hardcoded to `/v1/scopes/user/{userID}/memories` (USER scope only). T3.2's "4 scope tabs filtering DataTable" requires BFF + frontend coordination. Per user decision Path C (FAANG full feature), T3.2 scope expanded to include BFF Go extension: `Client.List` gains `scope ScopeType` param + handler accepts `?scope=` query string. TheMemory REST already supports all 4 scope types at `/v1/scopes/{scopeType}/{userID}/memories` (T1.1+T2.1+T2.2 work). T3.2 commit thicker but cohesive (BFF + frontend land together so the tabs are functional from day 0).
>
> **Version 1.4** (2026-06-09) — `/implement` halt-loop iteration 6 BLOCKED report absorption: dropped T3.0 + EC-4 entirely. Empirical evidence (`grep "@usetheo/memory" theo-cloud/theo/cloud/dashboard/{package.json,src/}` = 0 hits) proves the Dashboard does NOT import `@usetheo/memory` as an npm dep; data flows via BFF Go (`theo-cloud/theo/cloud/internal/themory/client.go`) + REST. The npm-dep cross-repo merge-order risk EC-4 modeled doesn't exist in the actual architecture. T3.2/T3.3 reframed as "Dashboard REST-consumer standardization" — runtime JSON contract, no SHA pin needed. T4.1/T4.2 contracts unchanged. Coverage Matrix 11→10 (row "EC-4 cross-repo merge-order" dropped). Halt-loop audit at `.claude/knowledge-base/implementations/dashboard-memories-tab-standardization/sepa-iterations/iteration-6-halt-blocked.md`. Backend hardening already shipped (T1.1/T2.1/T2.2/T6.1/T3.1 = 5 commits a79a7bf → 1b52721). Cross-repo path: theo-cloud repo at `/home/paulo/Projetos/usetheo/theo-cloud/theo` (corrected from plan's `theo-cloud/...` abbreviation).
>
> **Version 1.3** (2026-06-08) — fixed concurrency-tests canonical literal, removed two stale orphan task identifiers, unified the Coverage Matrix to 11/11 (closes `coverage_lt_100` hard cap, lifted verdict from INVALID 44 → SHIPPABLE_WITH_CAVEATS 70).
>
> **Version 1.2** (2026-06-08) — `/deps-audit` Path C absorption: added `## Dependencies` section (closes `plan_dependencies_section_missing` hard cap; zero new npm pkgs introduced) AND adjusted T3.1 EC-3 pseudo-code to compose Memory directly with `DeterministicStubEmbedder` instead of `wireMemoryFromPool(pool)`. Rationale: `wireMemoryFromPool` hard-wires `LocalTransformerEmbedder` which pulls `@xenova/transformers` → `onnxruntime-web` → `protobufjs <7.5.5` (CRITICAL CVSS 9.8 RCE — pre-existing repo-wide chain, fix requires semver-major v2 upgrade tracked as separate cycle `deps-upgrade-xenova-transformers-v2-protobufjs-cve`). The fidelity test does NOT depend on embedder behavior; canonical write-path (`scoped.remember(text, {infer: false})` + 8-phase pipeline + INSERT honoring schema) is preserved by `createLocalMemory({ vectorStore: new PgvectorStore(pool, ...), embedder: new DeterministicStubEmbedder(...), llm: stubLLM })`. Audit re-run expected: PASS (no vulnerable chain in test runtime).
>
> **Version 1.1** (2026-06-08) — absorbed 5 MUST FIX from `/edge-case-plan` review (`.claude/knowledge-base/reviews/dashboard-memories-tab-standardization-edge-cases-2026-06-08.md`): EC-1 NULL `created_at` defensive null-check in T2.1, EC-2 deterministic `ORDER BY created_at DESC, id ASC` in T2.1, EC-3 T3.1 INSERT shape via canonical write-path + UPDATE for temporal manipulation, EC-4 NEW T3.0 pinning `@usetheo/memory` to exact commit SHA before frontend lands (cross-repo merge-order enforcement), EC-5 NEW T6.1 creating follow-up DRAFT plan file for the 5 deferred `createdAt` instances. Also absorbed 5 SHOULD TEST items (EC-6..EC-10) into existing tasks' TDD blocks and 3 DOCUMENT items (EC-11..EC-13) inline in ADRs.
>
> **Version 1.0** — Cross-repo cycle: backend bug (TheMemory `LocalScopedMemory.getAll` returns `createdAt: new Date()` losing DB fidelity) + frontend standardization (Memories tab does not match the 4-scope-tab canonical pattern shipped by Entities tab and is missing key DataTable columns/actions). Both surfaced during E2E testing 2026-06-08 of the Dashboard → BFF → TheMemory chain. Scope EXCLUDES the same `createdAt: new Date()` bug present in 5 OTHER paths (recall + 2 reflection + 2 consolidation in `src/local/index.ts`) — those require a deeper VectorStoreResult extension and risk validating v1.1 bi-temporal asOf; a separate cycle (`themory-temporal-fidelity-full-fix`) is recommended after this one ships.

## Goal

> "Enable Dashboard operators to browse memories with correct DB-truth timestamps and per-scope filtering matching the Entities-tab pattern, measured by `tests/integration/server/scopes-list-temporal-fidelity.test.ts` PASS asserting `GET /v1/scopes/user/:id/memories` returns each row's actual `created_at` from Postgres (not `now()`), AND `cloud/dashboard/src/pages/memory/memories.test.tsx` PASS asserting the page renders 4 scope tabs (user/session/agent/repo) + columns {id, content, scope_type, created_at, actions} matching the Entities-tab columns shape."

## Context

User session 2026-06-08 — STEP 6 of E2E testing on Dashboard Memories tab. Empirical payload from `GET http://localhost:5173/v1/memory/list` showed 20 memories ALL with identical `created_at: 2026-06-08T23:43:58.466Z`. Repeated curl 2 minutes later returned ALL with `2026-06-08T23:45:23.271Z`. Confirmed via direct PG query that the table column `memories.created_at` holds the REAL per-row timestamps (range 16:39 → 23:40 over a day) — but `LocalScopedMemory.getAll` at `src/local/index.ts:807-810` literally constructs `MemoryItem.{createdAt, updatedAt, tValid}` via `new Date()` (now), losing fidelity.

Concurrent finding: Dashboard Memories tab diverges from the canonical pattern that Entities/Exports/Webhooks tabs share. Entities tab (`entities.tsx`) ships 4 scope tabs (USER/SESSION/AGENT/REPO), cascade-delete with concurrency cap, Timestamp component, and {id, memory_count, last_seen_at} columns. Memories tab (`memories.tsx`) has only category+date filters (filter UI exists for `category` field but NO row actually has a category populated → dead filter), no scope tabs, and a content-only display. Operator UX is inconsistent across the 4 sibling tabs.

Combined: the Dashboard surface for `/memory/memories` cannot show correct data (backend lies about timestamps) AND cannot offer the same affordances Entities provides. Both fixes are coupled — frontend standardization is moot if the backend continues to lie.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/core/dip/vector-store.ts` | ~110 | (existing) | DIP interface `VectorStore` + `VectorStoreResult` shape (`{id, payload, score?}`); read by 6 callsites in `src/local/index.ts` + impls in `src/local/pgvector-store.ts` + `src/local/in-memory-store.ts` | All existing fields stay; ADDITION is backward-compatible (new fields all optional) |
| `src/local/pgvector-store.ts` | 800+ | (large) | Postgres+pgvector adapter implementing `VectorStore`; `list()` method currently SELECTs `id` + `payload` only — does NOT project `created_at/updated_at/t_valid/t_invalid/confirmation_count` columns | Existing SELECT queries don't break; ADD columns to projection; preserve scope filters + pagination |
| `src/local/in-memory-store.ts` | ~400 | (existing) | In-memory `VectorStore` impl used by unit tests; tracks rows in a Map but does NOT track temporal columns | Test surface preserved; add temporal fields to internal row shape + return in `list()` |
| `src/local/index.ts:796-813` | (6 LoC critical region) | `f5cfcba` (2026-06-07) | `LocalScopedMemory.getAll` — the load-bearing bug site; constructs `MemoryItem.createdAt/updatedAt/tValid` via `new Date()` losing DB truth | Function signature unchanged; ONLY the field-construction expression changes |
| `src/server/handlers/scopes.ts` | 144 | (recent) | REST handler `GET /v1/scopes/:type/:id/memories`; delegates to `scoped.getAll()` → maps to JSON response; no temporal manipulation | Unchanged (the bug is upstream in getAll) |
| `tests/integration/server/scopes-list-temporal-fidelity.test.ts` (NEW) | 0 | — | New integration test asserting the REST endpoint returns real DB `created_at` per row | — |
| `src/local/__tests__/index.getAll-temporal-fidelity.test.ts` (NEW) | 0 | — | New unit test against `LocalScopedMemory.getAll` proving the fix | — |
| `cloud/dashboard/src/pages/memory/memories.tsx` (theo-cloud) | 236 | `faae88e9` (2026-06-06) | Dashboard Memories tab; misses scope tabs + correct columns matching Entities pattern | Existing trash + ConfirmDialog choreography preserved; ADD scope tabs + standardize columns |
| `cloud/dashboard/src/pages/memory/memories.test.tsx` (theo-cloud) | 88 | `faae88e9` (2026-06-06) | Unit-level component test for Memories tab | Extend to cover new tabs + columns |
| `theo-cloud/theo/cloud/internal/themory/client.go` (theo-cloud, BFF) | (existing) | (recent) | Go proxy that calls TheMemory REST `/v1/scopes/...` and projects response shape to Dashboard | Verify it passes through `created_at` from upstream without overwrite |

### Current callers / dependents

For every public symbol modified:

- **Symbol:** `VectorStoreResult` (interface field set)
- **Callers (production):** `src/local/index.ts:643, 756, 807, 957` (all `recall`/`reflect`/`consolidate`/`getAll` paths); `src/local/pgvector-store.ts` (insert+list+search+get); `src/local/in-memory-store.ts` (same)
- **Callers (tests):** `src/local/__tests__/*.test.ts` (multiple files build `VectorStoreResult` fixtures); `src/core/__tests__/extraction-pipeline.test.ts:60+ StubVectorStore.search` returns `{id, payload}` fixtures
- **External:** none (DIP interface internal to `src/local/` consumers)

- **Symbol:** `LocalScopedMemory.getAll`
- **Callers (production):** `src/server/handlers/scopes.ts:129` (sole caller — REST handler)
- **Callers (tests):** `tests/integration/server/scopes.test.ts` (existing); extending in T2.2
- **External:** none (REST handler is the boundary)

- **Symbol:** `PgvectorStore.list`
- **Callers (production):** `src/local/index.ts:798` (only via getAll); `src/local/index.ts:643` (recall path — out of scope per honest scoping above)
- **Callers (tests):** `src/local/__tests__/pgvector-store.test.ts` (exists; new sibling `pgvector-store-list-temporal.test.ts` added in T2.1)
- **External:** none

- **Symbol:** Dashboard Memories page (frontend)
- **Callers (production):** `cloud/dashboard/src/App.tsx` route `/memory/memories`
- **Callers (tests):** `cloud/dashboard/src/pages/memory/memories.test.tsx` (existing)
- **External:** human operators (no programmatic consumers)

### Domain glossary

- **`MemoryItem.createdAt`** — `Date` field on the public memory shape; semantic = "when this fact was first persisted". Currently a LIE for read paths.
- **`VectorStoreResult`** — DIP shape returned by `VectorStore.list/search/get`; currently `{id, payload, score?}`. Extension adds optional `createdAt/updatedAt/tValid/tInvalid/confirmationCount`.
- **Scope tab pattern** — Entities tab convention: 4 toggles (user/session/agent/repo) at top of DataTable that filter rows by `scope_type` column. URL-state via `useSearchParams('scope')`.
- **Cascade-delete with concurrency cap** — Entities tab pattern for bulk forget: N parallel `cloudFetch('/v1/memory/forget/...')` capped at `FORGET_CONCURRENCY=5`.
- **`@usetheo/ui` primitives** — shared component library: `PageShell`, `DataTable`, `EmptyState`, `ConfirmDialog`, `Timestamp`, `Alert`, `Card`. Used uniformly across all 4 memory tabs.

### Architecture boundaries affected

Per `rules/architecture.md § 3 (Dependency direction — DIP)`:

- `src/core/dip/vector-store.ts` (contract) ← `src/local/pgvector-store.ts` + `src/local/in-memory-store.ts` (impls) — extending the contract requires updating BOTH impls in lockstep. No new cross-layer import.
- `src/local/index.ts` → `src/core/dip/vector-store.ts` — consumer side. ZERO new imports needed (the new fields are read from the same `VectorStoreResult` object already in scope).
- `src/server/handlers/scopes.ts` — no change to the handler; the fix propagates transparently through `getAll()`.
- Dashboard frontend lives in `theo-cloud` repo (cross-repo) — separate `rules/` directory. Changes there honor that repo's architecture rules (React/Vite/TypeScript per its `.claude/rules/` if present).

## Prior Art & Related Work

- **Internal blueprint** — Item 16 (`theo-memory-standalone-p0` cycle, shipped 2026-06-03) — established `src/server/handlers/scopes.ts` + REST surface; bug here is regression on that surface that landed in v1.1 or later.
- **Internal blueprint** — Item 20 (`theo-memory-faang-auth-lifecycle`, shipped 2026-06-07) — established `theo_api_keys` + Bearer auth used by the Dashboard ↔ BFF ↔ TheMemory chain validated in this session.
- **Internal blueprint** — `dashboard-memory-section-roadmap.md` (theo-cloud repo) — Plan 1 = Memories tab, Plan 2 = Entities tab (canonical pattern reference), Plan 3 = Webhooks tab. Entities was the LAST shipped using the standardized pattern; Memories was the FIRST shipped and predates the standard.
- **Internal rule** — `.claude/rules/architecture.md § 7 (No `any`)`, § 6 (kebab-case files, PascalCase classes).
- **Internal rule** — `.claude/rules/testing.md § Test pairing convention` — unit tests co-located in `src/**/*.test.ts`; integration tests at `tests/integration/**`.
- **External standard** — pgvector v0.5.1 SELECT semantics: column projections are explicit; bug is silent omission.
- **No prior cycle** — this specific bug pair (backend temporal fidelity + frontend tab standardization) has no prior `/discover` blueprint; first-of-its-kind cycle.

## Objective

- [ ] Sub-goal 1 — `VectorStoreResult` extended with optional `createdAt: Date | undefined` (other temporal fields deferred). Backward-compatible.
- [ ] Sub-goal 2 — `PgvectorStore.list` projects `created_at` column; `InMemoryVectorStore.list` returns the tracked timestamp; both flowing through `VectorStoreResult.createdAt`.
- [ ] Sub-goal 3 — `LocalScopedMemory.getAll` builds `MemoryItem.createdAt/updatedAt/tValid` from `VectorStoreResult.createdAt` (falls back to `new Date()` only when undefined — preserves backward compat for adapters that don't project).
- [ ] Sub-goal 4 — REST `GET /v1/scopes/:type/:id/memories` empirically returns real DB `created_at` per row (verified via integration test against real `ankane/pgvector:v0.5.1` container).
- [ ] Sub-goal 5 — Dashboard Memories tab shipped with scope tabs (user/session/agent/repo) matching Entities pattern + correct columns + actions.
- [ ] Sub-goal 6 — BFF Go proxy verified to pass through `created_at` from upstream without overwrite (smoke test).
- [ ] Sub-goal 7 — Followup DRAFT file `themory-temporal-fidelity-full-fix-DRAFT.md` CREATED at `knowledge-base/plans/` by T6.1 (EC-5 absorption — task added v1.1) covering the 5 OTHER paths (recall + 2 reflection + 2 consolidation) for a separate cycle.

## ADRs

### D1 — Optional field addition on `VectorStoreResult`, NOT a new shape

- **Decision** — Add `createdAt?: Date` (optional) to `VectorStoreResult`. Other temporal fields (`updatedAt`, `tValid`, `tInvalid`, `confirmationCount`) deferred to the follow-up `themory-temporal-fidelity-full-fix` cycle.
- **Rationale** — Backward-compatible for all existing adapters (in-memory test fixtures, third-party impls if any). Scope-restricted to what the bug surface REQUIRES (getAll → REST list endpoint). Adding all 5 temporal fields at once explodes test fixture surgery across ~10 test files for `recall`/`reflection`/`consolidation` that are out-of-scope for this cycle.
- **Alternatives considered**:
  - (B) Add all 5 temporal fields at once — REJECTED: scope creep, cross-cuts v1.1 bi-temporal asOf code that needs separate empirical validation.
  - (C) New `VectorStoreResultWithTemporal` shape extending `VectorStoreResult` — REJECTED: shape proliferation, every callsite would need union-handling.
  - (D) Project temporal columns via separate `VectorStore.getTemporals(ids)` method — REJECTED: 2 DB round-trips per list; latency regression.
- **Consequences** — Enables Dashboard list fix. Constrains: full bi-temporal fix is deferred (sub-goal 7 documents this).

### D2 — `LocalScopedMemory.getAll` fallback to `new Date()` when `result.createdAt === undefined`

- **Decision** — When `VectorStoreResult.createdAt` is `undefined` (legacy in-memory adapters that didn't track it, OR rows pre-fix), construct `MemoryItem.createdAt = new Date()` as today. When DEFINED, use the real value.
- **Rationale** — Backward-compat: in-memory tests that don't bother to set createdAt still work. Honest disclosure: fallback path masks the bug for adapters that don't project — Princípio 3 auditability requires we emit an OTel event `getall_temporal_fallback` when the fallback fires, so operator dashboards surface stale-impl usage.
- **Alternatives considered**:
  - (B) Throw when undefined — REJECTED: breaks every in-memory test fixture.
  - (C) Hard-default to `new Date(0)` (epoch) — REJECTED: lies in a DIFFERENT direction (silent now() → silent 1970); worse DX.
- **Consequences** — Enables incremental adapter migration. Constrains: the OTel event surface needs to be wired (existing `emitEvent` helper available at `src/core/memory-event.ts`).

### D3 — Frontend: extend Memories tab in place, do NOT rewrite from scratch

- **Decision** — Modify `cloud/dashboard/src/pages/memory/memories.tsx` (236 LoC) in place adding scope tabs + standardized columns. Preserve existing trash + ConfirmDialog choreography + URL-state via useSearchParams.
- **Rationale** — KISS + DRY: 80% of the existing file is already aligned with the pattern (uses `@usetheo/ui` primitives, useQuery, useMutation, useSearchParams). Only scope-tabs section is missing AND columns need re-shape. Rewriting risks regression on the trash flow that team already validated.
- **Alternatives considered**:
  - (B) Rewrite from scratch using `entities.tsx` as template — REJECTED: regression risk + lost work.
  - (C) Extract scope-tabs component into shared `cloud/dashboard/src/components/scope-tabs.tsx` and consume from both Memories+Entities — DEFERRED: DRY refactor candidate for a separate cycle; not blocking this fix.
- **Consequences** — Smaller diff, lower risk. Constrains: the in-place edit means tracking is slightly less clean than a side-by-side rewrite would be — Pre-COMMIT SEPA must compare both files.

### D4 — BFF Go proxy: verify pass-through, do NOT modify unless smoke fails

- **Decision** — Add a smoke test asserting BFF returns the same `created_at` it received from upstream. If smoke passes, the BFF is correctly transparent; if smoke fails, a sub-task creates a fix in `theo-cloud/theo/cloud/internal/themory/client.go`.
- **Rationale** — YAGNI: don't speculate about BFF bugs that may not exist. The PG-direct query showed real timestamps; if upstream REST now returns real timestamps (post sub-goal 4), the BFF should propagate cleanly unless it has its own time-stamping.
- **Alternatives considered**:
  - (B) Read the BFF code carefully now to confirm — REJECTED: smoke test gives the same answer with less guessing.
- **Consequences** — Conditional task that may be no-op. Honest about unknown.

### D5 — Scope of this plan EXCLUDES recall/reflection/consolidation temporal fix

- **Decision** — Sub-goal 7 documents the 5 OTHER `createdAt: new Date()` instances (lines 643, 756, 807 already in getAll-scope, 957, plus `src/local/scoped-skill-memory.ts:104` and `src/local/skills/payload.ts:78`) as a follow-up cycle slug `themory-temporal-fidelity-full-fix`. THIS plan does NOT touch them. **v1.1 EC-5 absorption (2026-06-08): added T6.1 task creating `knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md` in this cycle to ensure the follow-up is TRACEABLE (orphan closed).**
- **Rationale** — v1.1 bi-temporal asOf (CLAUDE.md Roadmap Item 12, declared SHIPPED 2026-06-03) is potentially affected by recall path. Validating that needs empirical curl + asOf parameter + ground truth — separate scoping. Mixing the two cycles loses test atomicity.
- **Alternatives considered**:
  - (B) Single mega-cycle — REJECTED: scope creep; one cycle producing ~30 tasks is unmaintainable.
  - (C) Leave sub-goal 7 as plan-changelog reference (no task) — REJECTED post-EC-5: invisible debt; the cycle ships and the follow-up never gets created.
- **Consequences** — A follow-up cycle is REQUIRED before v1.0 promotion. Honest disclosure in plan v1.1 changelog. T6.1 ensures the DRAFT file lives at canonical path the next `/to-plan` invocation will inherit.

### D6 — DOCUMENT items absorbed inline (EC-11/12/13)

- **EC-11 — Dead `category` + `from/to` date filter UI in Memories tab**: ACCEPTED RISK. The pre-existing filter UI has NO backing data (no row has `category` populated → filter silently produces empty results). D3 in-place edit preserves the filter (UX regression unchanged from pre-cycle). A follow-up cycle `dashboard-memories-tab-dead-filter-cleanup` removes it. NOT blocking.
- **EC-12 — `confirmation_count` column promised in v1.1 (Roadmap Item 12) NOT exposed on Dashboard table**: ACCEPTED RISK per Q2 explicit deferral. Operators won't see confirmation_count counts. Absorbed by `themory-temporal-fidelity-full-fix` follow-up (which touches v1.1 invariants).
- **EC-13 — pgvector `created_at` column type (`timestamptz` vs `timestamp without time zone`)**: ACCEPTED RISK. Verified `timestamptz` in current schema. `new Date(r.created_at)` from Node pg driver returns UTC — correct. Mitigation note: future migrations using `timestamp` (no TZ) would introduce subtle UTC drift. Out of scope for this cycle; `rules/architecture.md § 10.x` could grow a "all temporal columns MUST be `timestamptz`" rule in a separate hygiene cycle.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| **R1 — Fix masks the bigger arquitetural problem** | MEDIUM | Sub-goal 7 explicitly creates a follow-up plan AND blocks `production-ready` claims until temporal fidelity is fully restored across recall+reflection+consolidation. Documented in CHANGELOG entry. | Implementer + Roadmap Item 11 gate |
| **R2 — In-memory test fixtures don't set createdAt → fallback fires constantly in tests** | LOW | OTel event `getall_temporal_fallback` SHOULD fire only in test contexts after the fix; production adapter (pgvector) populates real value. Tests can suppress event-emit via tracer=undefined (EC-5 absorption precedent from principles-alignment-hardening). | Implementer |
| **R3 — Cross-repo coordination: backend REST contract must ship BEFORE frontend Memories tab consumer expects `created_at` per row** | LOW (downgraded v1.4) | v1.4 empirical evidence: Dashboard has ZERO npm dep on `@usetheo/memory`; data flows via BFF Go + REST JSON. The "version-skew window" risk doesn't exist — runtime JSON has no compile-time type binding to drift. Backend Phase 2 ships first (already shipped: `cea60b9`); frontend Phase 3 consumes the JSON contract whenever it lands. T4.1 BFF smoke + T4.2 chain validation provide the post-merge safety net. | Implementer |
| **R4 — `PgvectorStore.list` SELECT projection added — small query plan change** | LOW | New column add to existing SELECT; pgvector v0.5.1 handles this trivially. Run EXPLAIN ANALYZE pre/post to confirm no plan regression. | Implementer |
| **R5 — Dashboard Memories tab in-place edit may regress the trash + ConfirmDialog flow team validated this morning** | MEDIUM | Pre-RED unit test (T3.1) captures EXISTING trash flow as regression-guard BEFORE adding scope tabs. Then scope-tabs RED test (T3.2) — additive, not replacement. SEPA pre-COMMIT verifies diff is additive on the trash path. | Implementer + SEPA |
| **R6 — BFF Go proxy may have its own time-stamping (D4 unknown)** | LOW | Smoke test in T4.1 reveals it; if true, ship a follow-up commit inside the cycle (no separate task — handled inline). | Implementer |

## Unresolved Questions

- Q1 — Should the scope tabs at Memories tab default to `user` (matching Entities default) OR remember the operator's last selection via localStorage? Out of scope for this cycle; resolved as: match Entities default (URL-state via `useSearchParams`; defaults to `user` per `entities.tsx:54`).
- Q2 — Should the page show `confirmation_count` column matching the bi-temporal Phase-2 push? Out of scope; sub-goal 7 follow-up cycle covers this.
- Q3 — Should the v1.1 bi-temporal `asOf` parameter be exposed in the URL as a date-picker on the Memories tab? Out of scope; covered by sub-goal 7 follow-up after asOf is empirically validated.

## Dependencies

Per `rules/deps-audit-golden-rule.md` — plan declares deps it uses; no new packages introduced.

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `pg` | `^8.x` (resolved current) | npm | Postgres driver — backend SELECT projection extension in T2.1. Existing prod dep since v0.1. |
| `pgvector` (PG extension v0.5.1) | `0.5.1` | postgres-extension | DB-side schema column read; not an npm dep. Existing since v0.1 per `ankane/pgvector:v0.5.1` Docker tag. |
| `vitest` | `^x.y` (resolved current) | npm | Test runner for new T1.1/T2.1/T2.2/T3.1 tests. Existing dev dep. |
| `@usetheo/ui` (theo-cloud repo) | resolved current | npm (sibling repo) | DataTable + Tabs + Badge + Timestamp primitives in T3.2/T3.3. Existing in theo-cloud dashboard; audited in that repo's `package.json`. |
| `@usetheo/memory` (DROPPED in v1.4) | N/A | n/a | v1.4 empirical evidence: Dashboard does NOT import `@usetheo/memory` as npm dep. `grep "@usetheo/memory" theo-cloud/theo/cloud/dashboard/{package.json,src/}` = 0 hits. Memory data flows via BFF Go + REST JSON. T3.0 dropped. |
| `DeterministicStubEmbedder` (from `@usetheo/memory/embedders/stub` — internal subpath) | this repo | internal | Used by T3.1 integration test setup (v1.2 absorption) to avoid pulling `@xenova/transformers` transitive chain. Existing internal export. |

### New — to be introduced

(none — zero `npm install` of new packages in this cycle)

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

### Pre-existing vulnerabilities surfaced by audit (NOT introduced by this plan)

Per `/deps-audit dashboard-memories-tab-standardization` (2026-06-08), the resolved npm tree contains a pre-existing CRITICAL chain `@xenova/transformers → onnxruntime-web → onnx-proto → protobufjs <7.5.5` (CVSS 9.8 RCE). The plan v1.2 explicitly avoids pulling this chain into the test runtime by composing Memory with `DeterministicStubEmbedder` instead of `wireMemoryFromPool` (which hard-wires `LocalTransformerEmbedder`). The CVE chain remains in the repo-wide production tree pending the separate dependency-upgrade cycle `deps-upgrade-xenova-transformers-v2-protobufjs-cve` (semver-major migration; tracked separately to keep this cycle's scope tight on Dashboard + temporal fidelity).

## Dependency Graph

```
Phase 1 (DIP shape extension) ──▶ Phase 2 (PgvectorStore + getAll fix)
                                              │
                                              ├──▶ Phase 3.1 (REST integration test)
                                              │
                                              ├──▶ Phase 3.2 + 3.3 (Dashboard REST-consumer standardization — runtime JSON, no SHA pin per v1.4)
                                              │
                                              ├──▶ Phase 4 (BFF smoke + cross-repo integration validation)
                                              │
                                              └──▶ Phase 6 (T6.1 — follow-up DRAFT plan file — EC-5 absorption)
```

Phase 1 must complete first (DIP contract). Phase 2 commits to theo-memory `develop` — these supply real `created_at` via REST JSON. T3.2/T3.3 consume the REST JSON contract (no npm import binding; v1.4 dropped T3.0 per empirical evidence). Phase 4 final gate (T4.1 BFF passthrough smoke + T4.2 full-chain validation). T6.1 closes EC-5 orphan; runs anytime after Phase 1 (no dep on other tasks).

---

## Phase 1: DIP shape extension

### T1.1 — RED: VectorStoreResult.createdAt optional field

#### Objective
Add optional `createdAt?: Date` to `VectorStoreResult` interface. Pure type contract change + 2 unit tests asserting the field round-trips through adapters.

#### Why this step (ReAct discipline)

**What this step does** — Extends the `VectorStoreResult` interface at `src/core/dip/vector-store.ts:18-22` from `{id, payload, score?}` to `{id, payload, score?, createdAt?}`. Backward-compatible additive change.

**Why it is necessary now** — Per ADR D1, every fix in Phase 2/3 depends on this contract change. Without it, neither `PgvectorStore` nor `InMemoryVectorStore` has a typed surface to return the temporal value. KISS: extending one interface < adding 5 fields or a new shape.

#### Evidence
- `src/core/dip/vector-store.ts:18-22` — current shape (no temporal fields).
- `src/local/pgvector-store.ts:725` — proof that `pgvector-store` can SELECT `created_at` column (already does in `bulkFetchSkillSourceTexts`).
- `src/local/index.ts:807` — load-bearing bug site; the fallback path consumes this field.

#### Files to edit
```
src/core/dip/vector-store.ts — extend VectorStoreResult interface
src/core/dip/__tests__/vector-store.test-d.ts (NEW) — type-level test asserting optional field
```

#### Deep file dependency analysis
- `src/core/dip/vector-store.ts` — DIP contract; no runtime impact, only type widening. Any consumer creating fixtures with `{id, payload}` still typechecks (optional field).
- `src/core/dip/__tests__/vector-store.test-d.ts (NEW)` — `expectTypeOf` from vitest; asserts (a) `createdAt: Date` accepted, (b) `createdAt: undefined` accepted, (c) `createdAt: string` rejected.

#### Deep Dives
- **Data structure**: `createdAt?: Date`. NOT `string | Date` — caller (PgvectorStore.list) is responsible for `new Date(row.created_at)` coercion if needed.
- **Invariant**: existing field set unchanged. New field optional.

#### Pseudo-code
```typescript
// src/core/dip/vector-store.ts
export interface VectorStoreResult {
  readonly id: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly score?: number;
  // NEW (ADR D1): wall-clock when the row was first persisted, projected from
  // the adapter's underlying store. When undefined, consumer uses fallback per
  // ADR D2 (emits OTel `getall_temporal_fallback` to surface stale impls).
  readonly createdAt?: Date;
}
```

#### Tasks
1. Add `createdAt?: Date` field to `VectorStoreResult`.
2. Add JSDoc citing ADR D1 + D2.
3. Create `src/core/dip/__tests__/vector-store.test-d.ts` with `expectTypeOf` assertions.
4. Run `npm run typecheck` — assert zero new errors.

#### TDD
```
RED:    test_vector_store_result_accepts_optional_createdAt_date — expectTypeOf<VectorStoreResult>().toMatchTypeOf<{createdAt?: Date}>()
RED:    test_vector_store_result_rejects_string_in_createdAt_field — assertType<VectorStoreResult>({id: 'x', payload: {}, createdAt: '2026-01-01' as any})
GREEN:  Add field to interface
REFACTOR: None
VERIFY: npm run typecheck && npm test -- vector-store.test-d
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `VectorStoreResult` has `createdAt?: Date`.
- [ ] `vector-store.test-d.ts` PASS.
- [ ] `npm run typecheck` clean (no regression on 6+ existing callsites that build VectorStoreResult fixtures).
- [ ] JSDoc cites ADR D1 + D2.

#### DoD
- [ ] Commit: `feat(core): VectorStoreResult.createdAt optional field (T1.1)` with PRIORITY 0 body.

---

## Phase 2: Adapter impl + getAll fix

### T2.1 — GREEN: PgvectorStore.list projects created_at column

#### Objective
Modify `PgvectorStore.list()` SQL to SELECT `created_at` column and return it as `VectorStoreResult.createdAt: new Date(row.created_at)`. Plus integration test against real `ankane/pgvector:v0.5.1`.

#### Why this step
**What this step does** — Adds `, created_at` to the SELECT projection in `PgvectorStore.list`; maps DB row → `VectorStoreResult` with `createdAt: new Date(row.created_at)`.

**Why it is necessary now** — Per ADR D1, this is the production adapter path that flows real timestamps from DB to `LocalScopedMemory.getAll`. Without this, Phase 3 has nothing to consume.

#### Evidence
- `src/local/pgvector-store.ts:725` — precedent: `bulkFetchSkillSourceTexts` already SELECTs `created_at` from same `memories` table.
- Postgres direct query (this session): `created_at` column holds correct per-row timestamps; no other source needed.

#### Files to edit
```
src/local/pgvector-store.ts — extend SELECT in list() + map row → result
src/local/__tests__/pgvector-store-list-temporal.test.ts (NEW) — integration test against real PG
```

#### Deep file dependency analysis
- `pgvector-store.ts` — extending `list()` SQL projection + result mapping. Existing scope-filter logic unchanged. LoC delta ~3-5.
- Integration test uses real `ankane/pgvector:v0.5.1` container per `rules/testing.md § Integration`.

#### Pseudo-code
```typescript
// Inside PgvectorStore.list():
// BEFORE: SELECT id, payload FROM memories WHERE ...
// AFTER:  SELECT id, payload, created_at FROM memories WHERE ... ORDER BY created_at DESC, id ASC
//
// EC-2 absorption: explicit deterministic ORDER BY. Pre-fix, all rows had
// createdAt=now() so any ordering was meaningless; post-fix, without a tie-
// break the Dashboard pagination becomes non-deterministic (same offset,
// different rows across page refreshes). id ASC is the load-bearing tiebreak.
//
// EC-1 absorption: null-safe coerce. pgvector schema declares created_at with
// DEFAULT now() but legacy rows (early migration runs, manual inserts,
// restored backups) MAY have NULL. new Date(null) returns 1970-01-01 silently
// (epoch lie — different bug, same shape). Map NULL → undefined so the D2
// fallback in getAll emits getall_temporal_fallback and the data-quality
// issue surfaces in OTel rather than masquerading as a real 1970 timestamp.
const rows = await this.pool.query<{ id: string; payload: object; created_at: Date | null }>(
  `SELECT id, payload, created_at FROM memories WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id ASC LIMIT $N`,
  params,
);
return [rows.rows.map((r) => ({
  id: r.id,
  payload: r.payload as Record<string, ...>,
  createdAt: r.created_at !== null ? new Date(r.created_at) : undefined,  // EC-1
})), totalCount];
```

#### TDD
```
RED:    test_pgvector_list_returns_created_at_from_db_per_row — insert 2 rows with explicit created_at via direct SQL; list() returns both with matching createdAt
RED:    test_pgvector_list_maps_null_created_at_to_undefined_not_epoch (EC-1) — direct SQL insert with created_at=NULL; list() returns the row with createdAt === undefined (NOT new Date(0) / 1970-01-01)
RED:    test_pgvector_list_orders_by_created_at_desc_then_id_asc (EC-2) — insert 2 rows at IDENTICAL created_at (use direct SQL with same explicit timestamp); list() returns them in id ASC order across 5 consecutive calls (deterministic)
GREEN:  Add column to SELECT + null-safe map row + explicit ORDER BY
REFACTOR: Confirm no SQL plan regression (EXPLAIN ANALYZE)
VERIFY: npm run test:integration -- pgvector-store-list-temporal
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `PgvectorStore.list` returns `VectorStoreResult.createdAt` per row.
- [ ] EC-1 — NULL `created_at` rows map to `createdAt: undefined`, NOT `new Date(0)` (epoch lie). Integration test asserts this against a manually-NULLed row.
- [ ] EC-2 — SQL ORDER BY is exactly `created_at DESC, id ASC`. Integration test asserts deterministic ordering across 5 consecutive `list()` calls when 2+ rows share the same `created_at` value.
- [ ] Integration test PASS against real PG (`ankane/pgvector:v0.5.1`).
- [ ] EXPLAIN ANALYZE shows no plan regression vs pre-fix.
- [ ] Pass: lint + typecheck.

#### DoD
- [ ] Commit: `feat(local): PgvectorStore.list projects created_at + EC-1 null-safe + EC-2 deterministic ORDER BY (T2.1)` with PRIORITY 0 body.

---

### T2.2 — GREEN: InMemoryVectorStore tracks createdAt + LocalScopedMemory.getAll consumes it

#### Objective
Extend `InMemoryVectorStore` to track per-row `createdAt` (defaulting to `new Date()` at insert time). Modify `LocalScopedMemory.getAll` to consume `result.createdAt` with fallback per ADR D2.

#### Why this step
**What this step does** — Two coupled edits: (a) `InMemoryVectorStore.insert` stamps `createdAt` per row + `list` returns it; (b) `LocalScopedMemory.getAll` uses `result.createdAt ?? new Date()` (fallback per ADR D2) and emits `getall_temporal_fallback` OTel event when undefined.

**Why it is necessary now** — Closes the chain: PgvectorStore.list provides createdAt → getAll consumes it. In-memory adapter parity prevents test fixture confusion.

#### Evidence
- `src/local/in-memory-store.ts:255` (existing row construction) — natural insertion point for `createdAt: new Date()`.
- `src/local/index.ts:807-810` — current bug site.

#### Files to edit
```
src/local/in-memory-store.ts — track + return createdAt
src/local/index.ts — LocalScopedMemory.getAll consumes + falls back per D2
src/core/memory-event.ts — verify `getall_temporal_fallback` event in MEMORY_EVENTS union (add if missing)
src/local/__tests__/in-memory-store-temporal.test.ts (NEW)
src/local/__tests__/scoped-memory-getall-temporal.test.ts (NEW)
```

#### Deep file dependency analysis
- `in-memory-store.ts:255+` — add `createdAt: new Date()` to row construction.
- `index.ts:807-810` — change `createdAt: new Date()` → `createdAt: r.createdAt ?? (emitEvent(tracer, 'getall_temporal_fallback'), new Date())`.

#### Pseudo-code
```typescript
// in-memory-store.ts (around line 255 in insert):
this.rows.set(id, {
  vector: vectors[i],
  payload: payloads[i],
  createdAt: new Date(),  // NEW
});

// list():
return [matches.map((row) => ({
  id: row.id,
  payload: row.payload,
  createdAt: row.createdAt,  // NEW
})), matches.length];

// index.ts getAll() at line 802:
return results.map((r) => {
  if (r.createdAt === undefined) {
    emitEvent(this.config.tracer, 'getall_temporal_fallback', { id: r.id });
  }
  const createdAt = r.createdAt ?? new Date();
  return {
    id: r.id,
    text: String(r.payload['text'] ?? ''),
    hash: String(r.payload['hash'] ?? r.id),
    scope: this.scope,
    createdAt,
    updatedAt: createdAt,  // unify with createdAt (same row)
    metadata: { ...r.payload },
    tValid: createdAt,
    tInvalid: null,
  };
});
```

#### TDD
```
RED:    test_in_memory_store_list_returns_createdAt_per_row — insert 2 rows at distinct times (use vi.useFakeTimers); list returns both with correct dates
RED:    test_scoped_memory_getall_uses_store_createdAt_not_now — mock VectorStore returning result.createdAt = past date; assert getAll output matches
RED:    test_scoped_memory_getall_emits_fallback_event_when_createdAt_undefined — mock VectorStore returning result.createdAt = undefined; assert OTel `getall_temporal_fallback` event emitted
RED:    test_in_memory_store_two_inserts_same_millisecond_pagination_deterministic (EC-6) — vi.useFakeTimers freezes clock; insert 2 rows back-to-back; list() returns them in deterministic order (by id, not random) across 5 consecutive calls
RED:    test_getall_fallback_event_emitted_at_most_once_per_scope_per_request (EC-7) — fixture with 100 rows lacking createdAt; getAll() emits the OTel event AT MOST ONCE with metadata `{count: 100}` instead of 100 distinct events (per-row emission would explode logs for 10k legacy scopes)
GREEN:  Implement fallback + event aggregation
REFACTOR: None
VERIFY: npm test -- in-memory-store-temporal scoped-memory-getall-temporal
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] InMemoryVectorStore tracks + returns createdAt.
- [ ] getAll uses real createdAt OR fallback + event.
- [ ] 5 RED tests PASS (3 original + EC-6 + EC-7).
- [ ] EC-6 — same-millisecond pagination deterministic by id.
- [ ] EC-7 — `getall_temporal_fallback` event aggregates per-request (NOT per-row); emitted at most once with `{count: N}` metadata.
- [ ] Existing `extraction-pipeline.test.ts` fixtures (which don't set createdAt) STILL PASS (backward compat) — fallback path proves D2.
- [ ] `MEMORY_EVENTS` union includes `getall_temporal_fallback`.

#### DoD
- [ ] Commit: `feat(local): in-memory store + getAll honor result.createdAt with D2 fallback + EC-7 event aggregation (T2.2)` with PRIORITY 0 body.

---

## Phase 3: REST + Dashboard standardization

### T3.0 — DROPPED in v1.4 (EC-4 premise empirically invalid)

> **Status:** DROPPED per plan v1.4 after `/implement` halt-loop iteration 6 empirical evidence: `grep "@usetheo/memory" theo-cloud/theo/cloud/dashboard/{package.json,src/}` = 0 hits. The Dashboard consumes memory data via BFF Go (`theo-cloud/theo/cloud/internal/themory/client.go`) + REST, NOT via direct npm import. The npm-dep cross-repo merge-order risk EC-4 modeled doesn't exist in the actual architecture; no SHA pin needed. T3.2/T3.3 reframed as REST-consumer standardization. The original T3.0 contract is preserved here as part of the audit trail; the task itself is REMOVED from execution scope.

#### Concurrency tests
(none — single-threaded)

---

### T3.1 — REST integration test asserting temporal fidelity end-to-end

#### Objective
Integration test at `tests/integration/server/scopes-list-temporal-fidelity.test.ts` that boots the REST server against real PG, inserts 2 memories with explicit timestamps, and asserts `GET /v1/scopes/user/:id/memories` returns them with matching `createdAt`.

#### Why this step
**What this step does** — End-to-end gate that proves the fix flows from PG → PgvectorStore.list → getAll → REST handler → JSON response.

**Why it is necessary now** — Sub-goal 4 metric. Without this test, "fix shipped" is unprovable.

#### Evidence
- Empirical session evidence: pre-fix REST returns `now()` instead of real createdAt.

#### Files to edit
```
tests/integration/server/scopes-list-temporal-fidelity.test.ts (NEW)
```

#### Pseudo-code
```typescript
// EC-3 absorption — canonical write-path + UPDATE.
//
// REJECTED earlier pseudo-code: `INSERT INTO memories (id, user_id, text, hash, created_at, ...)`
// would have failed NOT NULL constraints on embedding vector(384), payload jsonb,
// hash text UNIQUE per scope, etc. — the test would error before any assertion.
//
// CORRECT shape: use the SAME write path production uses (scoped.remember →
// 8-phase pipeline → INSERT honoring ALL constraints), then UPDATE the temporal
// value via direct SQL ONLY for what the test is exercising. This way the
// fixture goes through the same schema-validating path the consumer hits.
test('themory-issue-4 — REST list returns real DB created_at per row', async () => {
  // Given: 2 memories inserted via canonical write path.
  // v1.2 NOTE: compose Memory directly with DeterministicStubEmbedder rather
  // than wireMemoryFromPool(pool) to avoid pulling @xenova/transformers
  // transitive chain (CRITICAL CVE on protobufjs <7.5.5 — pre-existing
  // repo-wide, fix in separate cycle deps-upgrade-xenova-transformers-v2).
  // Canonical write-path semantics preserved: scoped.remember(text, {infer:false})
  // still drives the 8-phase pipeline + INSERT honoring all schema constraints
  // (NOT NULL embedding vector(384), payload jsonb, hash UNIQUE per scope).
  // The fidelity assertion is on created_at — independent of embedder values.
  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
    embedder: new DeterministicStubEmbedder({ dim: 384 }),
    llm: stubLLM([]),  // infer:false bypasses LLM anyway
    embeddingDim: 384,
  });
  const scoped = memory.user('alice');
  const r1 = await scoped.remember('hello', { infer: false });
  const r2 = await scoped.remember('world', { infer: false });
  // Manually update created_at to controlled timestamps (only temporal manipulation)
  await pool.query(`UPDATE memories SET created_at = $1 WHERE id = $2`, ['2026-01-01T10:00:00Z', r1.items[0].id]);
  await pool.query(`UPDATE memories SET created_at = $1 WHERE id = $2`, ['2026-01-02T20:00:00Z', r2.items[0].id]);
  // When: REST list invoked
  const res = await fetch('http://localhost:8080/v1/scopes/user/alice/memories');
  const body = await res.json();
  // Then: each row's createdAt matches the UPDATEd timestamp (ORDER BY created_at DESC per EC-2)
  expect(body.items[0].createdAt).toBe('2026-01-02T20:00:00.000Z');
  expect(body.items[1].createdAt).toBe('2026-01-01T10:00:00.000Z');
  // Confidence: assert they're NOT the same (which would prove the now() bug returned)
  expect(body.items[0].createdAt).not.toBe(body.items[1].createdAt);
});
```

#### TDD
```
RED:    test_rest_list_returns_real_created_at_per_row (above — uses canonical write path per EC-3)
GREEN:  passes once T2.1+T2.2 land
VERIFY: npm run test:integration -- scopes-list-temporal-fidelity
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Test PASS against real PG.
- [ ] EC-3 — test fixture uses canonical write path (`scoped.remember(text, {infer: false})`) NOT raw INSERT INTO memories. Direct SQL is used ONLY for temporal manipulation (UPDATE created_at) — never for row creation. This ensures the fixture exercises the same schema constraints production hits.
- [ ] v1.2 — Memory composed via `createLocalMemory({ vectorStore: PgvectorStore, embedder: DeterministicStubEmbedder, llm: stubLLM })` (NOT `wireMemoryFromPool` which pulls vulnerable `@xenova/transformers` chain). Canonical write-path semantics preserved.
- [ ] Test exposes the bug — verified to FAIL against pre-fix HEAD.

#### DoD
- [ ] Commit: `test(server): REST list temporal fidelity integration test with canonical write path (T3.1)`.

---

### T3.2 — Dashboard Memories tab — add 4 scope tabs (entities.tsx canonical pattern)

#### Objective
Add scope tabs UI (USER/SESSION/AGENT/REPO) to `memories.tsx` matching `entities.tsx:54+` structure. URL-state via `useSearchParams('scope')`. Tabs filter the DataTable rows by their scope.

#### Why this step
**What this step does** — Adds `<Tabs>` component (from `@usetheo/ui`) at top of Memories page. Each tab corresponds to a scope_type. URL changes when tab clicked. List API call passes scope to BFF.

**Why it is necessary now** — Sub-goal 5. Without this, Memories tab diverges from the 3 sibling tabs that all standardize on scope tabs.

#### Files to edit
```
cloud/dashboard/src/pages/memory/memories.tsx (theo-cloud) — add Tabs + scope filter
cloud/dashboard/src/pages/memory/memories.test.tsx — assert 4 tabs rendered + URL state
```

#### TDD
```
RED:    test_memories_tab_renders_4_scope_tabs_user_session_agent_repo — render component; assert 4 tabs by name
RED:    test_memories_tab_scope_tab_click_updates_url_searchparam — click 'session' tab; assert searchParams.get('scope') === 'session'
RED:    test_memories_tab_default_scope_is_user_matching_entities_pattern — initial render; assert active tab is 'user'
RED:    test_memories_tab_invalid_scope_param_defaults_to_user (EC-8) — mount component with useSearchParams: {scope: 'invalid_garbage'}; assert active tab is 'user' (matches entities.tsx:55 SCOPES.includes(scopeParam as Scope) defensive coerce pattern)
GREEN:  Implement Tabs section + URL-state + defensive scope coerce
REFACTOR: None
VERIFY: cd theo-cloud/theo/cloud/dashboard && npm test -- memories.test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] 4 tabs rendered: USER / SESSION / AGENT / REPO.
- [ ] Click updates URL.
- [ ] Default is `user`.
- [ ] Existing trash + ConfirmDialog flow STILL passes existing tests (regression-guard).

#### DoD
- [ ] Commit (in theo-cloud repo): `feat(dashboard): Memories tab scope tabs matching Entities pattern (T3.2)` with PRIORITY 0 body referencing this plan.

---

### T3.3 — Dashboard Memories tab — DataTable column shape match Entities

#### Objective
Adjust Memories tab DataTable columns to `{id, content, scope_type, created_at (Timestamp), actions}` matching the Entities-tab columns shape.

#### Files to edit
```
cloud/dashboard/src/pages/memory/memories.tsx — refactor columns block
cloud/dashboard/src/pages/memory/memories.test.tsx — assert columns
```

#### TDD
```
RED:    test_memories_tab_datatable_columns_match_entities_pattern — render; assert columns by name in given order
RED:    test_memories_tab_created_at_column_uses_Timestamp_component — assert Timestamp primitive rendered (not raw date string)
RED:    test_memories_tab_renders_scope_type_badge_per_row (EC-9) — assert each DataTable row has a Badge with the scope_type value. May reveal that the BFF projection omits `scope` per-row OR that T3.3 needs to derive it client-side from the URL `?scope=` filter (entities-pattern derivation: all rows in the table share the active scope).
GREEN:  Refactor DataTable.columns array + scope_type derivation strategy
VERIFY: cd theo-cloud/theo/cloud/dashboard && npm test -- memories.test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Columns: id (short) / content (truncated) / scope_type (Badge) / created_at (Timestamp) / actions (Trash).
- [ ] Timestamp component renders relative time (not raw ISO).
- [ ] Tests PASS.

#### DoD
- [ ] Commit: `feat(dashboard): Memories tab DataTable columns standardized (T3.3)`.

---

## Phase 4: Integration validation (BFF + cross-repo)

### T4.1 — BFF Go proxy smoke test: pass-through verification

#### Objective
Smoke test: `curl -H "Auth: Bearer ..." http://localhost:13002/v1/memory/list` returns same `created_at` as direct TheMemory call.

#### Files to edit
```
theo-cloud/theo/cloud/internal/themory/client_test.go (extend OR NEW)
theo-cloud/theo/infra/scripts/local/smoke-dashboard-memory-bff-temporal.sh (NEW)
```

#### TDD
```
RED:    test_bff_pass_through_created_at_unchanged_from_upstream_themory — direct themory call OK; BFF call OK; assert ISO strings match
RED:    test_bff_pass_through_against_real_themory_server (EC-10) — smoke MUST boot REAL themory server (no mock) + REAL BFF + REAL curl chain. Mock-based smoke would mask any BFF-side time-stamping if present (the entire point of D4 verification is that we don't know if BFF mutates the timestamp).
GREEN:  Most likely no code change (BFF is already pass-through); if smoke fails, ship inline follow-up commit removing the BFF-side time-stamping
VERIFY: bash infra/scripts/local/smoke-dashboard-memory-bff-temporal.sh
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] BFF returns identical created_at to upstream.
- [ ] EC-10 — smoke runs against REAL themory server boot (not mock). Acceptance: the script SHALL fail honestly if a real themory boot is unavailable, never silently mock around.

#### DoD
- [ ] Commit: `test(bff): smoke pass-through created_at fidelity (T4.1)`.

---

### T4.2 — Cross-repo integration validation

#### Objective
Boot full chain (PG + TheMemory + BFF + Vite Dashboard) + manual browser test: log in, navigate `/memory/memories`, see correct timestamps per row + 4 scope tabs functional.

#### Files to edit
```
(none — observational; report at .claude/knowledge-base/reviews/dashboard-memories-tab-standardization-implement-validate-2026-06-08.md)
```

#### TDD
```
RED:    test_full_chain_dashboard_memories_displays_real_timestamps — manual + curl probe
RED:    test_full_chain_dashboard_memories_4_scope_tabs_clickable — manual browser
VERIFY: 7-gate validation (suite + typecheck + lint + build + 3 chain smokes A/B/C)
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] All 7 gates PASS.
- [ ] Browser test: timestamps differ per row (no more identical-now() bug).
- [ ] Browser test: 4 scope tabs render + filter list.

#### DoD
- [ ] Validation report written.
- [ ] Cycle complete; ready for `/code-quality` + `/review`.

---

## Phase 6: Follow-up DRAFT plan file (EC-5 absorption — closes sub-goal 7 orphan)

### T6.1 — Create themory-temporal-fidelity-full-fix-DRAFT.md (EC-5 absorption)

#### Objective
Create the follow-up DRAFT plan file at `knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md` documenting the 5 deferred `createdAt: new Date()` instances + the v1.1 bi-temporal `asOf` empirical validation gap. This converts sub-goal 7 from "orphan in the plan" (no task) to "tracked work" — closing the cap that EC-5 flagged: without this, the deferred bug becomes invisible debt the moment this cycle ships.

#### Why this step (ReAct discipline)
**What this step does** — Writes a `-DRAFT.md` plan stub at the canonical path. The DRAFT marker signals that the next `/to-plan` invocation against this slug will INHERIT this file's Context + Baseline + Prior Art rather than rebuilding from scratch.

**Why it is necessary now** — Per ADR D5 + sub-goal 7 + Global DoD all reference this follow-up. Without an explicit task, the cycle ships and the follow-up never gets created — the architectural debt loses traceability. v1.1 bi-temporal `asOf` may silently stay broken with no record pointing at it.

#### Evidence
- `src/local/index.ts:643, 756, 957` — 3 OTHER getAll-adjacent createdAt instances (recall, reflection, consolidation).
- `src/local/scoped-skill-memory.ts:104` — skill-scope createdAt instance.
- `src/local/skills/payload.ts:78` — skill payload createdAt instance.
- ADR D5 of THIS plan.

#### Files to edit
```
knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md (NEW)
```

#### Deep file dependency analysis
- `themory-temporal-fidelity-full-fix-DRAFT.md` — single new doc; no code impact. Format follows `templates/plan-template.md` shape but is a DRAFT (will be promoted via `/to-plan` in a future cycle).

#### Pseudo-code
The DRAFT file content (illustrative — final shape per next `/to-plan` invocation):

- **Frontmatter** — `slug: themory-temporal-fidelity-full-fix`, `status: DRAFT — follow-up of dashboard-memories-tab-standardization (cycle shipped 2026-06-08)`, `created_at: 2026-06-08`, `goal: Restore temporal fidelity across the 5 remaining getAll-adjacent paths AND empirically validate v1.1 bi-temporal asOf against real PG`.
- **Title** — `Plan (DRAFT): TheMemory temporal fidelity full fix`.
- **Inheritance note** — DRAFT inherited from `dashboard-memories-tab-standardization-plan.md § ADR D5`; next `/to-plan` SHALL build on this Context, NOT start from scratch.
- **Context section** — references the prior cycle (list-path fix) and explains the 5 OTHER paths still constructing `MemoryItem.createdAt` via `new Date()` losing DB fidelity; deferred per ADR D5.
- **Deferred work table** — 5 instances + 1 validation gap:
  - Row 1: `src/local/index.ts:643` (recall path) — own VectorStoreResult mapping; risks v1.1 bi-temporal asOf semantics
  - Row 2: `src/local/index.ts:756` (reflection path 1) — consumes createdAt for provenance; needs fixture surgery
  - Row 3: `src/local/index.ts:957` (consolidation path) — consolidation_history table own temporal cols; cross-cuts v0.7 distillation invariants
  - Row 4: `src/local/scoped-skill-memory.ts:104` (skill scope getAll) — deferred per Roadmap Item 19 v1.5.x semantic cache
  - Row 5: `src/local/skills/payload.ts:78` (skill payload) — tied to Voyager-pattern skill identity; careful
  - Row 6 (validation gap): `recall({ asOf })` empirical — v1.1 declared SHIPPED 2026-06-03 but recall createdAt construction makes asOf semantics untested against real PG row temporal-truth
- **Coverage Matrix placeholder** — TBD by next `/to-plan`.

#### TDD
```
RED:    test_followup_draft_file_exists_at_canonical_path (EC-5) — assert knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md exists AND contains the 5 file:line citations
GREEN:  Write the DRAFT file
VERIFY: ls knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] DRAFT file exists at canonical path.
- [ ] File cites all 5 deferred `createdAt` instances with file:line.
- [ ] File names the v1.1 bi-temporal `asOf` empirical validation gap explicitly.
- [ ] EC-5 — Coverage Matrix row 7 ("DOCUMENT follow-up cycle for the other 5 createdAt instances") now maps to a CONCRETE TASK (T6.1) rather than being a hand-wave reference to plan changelog.

#### DoD
- [ ] Commit (in theo-memory repo): `docs(plan): themory-temporal-fidelity-full-fix DRAFT — followup of dashboard-memories cycle (T6.1)`.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | createdAt bug — REST list returns now() not real DB timestamp | T1.1 + T2.1 + T2.2 + T3.1 | DIP shape + 2 adapters + getAll fix + integration test |
| 2 | EC-1 — NULL `created_at` legacy rows must map to undefined (not epoch) | T2.1 | Null-safe coerce in PgvectorStore.list mapping |
| 3 | EC-2 — Dashboard pagination determinism | T2.1 | Explicit `ORDER BY created_at DESC, id ASC` |
| 4 | EC-3 — T3.1 integration test fixture honors NOT NULL constraints | T3.1 | Canonical write-path + UPDATE for temporal-only manipulation |
| 5 | EC-4 — DROPPED in v1.4 (premise empirically invalid; Dashboard has zero npm dep on `@usetheo/memory`) | — | n/a; T3.0 dropped |
| 6 | EC-5 — Sub-goal 7 follow-up DRAFT file MUST exist (orphan closed) | T6.1 | NEW task creating the DRAFT plan stub |
| 7 | Memories tab missing scope tabs (Entities pattern) | T3.2 | Add 4 tabs with URL state + EC-8 defensive coerce |
| 8 | Memories tab columns don't match Entities | T3.3 | Standardize columns + EC-9 scope_type per-row badge |
| 9 | BFF pass-through verification against REAL upstream (not mock) | T4.1 | EC-10 smoke against real themory boot |
| 10 | OTel auditability for stale adapter usage (event explosion guarded) | T2.2 | EC-7 per-request aggregation `getall_temporal_fallback{count}` |
| 11 | Cross-repo integration validation | T4.2 | Manual + 7-gate full chain |

**Coverage: 11/11 (100%)** — all 5 MUST FIX + 5 SHOULD TEST mapped to concrete tasks. 3 DOCUMENT items (EC-11/12/13) addressed inline in ADRs.

## Global Definition of Done

- [ ] All phases completed
- [ ] `npm test` green on theo-memory (≥ 1193 + 3 new = 1196)
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] File-size budget respected (per `architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6)
- [ ] Backward compatibility: in-memory adapter without createdAt still works via D2 fallback
- [ ] Plan-specific:
  - [ ] Dashboard browser test: timestamps differ per row
  - [ ] 4 scope tabs render + clickable + URL-state preserved
  - [ ] BFF smoke pass-through PASS
- [ ] **Follow-up file** `knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md` created via T6.1 (EC-5 absorption) with stub for the 5 OTHER createdAt instances per ADR D5.
- [ ] ~~**Cross-repo SHA pin** (T3.0)~~ — DROPPED in v1.4 (premise invalid; Dashboard has zero npm dep on `@usetheo/memory`).
- [ ] Plan archived after `/review` returns `READY_TO_MERGE` AND PR merged.

## Failure scenarios

This plan touches Postgres (read path on `memories.created_at`) + BFF HTTP + Dashboard fetch:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `ankane/pgvector:v0.5.1` PG | Connection drops mid-list query | Stop container during T2.1 integration test | `PgvectorStore.list` propagates PG error → REST handler returns 500 with envelope (existing behavior) |
| BFF `/v1/memory/list` proxy | Upstream TheMemory unreachable | Block port 8080 during smoke | BFF returns 502 Bad Gateway (existing behavior; verify) |
| Dashboard `cloudFetch('/v1/memory/list')` | BFF returns 500 | Mock `cloudFetch` to throw | Memories tab shows `<Alert variant="error">` (existing react-query error path) |

## Final Phase: Integration Validation

### Execution
```
npm test                            # 1196 tests
npm run typecheck                   # zero errors
npm run lint                        # zero warnings
npm run build                       # dist refreshed
# Smoke A: REST temporal fidelity
curl -s http://localhost:8080/v1/scopes/user/<id>/memories | jq '.items[].createdAt' | sort | uniq -c  # MUST show distinct timestamps
# Smoke B: BFF pass-through
curl -s -H "Auth: Bearer <token>" http://localhost:13002/v1/memory/list | jq '.memories[].created_at' | sort | uniq -c  # MUST match Smoke A
# Smoke C: Dashboard browser
# Manual: open http://localhost:5173/memory/memories, verify per-row timestamps differ, scope tabs clickable
```

### Acceptance Criteria
- [ ] All test suites green
- [ ] Zero type errors / lint warnings
- [ ] Smoke A: distinct timestamps per row
- [ ] Smoke B: BFF matches REST
- [ ] Smoke C: browser manual test PASS
- [ ] Failure scenarios verified
