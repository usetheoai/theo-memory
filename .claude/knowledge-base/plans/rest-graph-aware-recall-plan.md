---
slug: rest-graph-aware-recall
milestone_id: RestGraphAwareRecall
created_at: 2026-06-23
goal: Expose RecallOptions.graphExpand on POST /v1/recall (additive zod field on the strict RecallBody + one-line handler mapping + auto-derived OpenAPI), default OFF, measured by a GOAL integration test where a REST recall with graphExpand surfaces a shared-entity below-threshold memory against real pgvector and a recall without it is byte-identical.
---

# Plan: rest-graph-aware-recall

> **Version 1.0** — entity-graph evolution (/goal "continuar evoluindo a entity-graph"). Exposes the graph-aware recall capability (`RecallOptions.graphExpand`, shipped v0.19.0 at the SDK layer) over the REST `POST /v1/recall` surface so gateway/MCP/HTTP consumers reach it. Additive: a bounded zod field on the strict `RecallBody` + a one-line handler mapping + the auto-derived OpenAPI. DEFAULT OFF (byte-unchanged), ZERO new dependency, NO core change, NO migration. Grounded in `rest-graph-aware-recall-blueprint.md` (SHIPPABLE, 0 hard caps).

## Goal

> "Expose `graphExpand` on `POST /v1/recall`: add `graphExpand: { hops?: 1|2; limit?: number }` to the strict zod `RecallBody`, destructure + pass it in `recallHandler`, OpenAPI auto-derives — measured by `tests/integration/rest-graph-aware-recall.test.ts`: against real `ankane/pgvector:v0.5.1` via the HTTP server, a `POST /v1/recall` with `graphExpand` surfaces a shared-entity below-threshold memory in the JSON `results`; the same POST WITHOUT `graphExpand` is byte-identical to today; an out-of-range `graphExpand.hops` is rejected 422."

## Context

graph-aware recall (`GraphExpansionStore` + pipeline Step 8.7 + `RecallOptions.graphExpand`) shipped v0.19.0 wired through `createLocalMemory` + the factory auto-default. The REST server (`@usetheo/memory/server`, Item 16) `recallHandler` (`packages/api/src/server/handlers/recall.ts:34`) destructures only `topK/threshold/attributedTo/asOf` from the strict zod `RecallBody` (`packages/api/src/server/schemas.ts`), so a `graphExpand` key is currently REJECTED by `.strict()` (422) — the feature is SDK-only. This plan adds the additive surface (mirror the existing `topK`/`threshold` mapping). The OpenAPI recall request references `RecallBody` directly (`openapi-registration.ts`), so the spec auto-derives. Honors P0 sub-goal 2 (SDK/REST functional) + `CLAUDE.md § Princípio 2`. Scope: ONLY `graphExpand` (rerank/adaptive REST exposure is a separate followup, ADR D3).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariant to preserve |
|---|---|---|---|---|
| `packages/api/src/server/schemas.ts` | 149 | — | strict zod request bodies (`RecallBody` = `.object().strict().superRefine(SingleScopeRefine)`) | additive optional `graphExpand` field; lands INSIDE `RecallBody`, not another body |
| `packages/api/src/server/handlers/recall.ts` | 44 | — | `recallHandler` destructures `RecallBody` → `scoped.recall(options)` (`:34`) | additive: destructure + pass `graphExpand`; no other logic change |
| `packages/api/src/server/openapi-registration.ts` | 545 | — | recall request `{ schema: RecallBody }` (`:90+`) | auto-derives — NO manual edit needed (verify the field appears) |
| `packages/api/src/server/__tests__/handlers.test.ts` | 407 | — | `POST /v1/recall` handler unit test (`:162`, `app.fetch`) | add a graphExpand-mapping unit assertion |
| `tests/integration/rest-graph-aware-recall.test.ts` (NEW) | 0 | — | GOAL: REST recall w/ graphExpand surfaces a shared-entity below-threshold memory vs real pgvector + default-unchanged + 422 | — |

### Current callers / dependents

