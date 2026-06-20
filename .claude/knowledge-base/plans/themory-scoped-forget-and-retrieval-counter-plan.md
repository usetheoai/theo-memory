---
slug: themory-scoped-forget-and-retrieval-counter
created_at: 2026-06-20
goal: Add a subject-scoped forget DELETE endpoint + a real persisted retrieval_api_usage counter so the gateway drops its O(scope) work.
---

# Plan: Subject-scoped forget + real retrieval_api_usage counter

> **Version 1.1** (edge-case MUST-FIX absorbed 2026-06-20: EC-1 hard-delete + entity-link FK cascade → T1.1; EC-2 metrics→counter seam via `AppOptions.usageCounterStore` → T2.4; EC-3 identical workspace-key normalization on increment/read/UNIQUE → T2.2. See `themory-scoped-forget-and-retrieval-counter-edge-cases-2026-06-20.md`.)

> **Version 1.0** — Two additive P0-hardening surfaces on TheMemory's REST/core so the theo-cloud gateway can drop O(scope) work: (1) `DELETE /v1/scopes/:type/:id/memories/:memId` (+`?hard`) deletes a memory ONLY if it belongs to the named subject scope (cross-scope/cross-workspace → 404, no existence leak), retiring the gateway's O(scope) `listAll()` IDOR pre-check; (2) a persisted per-scope `recall()` counter feeds the existing `GET /v1/scopes/:type/:id/metrics` so `retrieval_api_usage` stops hardcoding 0. Both are backward-compatible (the old `POST /v1/forget` stays; the metric shape is unchanged); the gateway cutover is a sequenced follow-up, NOT in this plan's critical path.

## Goal

> "Enable the theo-cloud gateway to delete a memory by id without an O(scope) ownership pre-check AND read a real recall-usage number, measured by the integration test `themory-scoped-forget-and-retrieval-counter` returning (a) `DELETE /v1/scopes/user/alice/memories/{id}` → 204 for an owned id + 404 for a cross-scope id, and (b) `retrieval_api_usage` > 0 after one `recall()` against real `ankane/pgvector:v0.5.1`."

## Context

Hardening item from CLAUDE.md § "Hardening candidates surfaced by cross-validation" → "Gateway-facing read endpoints … (+ subject-scoped forget)", classified P0 sub-goal 1+2, sequenced "AFTER the theo-cloud integration round-trip is green" (now true — the entity-graph integration shipped as theo-cloud v0.4.0 / theo-memory v0.11.0 2026-06-20).

Scoping (read-only Explore, this session) found that two thirds of the original item already shipped: `GET /v1/scopes/:type/:id/metrics` exists (`metrics.ts:44`) and the gateway already calls it (`internal/themory/client.go:426`), and `GET /v1/entities` returns real extracted nodes post-slice1/2. The two genuine gaps remain: the gateway still pages the whole scope (`listAll()`, `internal/themory/client.go:553-580`) to ownership-check a `forget`, and the metrics endpoint hardcodes `retrieval_api_usage: 0` (`metrics.ts:67`) because no recall counter is persisted. This plan closes exactly those two.