- **`recallHandler`** (`recall.ts:34`) — destructures `{ query, topK, threshold, attributedTo, asOf }` then `scoped.recall(query, { topK, threshold, attributedTo, asOf })`. The exact mapping to extend.
- **`RecallBody`** (`schemas.ts`) — `z.object({ ...ScopeFields, query, topK, threshold, attributedTo, asOf }).strict().superRefine(SingleScopeRefine)`. The `.strict()` currently 422s an unknown `graphExpand` key.
- **`RecallOptions.graphExpand`** (`packages/core/src/domain/options.ts`) — `{ readonly hops?: 1 | 2; readonly limit?: number }`. The shape the zod field mirrors.
- **OpenAPI recall request** (`openapi-registration.ts:90+`) — `schema: RecallBody` → auto-derives the new field.
- **`createServer`** (`@usetheo/memory-api`) — accepts `{ memory }`; the GOAL constructs it with a real `createLocalMemory({ PgvectorStore })`.
- **graph-aware-recall internals** — `GraphExpansionStore` + Step 8.7 + factory auto-default (shipped v0.19.0); this plan is pure read-through, no core change.

### Domain glossary
- **graphExpand (REST)** — the recall-request field that, when present, makes the server's `scoped.recall` run the entity-graph pool-expansion (Step 8.7). `{ hops?: 1|2; limit?: number }`.
- **additive surface widening** — adding an optional field to a `.strict()` zod schema only WIDENS what is accepted; previously-422'd `graphExpand` bodies are now honored; omitting the field is byte-identical.

### Architecture boundaries affected

- **API layer (`packages/api/src/server/`)** — the change is confined to the REST adapter: the zod request schema + the handler mapping + the auto-derived OpenAPI. No domain/core change (architecture.md § 3 — the API depends on the core `Memory` contract, which already supports `graphExpand`).
- **No new public export** — `graphExpand` is a field on an existing request body, not a new exported symbol. The p0-audit export counts are UNCHANGED (no `domain/index.ts` edit).
- **Core (`packages/core`)** — untouched; `RecallOptions.graphExpand` + the pipeline + the store shipped v0.19.0.

## Prior Art & Related Work

- **Internal (load-bearing):** the existing `topK`/`threshold`/`asOf` mapping in `recall.ts` + the `RecallBody` zod schema (the exact pattern to mirror). The graph-aware-recall cycle (v0.19.0) shipped the SDK capability this exposes.
- **External:** mem0's client `search(query, options/filters)` (`.claude/knowledge-base/references/mem0/mem0/client/main.py:280`) — surfacing advanced recall knobs over the API is the norm.

## Dependencies

No new dependency. Reuses `zod` (schema), Hono (handler), `@asteasolutions/zod-to-openapi` (auto-derive) — all existing. The graph internals shipped v0.19.0. `/deps-audit` confirms below.

| Dependency | Version | New? | Rule 9 evaluation |
|---|---|---|---|
| (none) | — | No | A zod field + a handler line over existing deps + an already-shipped SDK capability; no library needed. No alternatives to evaluate. |

## ADRs

### D1 — Mirror `RecallOptions.graphExpand` as a bounded zod field on `RecallBody`
**Decision:** `graphExpand: z.object({ hops: z.union([z.literal(1), z.literal(2)]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().optional()`.
**Rationale:** byte-mirrors the SDK option; `.strict()` inner + bounded `hops` (literal `1|2` union, matching the SDK type) + `limit` ≤ 100 (DoS-guard parity with `topK`); optional keeps it default-OFF.
**Alternatives:** `z.record`/free object (rejected — unbounded, unsafe); `hops: z.number()` (rejected — mirror the `1|2` literal union); a separate endpoint (rejected — it's a recall OPTION, KISS).
**Consequences:** one schema field; OpenAPI auto-derives; the handler maps one key.

### D2 — One-line handler mapping; no other handler change
**Decision:** destructure `graphExpand` from `parsed.data` + add it to the `scoped.recall({...})` options object in `recall.ts`.
**Rationale:** mirrors the existing `topK`/`threshold` mapping exactly; the SDK + factory do the work.
**Alternatives:** transform/validate in the handler (rejected — zod already validates; the core honors the option).
**Consequences:** `recall.ts` gains one destructured key + one passed key.

### D3 — Additive + default-OFF; rerank/adaptive REST exposure deferred
**Decision:** expose ONLY `graphExpand` (the entity-graph knob); omitting it is byte-identical. rerank/diversify/adaptive REST exposure is a SEPARATE followup.
**Rationale:** scope discipline — the /goal is the entity-graph evolution; bundling the other opt-in families is scope creep (Rule 10 / YAGNI).
**Alternatives:** expose the whole opt-in family now (rejected — out of scope).
**Consequences:** focused diff; documented followup for the parallel knobs.

## Dependency Graph

```
T1.1 (zod field on RecallBody) ─> T1.2 (handler mapping + unit test) ─> T2.1 (GOAL integration + full gate)
```

Sequential; small surface.

## Phase 1 — REST surface

### T1.1 — `graphExpand` field on the strict `RecallBody`

#### Why this step
**Action:** add the bounded `graphExpand` optional field (ADR D1) to `RecallBody` in `schemas.ts`. Verify the OpenAPI auto-derives (recall request uses `schema: RecallBody`).
**Reasoning:** the request schema must accept `graphExpand` before the handler can read it (today `.strict()` 422s it). Mirrors the existing `topK`/`threshold` fields.

#### TDD
- RED: a schema unit test (or the handler test) — `RecallBody.safeParse({ user, query, graphExpand: { hops: 2, limit: 5 } })` succeeds; `{ ..., graphExpand: { hops: 3 } }` fails (out-of-range); `{ ..., graphExpand: { bogus: 1 } }` fails (strict inner).
- GREEN: add the field.
- REFACTOR: keep field-order + style consistent with siblings.

#### Files to edit
- `packages/api/src/server/schemas.ts`
- `packages/api/src/server/__tests__/handlers.test.ts` (or a schema test) — validation assertions

#### Deep file dependency analysis
`RecallBody` ends after the `asOf` field, before `.strict().superRefine(...)`. Insert `graphExpand` as a sibling optional field. The `.strict()` + `superRefine(SingleScopeRefine)` are unaffected (superRefine only enforces single-scope-tier). OpenAPI `RecallBody` reference auto-includes it.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `RecallBody` accepts `graphExpand: { hops?: 1|2; limit?: 1..100 }`; rejects `hops: 3` + unknown inner keys (strict).
- [ ] Field lands inside `RecallBody` (not another body); `.strict()`/`superRefine` intact.
- [ ] `tsc -p tsconfig.contract.json` clean (the authoritative type gate).

#### DoD
- [ ] schema validation tests green.

### T1.2 — handler mapping + OpenAPI auto-derive verification

#### Why this step
**Action:** in `recall.ts`, destructure `graphExpand` from `parsed.data` + add it to the `scoped.recall(query, { ... })` options object. Add a handler unit test asserting graphExpand flows to the recall call (spy/stub memory).
**Reasoning:** completes the REST→SDK plumbing. Mirrors `topK`/`threshold`.

#### TDD
- RED: `handlers.test.ts` — a `POST /v1/recall` with `graphExpand` reaches the (stub) `scoped.recall` with the `graphExpand` option; a request without it passes `graphExpand: undefined` (no change).
- GREEN: add the destructure + pass.
- REFACTOR: confirm OpenAPI JSON includes `graphExpand` under the recall request (`GET /v1/openapi.json` or the openapi test).

#### Files to edit
- `packages/api/src/server/handlers/recall.ts`
- `packages/api/src/server/__tests__/handlers.test.ts`

#### Deep file dependency analysis
`recall.ts:34` is the single mapping site. The stub-memory test pattern (`handlers.test.ts:162`) asserts the option object reaches `recall`. The OpenAPI test (`openapi.test.ts`) already iterates the verbs — confirm `graphExpand` present in the recall request schema.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- [ ] `POST /v1/recall` with `graphExpand` passes it into `scoped.recall`'s options.
- [ ] Request without `graphExpand` ⇒ option absent (byte-unchanged).
- [ ] OpenAPI `/v1/recall` request schema includes `graphExpand`.

#### DoD
- [ ] `npx vitest run --config vitest.contract.config.ts packages/api/src/server/__tests__/handlers.test.ts` green.

## Phase 2 — Integration Validation

### T2.1 — GOAL integration test + full gate

#### Why this step
**Action:** `tests/integration/rest-graph-aware-recall.test.ts` against real `ankane/pgvector:v0.5.1` via the HTTP server (`createServer({ memory: createLocalMemory({ PgvectorStore, ... }) })`): seed memory A (matches query) + memory B (below threshold) sharing an entity (stub EntityExtractor linking both); `POST /v1/recall` with `{ user, query, graphExpand: {} }` → B in `results`; same POST WITHOUT `graphExpand` → B absent; a `graphExpand: { hops: 3 }` → 422. Then the full validation gate.
**Reasoning:** THE GOAL — proves the option flows REST → handler → `scoped.recall` → Step 8.7 → JOIN end-to-end + default-unchanged + validation. Reuses the graph-aware-recall GOAL's entity-link seeding + the `rest-api.test.ts` server-construction pattern (with a REAL memory, not the stub).

#### TDD
- RED: the GOAL test (skipIf no `THEOMEM_PG_URI`).
- GREEN: (feature implemented P1; this asserts end-to-end over HTTP).
- REFACTOR: honest caveat comment on the entity-link seeding.

#### Files to edit
- `tests/integration/rest-graph-aware-recall.test.ts` (NEW)

#### Deep file dependency analysis
Composes `createServer({ memory })` over a real `createLocalMemory({ vectorStore: new PgvectorStore(pool, { embeddingDim }), embedder: crafted, llm: queue, entityExtractor: stub })`; drives via `app.fetch(new Request('http://localhost/v1/recall', { method:'POST', body }))`; asserts the parsed JSON `results`.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- **Invalid graphExpand (`hops: 3` / unknown inner key)** → 422 (zod `.strict()` + bounded `hops`), asserted in the GOAL. The server never 500s on a malformed graphExpand.
- **Graph traversal failure** — handled fail-soft inside the core Step 8.7 (shipped v0.19.0); the REST layer surfaces whatever recall returns (never 500 on a graph-store outage). Covered at the core level by the graph-aware-recall cycle.

#### Acceptance criteria
- [ ] REST recall with `graphExpand` ⇒ shared-entity below-threshold memory in `results`.
- [ ] REST recall without `graphExpand` ⇒ that memory absent (byte-unchanged).
- [ ] `graphExpand: { hops: 3 }` ⇒ 422 (not 500).
- [ ] Contract suite green; `/code-quality` PASS; `tsc`/build/lint clean.

#### DoD
- [ ] `npx vitest run --config vitest.integration.config.ts tests/integration/rest-graph-aware-recall.test.ts` green vs real pgvector.
- [ ] CHANGELOG `[Unreleased] § Added` notes the REST surface.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| `graphExpand` zod field on `RecallBody` (bounded hops/limit, strict) | T1.1 |
| handler maps graphExpand → `scoped.recall` | T1.2 |
| OpenAPI auto-derives the field | T1.2 |
| GOAL: REST recall w/ graphExpand surfaces shared-entity below-threshold memory vs real pgvector | T2.1 |
| default (no graphExpand) byte-unchanged | T1.2 + T2.1 |
| invalid graphExpand → 422 (not 500) | T1.1 + T2.1 |
| ZERO new dependency / NO core change / NO migration | Dependencies section + /deps-audit |

**Coverage: 7/7 goal claims mapped (100%).**

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Exposing graphExpand without the parallel rerank/adaptive knobs is asymmetric | LOW | Documented as a deliberate scope boundary (ADR D3); the /goal is the entity-graph; a followup tracks rerank/adaptive REST exposure. | impl |
| A consumer sends a huge `limit` to fan-out the graph traversal | MEDIUM | `limit` bound at 100 in the zod schema (DoS-guard parity with `topK`); the core JOIN is LIMIT-bounded + 1-hop default. | impl |
| The additive field could surprise an OpenAPI consumer pinning the old schema | LOW | Additive optional field is non-breaking by OpenAPI convention; Status is Pre-release (breaking changes acceptable anyway). | impl |

## Unresolved Questions

(none — every decision is resolved at plan time. The GOAL's entity-link seeding (stub EntityExtractor vs direct INSERT) is an implementation detail resolved in T2.1 — reuse the graph-aware-recall GOAL's stub-extractor approach.)

## Failure scenarios

The NEW code is a REST adapter field + mapping; it adds NO new external I/O (the recall path's pgvector + graph JOIN already exist + are fail-soft from v0.19.0). Failure modes:
- **Invalid `graphExpand`** (bad `hops`/unknown key) → zod rejects → 422 (not 500); asserted in T2.1.
- **Graph-store outage during the recall** → core Step 8.7 fail-soft (degrades to non-graph pool, emits `recall_graph_failed`); the REST layer returns the (non-graph) results 200; no new failure path introduced here.

## Global Definition of Done

- [ ] T1.1 → T2.1 complete with green TDD.
- [ ] `tsc -p tsconfig.contract.json` + `npm run build` clean.
- [ ] Contract suite green; GOAL integration green vs real `ankane/pgvector:v0.5.1`.
- [ ] `/code-quality rest-graph-aware-recall` PASS (0 hard/soft caps).
- [ ] Default (no graphExpand) byte-unchanged (T1.2 + T2.1).
- [ ] ZERO new dependency (deps-audit PASS); NO core change; NO migration.
- [ ] No paper names in `src/**`.
- [ ] CHANGELOG `[Unreleased] § Added` updated.
- [ ] `/review` READY_TO_MERGE.
- [ ] Plan archived after merge.