Per project owner decision (2026-06-20 AskUserQuestion): scope = forget DELETE + real retrieval counter; endpoint shape = `DELETE`; sequencing = theo-memory-first/backward-compatible.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/memory-store.ts` | ~120 | `memory-store.ts:73` (ScopedMemory iface) | Declares the `ScopedMemory` contract (`remember`/`recall`/`getAll`, no `forget` today) | additive: add `forget(id, options?)`; existing methods unchanged |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 323+ | `class LocalScopedMemory` :174 (recall :255, getAll :323) | `LocalScopedMemory` — the scope-bound impl that delegates to `LocalMemory` + store with `filters` | recall behavior unchanged; counter increment is fail-soft + post-result |
| `packages/core/src/infrastructure/db/local-memory.ts` | 213+ | forget :147-213 (`b2909ff` era) | Top-level workspace-checked forget (soft via `t_invalid`, hard via `vectorStore.delete`, history `forget` event) | workspace guard + 404-not-403 discipline preserved; reused by the scoped path |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | 795+ | delete :636 | The pgvector adapter (raw SQL); soft/hard delete primitives | additive: a scope-checked delete primitive; existing `delete()` unchanged |
| `packages/core/src/domain/dip/usage-counter-store.ts` (NEW) | 0 | — | (to be created) the recall-counter DIP port | — |
| `packages/core/src/infrastructure/db/pg-usage-counter-store.ts` (NEW) | 0 | — | (to be created) `PgUsageCounterStore` UPSERT-increment impl | — |
| `packages/core/src/infrastructure/db/migrations/0020_scope_usage_counters.sql` (NEW) | 0 | — | (to be created) additive migration — counter table | additive; no DROP/ALTER of existing tables |
| `packages/core/src/infrastructure/db/schema.ts` | 596 | `b02bbf9` (2026-06-20) | drizzle schema | additive: declare `scope_usage_counters`; existing tables unchanged |
| `packages/core/src/infrastructure/db/factory.ts` | 267 | entity/graph wiring :185-189 | `createLocalMemory`; wires Phase-7 ports behind `entityBoost`/PgvectorStore gate | wire the counter store the SAME gated way; existing wiring unchanged |
| `packages/core/src/domain/memory-event.ts` | 96 | MEMORY_EVENTS :16 (23 literals) | typed OTel event union | additive: append 1 literal `retrieval_counted_failed`; existing unchanged |
| `packages/core/src/index.ts` | 172 | `a80a4e6` (2026-06-20) | core public barrel | additive: export `PgUsageCounterStore` + types |
| `packages/core/src/domain/index.ts` | 177+ | `a80a4e6` (2026-06-20) | domain barrel | additive: re-export `UsageCounterStore` port type |
| `packages/api/src/server/handlers/scoped-forget.ts` (NEW) | 0 | — | (to be created) the `DELETE …/memories/:memId` handler | — |
| `packages/api/src/server/handlers/metrics.ts` | 71 | `metrics.ts:44` | `GET …/metrics` (O(scope) counts; `retrieval_api_usage:0` :67) | 4-field shape unchanged; only `retrieval_api_usage` source changes 0 → real |
| `packages/api/src/server/app.ts` | 354 | route table :236-343 | `createServer`; route registration | additive: register the `DELETE` route + its rate-limit; existing routes unchanged |
| `packages/api/src/server/openapi-registration.ts` | 412 | metrics reg :174-196 | OpenAPI 3.1 registry | additive: register the DELETE path |
| `packages/cli/src/run-server.ts` | — | slice-1 F-M1 | `themory server` injects stores | inject `PgUsageCounterStore` the same way |
| `tests/integration/scoped-forget-and-counter.test.ts` (NEW) | 0 | — | (to be created) GOAL test | — |

### Current callers / dependents

- **Symbol:** `ScopedMemory` interface (`packages/core/src/domain/memory-store.ts:73`)
  - Callers (production): `packages/api/src/server/handlers/metrics.ts:33`, `scopes.ts:60`, `entities.ts`, `graph.ts` (all `pathParamsToScoped` → `memory.user|session|agent(id)`); `LocalScopedMemory` impl at `scoped-memory.ts:174`.
  - Adding a method to the interface forces the impl (`LocalScopedMemory`) to implement it — compile-checked. No external repo implements `ScopedMemory` (it is consumed, not implemented, downstream).
- **Symbol:** `metricsHandler` (`packages/api/src/server/handlers/metrics.ts:44`)
  - Callers (production): `packages/api/src/server/app.ts` (route `GET /v1/scopes/:type/:id/metrics`). Cross-repo consumer: theo-cloud `internal/themory/client.go:426` `Metrics()` → dashboard `memory.tsx` (4-field `MemoryMetrics`). Shape MUST stay 4 fields.
- **Symbol:** `recall` (`LocalScopedMemory.recall`, `scoped-memory.ts:255`)
  - Callers (production): the REST `recall` handler + every SDK `memory.user(id).recall(...)` caller. The counter increment lives HERE so ALL recall paths count, not just REST.

### Domain glossary

- **subject scope** — the `(type,id)` tuple in `/v1/scopes/:type/:id/...`, mapped to a scope-tier column (`user_id`/`session_id`/`agent_id`). The gateway isolates customers by subject-in-path under one workspace master key.
- **workspace** — the outer tenant boundary (`workspace_id`), resolved from the API credential (`Principal`). Forget already guards on it; subject-scope is a NARROWER check on top.
- **soft delete** — set `t_invalid = NOW()` (row hidden from currently-valid queries, survives for GDPR/audit). Hard delete (`?hard=true`) physically removes the row.
- **404-not-403 discipline** — a cross-scope/cross-workspace/missing id returns 404 (never 403), so an attacker cannot distinguish "not yours" from "doesn't exist" (no existence leak).
- **fail-soft** — a non-load-bearing side effect (counter increment) must NEVER fail the primary operation (`recall()`); on error it emits an OTel event + warns, and the recall result is returned regardless.

### Architecture boundaries affected

- `rules/architecture.md § 3 (Dependency direction / DIP)`: the recall counter is a new DIP — the **domain** declares the `UsageCounterStore` port; the **infrastructure** (`PgUsageCounterStore`) implements it; the factory injects it. The domain MUST NOT import the pg impl. Same boundary the entity/graph stores already respect.
- `rules/architecture.md § 9 (Public API surface)`: `ScopedMemory.forget()` is a NEW public method on a contract export — additive, narrowable, JSDoc'd, contract-tested (per P0 sub-goal 1).
- `rules/architecture.md § 8 (Error handling)` + Princípio 3 (auditable): the counter is fail-soft with a typed OTel event; the scoped forget surfaces typed 404 (no existence leak).

## Prior Art & Related Work

- **Internal — entity/graph ports** (`packages/core/src/infrastructure/db/factory.ts:185-189` + `pg-memory-graph-store.ts`): the exact DIP + factory-gating shape this plan mirrors for `UsageCounterStore` (port in domain, Pg impl, gated wiring). This plan's counter store is the same pattern as `PgMemoryEntityStore`/`PgMemoryGraphStore`.
- **Internal — workspace-scoped forget discipline** (`packages/api/src/server/handlers/forget.ts:34-48`): the 404-not-403 / `MemoryNotFound`+`WorkspaceMismatch` mapping the new scoped-forget reuses verbatim, NARROWED by subject scope.
- **Internal — metrics endpoint honesty note** (`packages/api/src/server/handlers/metrics.ts:11-20`): documents `retrieval_api_usage:0` as a known follow-up; this plan IS that follow-up.
- **Cross-repo — gateway O(scope) pre-check** (`theo-cloud/internal/themory/client.go:553-580`): the consumer this plan unblocks; the gateway cutover is sequenced after (out of this plan's critical path).
- **External — UPSERT counter idempotency**: Postgres `INSERT … ON CONFLICT … DO UPDATE SET count = table.count + 1` (the standard atomic-increment idiom; same shape as the existing edge `ON_CONFLICT` upsert in `pg-memory-graph-store.ts:30-33`).

## Dependencies

**No new dependencies introduced, used-for-the-first-time, or removed.** This plan uses only packages already in `packages/core/package.json` + `packages/api/package.json`:

| Package | Version (existing) | Role here | New? |
|---|---|---|---|
| `pg` | existing (pinned in lockfile) | `PgUsageCounterStore` + `deleteInScope` raw SQL | No |
| `zod` | existing | REST query/param validation in `scoped-forget.ts` | No |
| `hono` | existing | DELETE route registration | No |
| `drizzle-orm` | existing | `scope_usage_counters` schema declaration | No |

No version bumps. No transitive additions. `/deps-audit` CVE scan applies to the existing locked set (unchanged by this plan).

## Objective

- [ ] `ScopedMemory.forget(id, options?: { hard? })` added to the contract + implemented in `LocalScopedMemory`, scope-checked (cross-scope → `MemoryNotFound`).
- [ ] `DELETE /v1/scopes/:type/:id/memories/:memId` (+`?hard=true`) returns 204 (owned) / 404 (cross-scope, cross-workspace, missing) / 422 (bad memId) / 404 (bad type) — no existence leak.
- [ ] OpenAPI 3.1 registers the DELETE path.
- [ ] `scope_usage_counters` table (migration 0020) + `UsageCounterStore` DIP + `PgUsageCounterStore` UPSERT-increment.
- [ ] `LocalScopedMemory.recall()` increments the scope's recall counter fail-soft (a counter error NEVER fails `recall()`).
- [ ] `metrics.ts` reads the real `retrieval_api_usage` from the counter (4-field shape unchanged; falls back to 0 when the store is absent).
- [ ] GOAL integration test green against real `ankane/pgvector:v0.5.1`.

## ADRs

### D1 — Subject-scoped forget as a new `ScopedMemory.forget(id, options?)` method (single scope-checked delete)
- **Decision:** Add `forget` to the `ScopedMemory` contract; `LocalScopedMemory.forget` performs a scope-checked delete (the row's `workspace_id` AND the bound scope-tier column must match `filters`) in the store, returning matched/not; 0 matched → `MemoryNotFound`.
- **Rationale:** Lets the REST handler do a single scope-narrowed delete (the server already holds the scope), so the **gateway** can replace its O(scope) `listAll()` pre-check with one `DELETE` call. DIP-clean (mirrors entity/graph ports).
- **Alternatives considered:** (a) Handler-level `getAll()` + find + top-level `forget` — REJECTED: re-introduces O(scope) on the server, defeating the purpose. (b) Keep only top-level `POST /v1/forget` — REJECTED: the gateway can never drop its O(scope) check because workspace-scope ≠ subject-scope.
- **Consequences:** New public API on `ScopedMemory` (additive, contract-tested). The scope-check is one extra WHERE clause; no read-then-write race (single SQL).

### D2 — Persist recall usage in a dedicated `scope_usage_counters` table, NOT a `history` event
- **Decision:** New table `scope_usage_counters(workspace_id, user_id, session_id, agent_id, recall_count, updated_at)` with a UNIQUE on the scope tuple; `recall()` does `INSERT … ON CONFLICT … DO UPDATE SET recall_count = recall_count + 1`. `metrics.ts` reads `recall_count`.
- **Rationale:** A recall is NOT tied to one memory; the `history` table's `memory_id` FK (CASCADE, `schema.ts:442-459`) cannot represent a recall event without a fake memory id. A scope-keyed counter is the correct grain, O(1) to read, atomic to increment.
- **Alternatives considered:** (a) `history` row `event='RECALL'` — REJECTED: violates the `memory_id` FK semantics; counting would scan history O(events). (b) OTel counter only — REJECTED: not queryable per-scope by the metrics endpoint (the requirement). (c) Column on `memories` — REJECTED: recall is scope-level, not row-level.
- **Consequences:** One new small table + migration. Read is a single indexed lookup. Counter is monotonic per scope (matches `add_events` semantics: cumulative, not "active").

### D3 — Counter increment is FAIL-SOFT and lives in the core recall path (not the REST handler)
- **Decision:** Increment inside `LocalScopedMemory.recall()` AFTER the result is computed, wrapped in try/catch; on error emit `retrieval_counted_failed` (new MEMORY_EVENTS literal) + `console.warn` and return the recall result unchanged.
- **Rationale:** (a) Placing it in core counts ALL `recall()` callers (SDK + REST), not just REST. (b) Fail-soft per `rules/architecture.md § 8` + Princípio 3 — a metrics side effect must NEVER fail a user's recall. Mirrors the entity/edge-linking fail-soft already in the write pipeline.
- **Alternatives considered:** (a) Increment in the REST recall handler — REJECTED: SDK recalls wouldn't count; the metric would under-report. (b) Transactional with the recall query — REJECTED: a counter DB blip would fail the user's read.
- **Consequences:** Counter may very rarely under-count (on increment failure) — acceptable + observable via the OTel event. Recall latency gains one fire-and-checked UPSERT (gated; skipped when the store is absent).

### D4 — `UsageCounterStore` wired behind the same `entityBoost`/PgvectorStore factory gate; metrics falls back to 0 when absent
- **Decision:** Wire `PgUsageCounterStore` in `createLocalMemory` the same gated way as the entity/graph stores; when the store is not wired (e.g. in-memory adapter, `entityBoost:false`), `recall()` skips the increment and `metrics.ts` reports `retrieval_api_usage: 0` (honest, not fabricated).
- **Rationale:** Consistency with the existing optional-port pattern; keeps the in-memory adapter + bundle isolation intact (no new hard dep in the default barrel).
- **Alternatives considered:** Always-on counter — REJECTED: would force a pg pool on the in-memory adapter, breaking unit tests + bundle isolation.
- **Consequences:** `retrieval_api_usage` is real ONLY on the pg runtime (the production + gateway path) — exactly where it is consumed. In-memory keeps 0 honestly.

### D5 — theo-memory-first, backward-compatible; gateway cutover out of scope
- **Decision:** The existing `POST /v1/forget` stays unchanged; the `DELETE` route is additive; the metric shape is unchanged. The theo-cloud gateway change (drop `listAll()`, call DELETE) is a SEQUENCED FOLLOW-UP, not in this plan.
- **Rationale:** Server backward-compat means no deploy-order coupling; the gateway migrates with no deadline pressure (Explore § sequencing recommendation B).
- **Alternatives considered:** Coordinated dual-repo deploy — REJECTED: unnecessary coupling; backward-compat removes the risk.
- **Consequences:** A second small theo-cloud plan follows. This plan's GOAL test exercises the new endpoint directly (not via the gateway).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| New `scope_usage_counters` table + migration adds schema surface | Low | Additive migration (no ALTER/DROP); same idiom as 0018/0019; smoke-tested in integration | core |
| Counter increment adds a write to the read path (recall) | Low | Single UPSERT, gated (skipped when store absent), fail-soft; benchmark recall p50 before/after | core |
| `recall_count` is cumulative (never decremented on forget) — could be read as "active retrievals" | Medium | Document semantics in OpenAPI + metrics JSDoc: it is a cumulative usage counter (matches `add_events`), not a live gauge | core |
| New `ScopedMemory.forget` is public API — wrong scope-check could delete the wrong row OR leak existence | High | Single SQL with workspace AND scope-tier WHERE; 404-not-403; integration test asserts cross-scope + cross-workspace both 404 and the other row untouched | core |
| Concurrent recalls race on the same counter row (lost update) | Medium | `ON CONFLICT DO UPDATE SET recall_count = recall_count + 1` is atomic in PG; concurrency test asserts N concurrent recalls → count == N | core |

## Unresolved Questions

- Q1 — Should `retrieval_api_usage` be cumulative-forever or windowed (e.g. last 30d)? This plan ships cumulative (matches `add_events`); a windowed variant is a follow-up if billing needs it. (`/edge-case-plan` to confirm cumulative is acceptable for the dashboard/billing consumer.)
- Q2 — RESOLVED (EC-1, v1.1): hard delete of an entity-linked memory is handled in T1.1 — verify 0018/0019 FK behavior; CASCADE/SET NULL if present, else delete child rows first in the same tx. Covered by `test_hard_forget_of_entity_linked_memory_succeeds`.
- Q3 — Should the counter also count `recall()` that returns zero results? This plan counts every `recall()` call (a call IS API usage). Confirm with billing intent.

## Dependency Graph

```
Phase 1 (scoped forget)  ──┐
                           ├──▶ Phase 3 (Integration Validation)
Phase 2 (recall counter) ──┘

Phase 1 and Phase 2 are INDEPENDENT (different files: forget path vs recall path)
and MAY be implemented in parallel. Phase 3 requires both.
```

---

## Phase 1: Subject-scoped forget

**Objective:** Ship `DELETE /v1/scopes/:type/:id/memories/:memId` backed by a scope-checked `ScopedMemory.forget`, with 404-not-403 discipline.

### T1.1 — Add scope-checked `forget` to the core contract + `LocalScopedMemory`

#### Objective
Add `forget(id, options?: { hard?: boolean })` to `ScopedMemory` and implement it so a memory is deleted only when its `workspace_id` AND the bound scope-tier column match `filters`.

#### Why this step (action + reasoning)
1. **What this step does** — declare `forget` on the `ScopedMemory` interface (`memory-store.ts:73`), implement it in `LocalScopedMemory` (`scoped-memory.ts:174`) via a new scope-checked store primitive in `pgvector-store.ts`.
2. **Why now** — D1: the REST DELETE handler (T1.2) needs a scope-narrowed delete to exist before it can route to it; the gateway can only drop its O(scope) check once this single-SQL path exists.

#### Evidence
- `ScopedMemory` has no `forget` today (`memory-store.ts:73` declares `remember`/`recall`/`getAll`; grep of `scoped-memory.ts` shows only those three impls).
- Top-level workspace-checked forget exists at `local-memory.ts:147-213` (soft via `t_invalid`, hard via `vectorStore.delete`, history `forget` event) — reuse its delete primitives, NARROW with the scope-tier WHERE.

#### Files to edit
```
packages/core/src/domain/memory-store.ts — add forget(id, options?) to ScopedMemory interface + JSDoc
packages/core/src/infrastructure/db/scoped-memory.ts — implement LocalScopedMemory.forget (delegates to scope-checked store delete)
packages/core/src/infrastructure/db/pgvector-store.ts — add deleteInScope(id, filters, hard): Promise<boolean> (matched?) — single SQL with workspace + scope-tier WHERE
packages/core/src/infrastructure/db/scoped-memory.test.ts — RED tests first
```

#### Deep file dependency analysis
- `memory-store.ts` (Baseline row 1): adding a method to the interface forces `LocalScopedMemory` to implement it (compile-checked); no external implementer.
- `pgvector-store.ts` (Baseline row 4): add `deleteInScope` next to `delete()` (:636); soft path sets `t_invalid=NOW()` WHERE `id AND workspace_id AND <tier>=<bound>`; hard path `DELETE` same WHERE; returns `rowCount > 0`.
- `scoped-memory.ts` (Baseline row 2): `forget` reads `this.filters` (the scope binding) and calls `deleteInScope`; 0 matched → throw `MemoryNotFound`.

#### Deep Dives
- Invariant: the WHERE MUST include BOTH `workspace_id = filters.workspace_id` AND the active tier column (`user_id`/`session_id`/`agent_id` = the bound value). A cross-scope id within the same workspace MUST NOT match → 404.
- Edge cases: id not a UUID (handled at REST 422 in T1.2); id valid but other scope → 0 rows → MemoryNotFound; already soft-deleted + soft again → 0 rows matched (idempotent 404 — soft WHERE includes `t_invalid IS NULL`, EC-4).
- **EC-1 (hard delete + entity-link FK):** a memory created post-slice1/2 may have `memory_entities.memory_id` rows AND be a `entity_edges.source_memory_id`. BEFORE the hard `DELETE FROM memories`, verify the child FK behavior: if `memory_entities`/`entity_edges` are NOT `ON DELETE CASCADE`/`SET NULL` against `memories.id`, the hard path MUST delete the child rows first in the SAME transaction (else the DELETE throws FK violation → 500). Confirm by reading the 0018/0019 migration FK clauses; prefer relying on existing CASCADE if present, else delete-children-first. The soft path is unaffected (no row removal).

#### Pseudo-code / Signatures
```pseudocode
interface ScopedMemory { forget(id: string, options?: { hard?: boolean }): Promise<void>; ... }

LocalScopedMemory.forget(id, options):
  matched = await store.deleteInScope(id, this.filters, options?.hard ?? false)
  if not matched: throw new MemoryNotFound(id)

PgvectorStore.deleteInScope(id, filters, hard) -> boolean:
  tierCol = filters.user_id ? 'user_id' : filters.session_id ? 'session_id' : 'agent_id'
  if hard: res = DELETE FROM memories WHERE id=$1 AND workspace_id=$2 AND {tierCol}=$3
  else:    res = UPDATE memories SET t_invalid=NOW() WHERE id=$1 AND workspace_id=$2 AND {tierCol}=$3 AND t_invalid IS NULL
  return res.rowCount > 0

# Example: memory M belongs to user 'alice'.
deleteInScope(M.id, {workspace_id:'w', user_id:'bob'}, false)  -> false  (cross-subject → 404)
deleteInScope(M.id, {workspace_id:'w', user_id:'alice'}, false) -> true   (204)
```

#### Tasks
1. Add `forget` to `ScopedMemory` interface + JSDoc (`@see` this plan).
2. Add `deleteInScope` to `PgvectorStore` (soft + hard).
3. Implement `LocalScopedMemory.forget`.
4. (If an in-memory store adapter implements the same store interface, add `deleteInScope` there too for unit tests.)

#### TDD
```
RED: test_forget_deletes_an_owned_memory_in_scope() — user(alice).forget(id) → row soft-deleted (t_invalid set); subsequent getAll excludes it
RED: test_forget_cross_subject_throws_MemoryNotFound() — user(bob).forget(alice's id) → MemoryNotFound; alice's row untouched
RED: test_forget_cross_workspace_throws_MemoryNotFound() — different workspace_id → MemoryNotFound; row untouched
RED: test_forget_hard_physically_removes_in_scope() — forget(id,{hard:true}) → store.get(id) null
RED: test_hard_forget_of_entity_linked_memory_succeeds() — EC-1: a memory with memory_entities + entity_edges rows → forget(id,{hard:true}) succeeds (no FK violation); child rows gone/nulled
RED: test_double_soft_forget_returns_404() — EC-4: second soft forget of an already-soft-deleted id → MemoryNotFound (idempotent)
GREEN: implement deleteInScope + LocalScopedMemory.forget
REFACTOR: extract tierCol resolution if duplicated with existing filter helpers
VERIFY: npm test -- scoped-memory
```

#### Concurrency tests
```
(none — single-threaded) — forget is a single SQL statement; no shared in-process state. Cross-statement atomicity is the DB's (single UPDATE/DELETE).
```

#### Acceptance Criteria
- [ ] `ScopedMemory.forget` exists, JSDoc'd, contract-typecheck green.
- [ ] cross-subject AND cross-workspace both → `MemoryNotFound` (404 upstream), other row untouched.
- [ ] Pass: coverage — `npm run test:coverage` 100% on the new `deleteInScope` + `forget` (critical path).
- [ ] Pass: lint zero warnings; Pass: size — files ≤ 500 LoC.

#### DoD
- [ ] `npm test` green · `npm run test:type` zero errors · lint clean.

### T1.2 — `DELETE /v1/scopes/:type/:id/memories/:memId` REST handler + route + OpenAPI

#### Objective
Expose T1.1 over REST with full input validation + 404-not-403 discipline.

#### Why this step (action + reasoning)
1. **What this step does** — new handler `scoped-forget.ts`, route in `app.ts`, OpenAPI registration.
2. **Why now** — D1/D5: the endpoint is the gateway's drop-in replacement for its O(scope) pre-check; it must validate type/id/memId at the boundary (Princípio: fail at the edge).

#### Evidence
- Route registration pattern: `app.ts:326` (`app.get('/v1/scopes/:type/:id/memories', ...)`); `app.delete` already used (`:304` admin keys). Rate-limit pattern `app.post('/v1/forget', rateLimitMiddleware('write'))` (`:237`).
- 404-not-403 mapping to copy: `forget.ts:44-46` (`MemoryNotFound`/`WorkspaceMismatch` → 404).
- scope resolution helper to mirror: `metrics.ts:33-42` `pathParamsToScoped` (user/session/agent; NOT skill).

#### Files to edit
```
packages/api/src/server/handlers/scoped-forget.ts (NEW) — the handler
packages/api/src/server/app.ts — register DELETE route + rate-limit('write')
packages/api/src/server/openapi-registration.ts — register the DELETE path (mirror metrics :174-196)
packages/api/src/server/handlers/scoped-forget.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- `scoped-forget.ts`: validate `type ∈ {user,session,agent}` (404 on bad type, mirroring metrics), `memId` is UUID (422 INVALID otherwise), `hard` from `?hard=true` query; resolve `pathParamsToScoped(workspaceBoundMemory(c, memory), type, id).forget(memId, {hard})`; map `MemoryNotFound`/`WorkspaceMismatch` → 404; success → 204.
- `app.ts` (Baseline row): add `app.delete('/v1/scopes/:type/:id/memories/:memId', ...)` + `app.delete('/v1/scopes/*', rateLimitMiddleware('write'))` (or path-specific) BEFORE the handler; do not disturb the existing `app.get('/v1/scopes/*', rateLimitMiddleware('read'))` (`:240`).

#### Deep Dives
- Invariant: subject from PATH + workspace from auth; NEVER from body (no IDOR). The body is empty (DELETE).
- Edge: `?hard=anything-but-true` → soft (default). `memId` not UUID → 422 (not 404 — it's a malformed request, distinct from "not found"). Skill type → 404 (skill scope has no per-memory DELETE; consistent with scopes.ts 501-for-listing but here 404 keeps the surface minimal).

#### Pseudo-code / Signatures
```pseudocode
DELETE /v1/scopes/:type/:id/memories/:memId?hard=
  if type not in {user,session,agent}: 404
  if memId not uuid: 422 INVALID
  scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), type, id)
  try: await scoped.forget(memId, { hard: query.hard === 'true' }); return 204
  catch MemoryNotFound|WorkspaceMismatch: return 404 NOT_FOUND
```

#### Tasks
1. Write `scoped-forget.ts` handler.
2. Register route + write rate-limit in `app.ts`.
3. Register OpenAPI path.

#### TDD
```
RED: test_delete_owned_returns_204() — seeded alice memory → DELETE …/user/alice/memories/{id} → 204; gone from getAll
RED: test_delete_cross_subject_returns_404() — DELETE …/user/bob/memories/{alice id} → 404; alice row intact
RED: test_delete_bad_memId_returns_422() — non-uuid → 422
RED: test_delete_bad_type_returns_404() — type=foo → 404
RED: test_delete_hard_query_physically_removes() — ?hard=true → row hard-gone
GREEN: implement handler + route + openapi
REFACTOR: share pathParamsToScoped/scope-type enum with metrics.ts if duplicated (extract to _scope-params.ts)
VERIFY: npm test -- scoped-forget
```

#### Concurrency tests
```
(none — single-threaded) — handler delegates to the single-SQL core forget.
```

#### Acceptance Criteria
- [ ] 204/404/422 paths all asserted; no 403 anywhere (no existence leak).
- [ ] OpenAPI `GET /v1/openapi.json` includes the DELETE path.
- [ ] Pass: coverage 100% on handler; lint clean; size ≤ 500.

#### DoD
- [ ] `npm test` green · typecheck clean · lint clean · CHANGELOG `[Unreleased]` updated.

---

## Phase 2: Real `retrieval_api_usage` counter

**Objective:** Persist a per-scope recall counter and surface it through the existing metrics endpoint.

### T2.1 — `scope_usage_counters` table (migration 0020) + drizzle schema

#### Objective
Create the additive counter table keyed by the scope tuple.

#### Why this step (action + reasoning)
1. **What this step does** — migration `0020_scope_usage_counters.sql` + `schema.ts` declaration.
2. **Why now** — D2: the store impl (T2.2) needs the table; migrations are sequential (0019 is the latest).

#### Evidence
- Latest migration `0019_entity_edges.sql` (`ls migrations/`); next is 0020.
- Schema declaration pattern: `schema.ts:442-459` (history table) + the entity tables (0018).

#### Files to edit
```
packages/core/src/infrastructure/db/migrations/0020_scope_usage_counters.sql (NEW)
packages/core/src/infrastructure/db/schema.ts — declare scope_usage_counters
packages/core/src/infrastructure/db/schema.test.ts — RED (table shape / unique)
```

#### Deep Dives
- Columns: `workspace_id text NOT NULL DEFAULT 'default'`, `user_id text`, `session_id text`, `agent_id text`, `recall_count bigint NOT NULL DEFAULT 0`, `updated_at timestamptz NOT NULL DEFAULT NOW()`.
- UNIQUE on `(workspace_id, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,''))` — the ON CONFLICT arbiter (same COALESCE idiom as the edge unique, `pg-memory-graph-store.ts:30-33`).
- Additive only; no FK to `memories` (a scope counter outlives individual rows).

#### Tasks
1. Write the SQL migration (CREATE TABLE + UNIQUE index).
2. Declare in drizzle `schema.ts`.
3. Update the migrations meta if drizzle journal requires (check `migrations/meta`).

#### TDD
```
RED: test_migration_0020_creates_scope_usage_counters() — after runMigrations, table + unique index exist (integration, real pg)
GREEN: write SQL + schema
REFACTOR: none expected
VERIFY: npm run test:integration -- schema
```

#### Concurrency tests
```
(none — single-threaded) — schema creation; concurrency tested in T2.2 (the UPSERT).
```

#### Acceptance Criteria
- [ ] `runMigrations` applies 0020 idempotently; drizzle journal in sync (no F-T7-1-3 regression).
- [ ] Pass: lint/size.

#### DoD
- [ ] `npm run test:integration` green for schema.

### T2.2 — `UsageCounterStore` DIP + `PgUsageCounterStore` (atomic UPSERT) + factory wiring + barrel export

#### Objective
A port + pg impl that atomically increments + reads the scope's recall counter.

#### Why this step (action + reasoning)
1. **What this step does** — domain port `usage-counter-store.ts`, impl `pg-usage-counter-store.ts` (UPSERT +1 + `getRecallCount(filters)`), factory wiring (gated), barrel exports.
2. **Why now** — D2/D4: the recall path (T2.3) + metrics (T2.4) both depend on this port.

#### Evidence
- DIP + factory pattern to mirror: `factory.ts:185-189` (entity/graph stores) + `pg-memory-graph-store.ts` (raw-SQL pg impl, ON CONFLICT upsert `:30-33`).

#### Files to edit
```
packages/core/src/domain/dip/usage-counter-store.ts (NEW) — port: increment(filters), getRecallCount(filters)
packages/core/src/infrastructure/db/pg-usage-counter-store.ts (NEW) — PG impl (ON CONFLICT +1)
packages/core/src/infrastructure/db/factory.ts — wire PgUsageCounterStore (same entityBoost/PgvectorStore gate)
packages/core/src/index.ts + domain/index.ts — export PgUsageCounterStore + UsageCounterStore type
packages/core/src/infrastructure/db/pg-usage-counter-store.test.ts (NEW) — RED
```

#### Deep Dives
- `increment(filters)`: `INSERT INTO scope_usage_counters(...) VALUES(...) ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,'')) DO UPDATE SET recall_count = scope_usage_counters.recall_count + 1, updated_at = NOW()`.
- `getRecallCount(filters): Promise<number>` — single SELECT with the IDENTICAL `WHERE workspace_id=$1 AND COALESCE(user_id,'')=COALESCE($2,'') AND COALESCE(session_id,'')=COALESCE($3,'') AND COALESCE(agent_id,'')=COALESCE($4,'')`; 0 if no row.
- **EC-3 (one normalization, three places):** the UNIQUE index, the `increment` ON CONFLICT arbiter, AND the `getRecallCount` WHERE MUST use the SAME `COALESCE(col,'')` expression for all four scope columns; the TS side normalizes `workspace_id` to `filters.workspace_id ?? 'default'` BEFORE the query so write + read agree. Copy the edge-store idiom verbatim (`pg-memory-graph-store.ts:30-33`). A mismatch splits the counter (write one row, read another → metric stays 0).
- Invariant: atomic increment (no lost update under concurrent recalls).

#### Pseudo-code / Signatures
```pseudocode
interface UsageCounterStore {
  increment(filters: Filters): Promise<void>
  getRecallCount(filters: Filters): Promise<number>
}
```

#### Tasks
1. Define the port.
2. Implement the pg adapter (UPSERT + SELECT).
3. Wire in factory (gated); export from barrels.

#### TDD
```
RED: test_increment_creates_then_bumps() — increment×3 for user(alice) → getRecallCount == 3 (integration, real pg)
RED: test_counts_are_scope_isolated() — increment user(alice) does NOT change user(bob) or session(x)
RED: test_increment_and_read_agree_on_workspace_key() — EC-3: increment with workspace undefined (→'default') then getRecallCount with workspace undefined → reads the SAME row (== 1), not 0
GREEN: implement port + impl + wiring
REFACTOR: none expected
VERIFY: npm run test:integration -- usage-counter
```

#### Concurrency tests
```
Atomic-counter invariant — N=50 concurrent increment(user(alice)) via Promise.all against real pg →
getRecallCount == 50 (no lost update). Asserts the ON CONFLICT DO UPDATE SET count = count + 1 atomicity.
VERIFY: npm run test:integration -- usage-counter-concurrency
```

#### Acceptance Criteria
- [ ] 50 concurrent increments → count == 50 (atomicity proven).
- [ ] scope isolation asserted; barrel exports resolve (smoke import).
- [ ] Pass: coverage 100% on the impl; lint/size clean.

#### DoD
- [ ] `npm run test:integration` green; `npm run test:type` clean.

### T2.3 — Fail-soft counter increment in `LocalScopedMemory.recall()`

#### Objective
Count every `recall()` without ever failing it.

#### Why this step (action + reasoning)
1. **What this step does** — after computing the recall result in `scoped-memory.ts:255`, call `usageCounterStore.increment(this.filters)` in a try/catch; on error emit `retrieval_counted_failed` + warn; return the result regardless.
2. **Why now** — D3: counting in core covers SDK + REST callers; fail-soft per error-handling rule.

#### Evidence
- recall impl at `scoped-memory.ts:255`; fail-soft precedent = entity-linking try/catch + `entity_linking_failed` event (`entity-linking.ts`).
- new event literal appended to `MEMORY_EVENTS` (`memory-event.ts:16`, currently 23 literals).

#### Files to edit
```
packages/core/src/domain/memory-event.ts — append 'retrieval_counted_failed'
packages/core/src/infrastructure/db/scoped-memory.ts — increment after recall result (fail-soft); skip when store undefined
packages/core/src/infrastructure/db/scoped-memory.test.ts — RED
```

#### Deep Dives
- Gate: only increment when `this.usageCounterStore !== undefined` (D4). 
- Fail-soft: `try { await inc } catch (e) { emitEvent(tracer,'retrieval_counted_failed',{error}); console.warn(...) }` — never rethrow.
- Order: increment AFTER the result is built so a counter failure can't lose the recall.
- **EC-6 (skill scope NOT counted):** this increment is in `LocalScopedMemory.recall` (user/session/agent) only. `ScopedSkillMemory.recall` (`scoped-skill-memory.ts:159`) is a separate class and the metrics endpoint is user/session/agent-only — skill recalls are intentionally out of this counter's scope. Document in the metrics JSDoc.

#### Pseudo-code / Signatures
```pseudocode
async recall(query, options):
  const result = <existing recall logic>
  if (this.usageCounterStore) {
    try { await this.usageCounterStore.increment(this.filters) }
    catch (e) { emitEvent(tracer,'retrieval_counted_failed',{error:String(e)}); warn() }
  }
  return result
```

#### Tasks
1. Append the event literal.
2. Thread `usageCounterStore` into `LocalScopedMemory` (constructor/deps).
3. Increment fail-soft after the result.

#### TDD
```
RED: test_recall_increments_counter() — recall() → getRecallCount == 1 (integration)
RED: test_recall_succeeds_when_counter_throws() — inject a throwing counter store → recall returns results + emits retrieval_counted_failed (no throw)
RED: test_recall_skips_increment_when_store_absent() — no store → recall works, no increment, no error
GREEN: implement
REFACTOR: none expected
VERIFY: npm run test:integration -- scoped-memory-recall && npm test -- scoped-memory
```

#### Concurrency tests
```
Atomic-counter invariant (end-to-end) — 20 concurrent recall() on user(alice) via Promise.all → getRecallCount == 20.
VERIFY: npm run test:integration -- recall-counter-concurrency
```

#### Acceptance Criteria
- [ ] recall NEVER throws on counter error (fail-soft asserted with a throwing stub).
- [ ] 20 concurrent recalls → count 20.
- [ ] Pass: coverage on the new branch 100%; lint/size.

#### DoD
- [ ] `npm test` + `npm run test:integration` green; typecheck clean.

### T2.4 — `metrics.ts` reads the real `retrieval_api_usage` (shape unchanged)

#### Objective
Replace the hardcoded `retrieval_api_usage: 0` with the counter value; keep the 4-field shape + 0-fallback when the store is absent.

#### Why this step (action + reasoning)
1. **What this step does** — `metrics.ts` reads `usageCounterStore.getRecallCount(filters)` for `retrieval_api_usage`; falls back to 0 when no store.
2. **Why now** — D4: this is the consumer-visible payoff; must keep the exact 4-field shape the gateway/dashboard parse.

#### Evidence
- `metrics.ts:67` hardcodes `retrieval_api_usage: 0`; the 4-field shape consumed by `theo-cloud client.go:114` + dashboard `memory.tsx` MemoryMetrics.

#### Files to edit
```
packages/api/src/server/app.ts — add AppOptions.usageCounterStore?: UsageCounterStore (mirror AppOptions.memoryEntityStore :138); pass it to metricsHandler
packages/api/src/server/handlers/metrics.ts — accept usageCounterStore?; read getRecallCount for retrieval_api_usage (0 fallback)
packages/cli/src/run-server.ts — inject PgUsageCounterStore into createServer options (mirror PgMemoryEntityStore injection)
packages/api/src/server/handlers/metrics.test.ts — RED
```

#### Deep Dives
- Invariant: response stays exactly `{ total_memories, entity_count, add_events, retrieval_api_usage }` (4 fields). `total_memories`/`add_events`/`entity_count` UNCHANGED (still `getAll`-derived). Only `retrieval_api_usage` source changes.
- **EC-2 (the seam):** the handler reaches the counter via a NEW `AppOptions.usageCounterStore?: UsageCounterStore` on `createServer` — the SAME optional-injection pattern as the existing `AppOptions.memoryEntityStore` (`app.ts:138`). `run-server.ts` injects `PgUsageCounterStore` (T2.2). `metricsHandler(c, memory, usageCounterStore?)` reads `usageCounterStore?.getRecallCount(filters) ?? 0`. When the option is omitted (in-memory adapter, tests) → 0 (D4, honest).
- The `filters` for `getRecallCount` MUST be the SAME scope filters the handler resolves via `pathParamsToScoped` (i.e. derive `{workspace_id, user_id|session_id|agent_id}` from the workspace-bound scope) so the read key matches what `recall()` incremented (EC-3).

#### Tasks
1. Thread the counter store (or a `getRecallCount` accessor) into the metrics handler.
2. Read the real value; 0-fallback.
3. Update the metrics JSDoc honesty note (no longer "always 0").

#### TDD
```
RED: test_metrics_reports_real_retrieval_usage() — after 2 recalls, GET …/metrics → retrieval_api_usage == 2; other 3 fields unchanged
RED: test_metrics_shape_is_exactly_four_fields() — response keys == {total_memories, entity_count, add_events, retrieval_api_usage}
RED: test_metrics_zero_when_counter_absent() — no store → retrieval_api_usage == 0 (honest)
GREEN: implement
REFACTOR: none expected
VERIFY: npm test -- metrics
```

#### Concurrency tests
```
(none — single-threaded) — read-only handler; the counted writes are tested in T2.3.
```

#### Acceptance Criteria
- [ ] `retrieval_api_usage` reflects real recalls; 4-field shape byte-identical; 0-fallback honest.
- [ ] Pass: coverage 100%; lint/size clean.

#### DoD
- [ ] `npm test` green; typecheck clean; CHANGELOG `[Unreleased]` updated.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Subject-scoped forget (core) | T1.1 | `ScopedMemory.forget` + `deleteInScope` scope-checked SQL |
| 2 | `DELETE …/memories/:memId` REST + 404-not-403 | T1.2 | new handler + route + OpenAPI |
| 3 | `?hard=true` honored | T1.1 (core) + T1.2 (query) | hard path in `deleteInScope` + query parse |
| 4 | No existence leak (cross-scope/workspace → 404) | T1.1, T1.2 | `MemoryNotFound`→404 tests for cross-subject + cross-workspace |
| 5 | Persisted recall counter table | T2.1 | migration 0020 + schema |
| 6 | Atomic per-scope increment | T2.2 | `PgUsageCounterStore` ON CONFLICT +1 + concurrency test |
| 7 | Count ALL recall() callers (SDK+REST), fail-soft | T2.3 | increment in core recall, gated, try/catch + OTel event |
| 8 | `retrieval_api_usage` real in metrics, shape unchanged | T2.4 | metrics reads counter, 4-field shape, 0-fallback |
| 9 | Backward-compat (POST /v1/forget + metric shape) | T1.2, T2.4 (D5) | additive route; identical 4-field payload |
| 10 | Wiring (factory + barrels + cli inject) | T2.2 | gated wiring + exports + run-server inject |

**Coverage: 10/10 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `npm test` green · `npm run test:integration` green (real pgvector) · `npm run test:type` zero errors · lint zero warnings
- [ ] File-size budget respected (≤ 500 LoC/file per `architecture.md`)
- [ ] CHANGELOG.md `[Unreleased]` updated (Added: DELETE scoped-forget + real retrieval_api_usage)
- [ ] Backward compatibility preserved — `POST /v1/forget` unchanged; metrics 4-field shape byte-identical
- [ ] No paper-names in `src/**` (per `no-paper-names-in-code.md`)
- [ ] **Runtime-metric proof** — `retrieval_api_usage` observed non-zero in the integration GOAL test after a real `recall()` (not just compiles)
- [ ] New public API (`ScopedMemory.forget`) JSDoc'd + contract-tested (P0 sub-goal 1)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Failure scenarios (I/O external — Postgres)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:scope_usage_counters` (DB) | counter UPSERT fails mid-recall (e.g. connection reset) | inject a throwing `UsageCounterStore` stub in the recall unit test | `recall()` returns results normally; `retrieval_counted_failed` OTel event emitted; NO throw to caller (T2.3) |
| `postgres:memories` (DB) | `deleteInScope` finds 0 rows (cross-scope/missing) | integration: DELETE another subject's id | 404 NOT_FOUND, no existence leak, target row untouched (T1.1/T1.2) |
| `postgres` (DB) | concurrent recalls race the same counter row | integration: `Promise.all` of N increments/recalls | final count == N (atomic ON CONFLICT; no lost update) (T2.2/T2.3) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Prove both surfaces work against real `ankane/pgvector:v0.5.1`.

### Execution
```
npm run test:type
npm test
npm run test:integration         # incl. tests/integration/scoped-forget-and-counter.test.ts (GOAL)
npm run lint
npm run test:coverage            # ≥90% changed files; 100% on deleteInScope/forget/counter
```

### Acceptance Criteria
- [ ] GOAL test green: DELETE owned → 204; DELETE cross-scope → 404 (other row intact); `retrieval_api_usage` > 0 after one recall.
- [ ] All suites green (unit + integration); coverage gate met.
- [ ] Zero type errors / zero lint warnings.
- [ ] Runtime-metric proof: `retrieval_api_usage` non-zero in the integration workload.
- [ ] Failure scenarios green (counter-throws fail-soft; cross-scope 404; concurrency count==N).

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures; re-run the chain.
3. Log pre-existing issues in the PR description (do not block).
