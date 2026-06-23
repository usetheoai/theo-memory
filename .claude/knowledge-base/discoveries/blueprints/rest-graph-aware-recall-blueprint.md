# Blueprint: REST graph-aware recall (expose graphExpand on POST /v1/recall)

**Slug:** `rest-graph-aware-recall`
**Discovery plan:** `.claude/knowledge-base/discoveries/plans/rest-graph-aware-recall-plan.md`
**Date:** 2026-06-23
**/discover-confidence verdict:** SHIPPABLE (0 hard caps)

## Context

graph-aware recall (`RecallOptions.graphExpand`) shipped at the SDK layer (v0.19.0) but is NOT reachable over REST: `recallHandler` destructures only `topK/threshold/attributedTo/asOf` from the strict zod `RecallBody` (`packages/api/src/server/handlers/recall.ts:34`), so a `graphExpand` key is currently REJECTED by `.strict()` (422). This blueprint decides the additive surface change — a zod field + a handler-mapping line + the auto-derived OpenAPI — so gateway/MCP/HTTP consumers reach the entity-graph-augmented retrieval. Scope: ONLY `graphExpand` (the entity-graph knob); rerank/adaptive REST exposure is a separate followup.

## Objective

Decide the zod schema for `graphExpand`, the handler mapping, the OpenAPI auto-derive, and the GOAL test for exposing graph-aware recall over REST, so `cycle-plan` implements it with zero re-scoping.

## Executive summary

Add `graphExpand` to the strict zod `RecallBody` (`packages/api/src/server/schemas.ts`) as `z.object({ hops: z.union([z.literal(1), z.literal(2)]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().optional()` — byte-mirroring `RecallOptions.graphExpand` (`packages/core/src/domain/options.ts`). Destructure it in `recallHandler` (`recall.ts:34`) and pass it into `scoped.recall({ ..., graphExpand })` (one line, mirroring `topK`/`threshold`). The OpenAPI spec auto-derives (the recall request uses `schema: RecallBody`, `openapi-registration.ts`), so no separate schema edit. Additive + non-breaking: an optional field on a strict schema only WIDENS what is accepted (a `graphExpand` body that was 422'd is now honored); omitting it is byte-identical to today. ZERO new dependency, NO core change (the GraphExpansionStore + factory auto-default shipped v0.19.0; this is pure read-through). The clones confirm the pattern: mem0's client `search` passes advanced knobs through an `options`/`filters` object (`mem0/client/main.py:280`) — surfacing recall knobs over the API is standard.

## Coverage Corner 1 — Integration Tests

**Q4 — REST recall test pattern + mem0 baseline.** The handler unit-test pattern (`packages/api/src/server/__tests__/handlers.test.ts:162` `POST /v1/recall`) uses `app.fetch(new Request('http://localhost/v1/recall', { method:'POST', body: JSON.stringify({ user:'…', query:'…' }) }))` + asserts the JSON `{ results }`. The server+pgvector integration harness lives at `tests/integration/rest-api.test.ts` (real recall over HTTP against a real DB). mem0 baseline (`mem0/client/main.py:280` `search(query, options, **kwargs)`): advanced recall knobs ride an `options`/`filters` object over the client API — surfacing recall options over REST is the norm, confirming the design.

**Q5 — GOAL-test shape.** Against real `ankane/pgvector:v0.5.1` via the HTTP server: seed two memories sharing an entity (A near the query, B below threshold) through the SDK/server, then `POST /v1/recall` with `{ user, query, graphExpand: {} }` → B appears in the JSON `results`; the same POST WITHOUT `graphExpand` → B absent. Proves the option flows REST → handler → `scoped.recall` → Step 8.7 → JOIN end-to-end. Reuses the `tests/integration/rest-api.test.ts` server-construction harness + the graph-aware-recall GOAL's entity-link seeding (stub EntityExtractor linking A+B).

## Coverage Corner 2 — Dependencies

**DEFER-CORNER (deps) — ZERO new dependency (confirmed).** The change is a zod field (reuses `zod`, already a dep) + a handler-destructure line (reuses Hono, already a dep) + the auto-derived OpenAPI (reuses `@asteasolutions/zod-to-openapi` via the existing `RecallBody` registration). NO new runtime/dev dep. The graph traversal internals (GraphExpansionStore + factory) shipped v0.19.0. `/deps-audit` confirms in cycle-plan.

## Coverage Corner 3 — Tools

**DEFER-CORNER (tools) — no new build/test/lint tooling (confirmed).** A zod field + one handler line + tests; reuses vitest + the existing `packages/api/src/server/__tests__/` harness + `tests/integration/rest-api.test.ts` + the existing build. No new CLI/container/linter. No migration.

## Coverage Corner 4 — Techniques

**Q1 — handler mapping.** `recall.ts:34` destructures `const { query, topK, threshold, attributedTo, asOf } = parsed.data;` then calls `scoped.recall(query, { topK, threshold, attributedTo, asOf: asOf ? new Date(asOf) : undefined })`. The change: add `graphExpand` to the destructure + pass `graphExpand` into the `scoped.recall({...})` options object (one added key, mirroring `topK`). No other handler logic changes.

**Q2 — the option shape to mirror.** `RecallOptions.graphExpand` (`options.ts`) = `{ readonly hops?: 1 | 2; readonly limit?: number }` (optional). The zod must validate `hops` ∈ {1,2} + `limit` a positive int. Proposal: `z.object({ hops: z.union([z.literal(1), z.literal(2)]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().optional()`. The `.strict()` on the inner object rejects unknown nested keys; `limit` bound at 100 mirrors `topK`'s bound (DoS guard parity).

**Q3 — strict-zod additive safety + OpenAPI auto-derive.** `RecallBody` is `z.object({...}).strict().superRefine(SingleScopeRefine)` (`schemas.ts`). Adding an OPTIONAL field: (a) is non-breaking — existing bodies still validate; (b) WIDENS acceptance — a `graphExpand` key (previously rejected by `.strict()` → 422) is now honored; (c) does NOT interact with `superRefine` (that only enforces single-scope-tier). The OpenAPI recall request is `{ body: { content: { 'application/json': { schema: RecallBody } } } }` (`openapi-registration.ts:90+`) — it references `RecallBody` directly, so the new field appears in the generated spec automatically (no separate OpenAPI edit). Confirmed: pure additive surface widening.

## Cross-cutting comparison

| Dimension | mem0 (client) | TheMemory (proposed) |
|---|---|---|
| Advanced recall knobs over the API | `search(query, options/filters)` object (`client/main.py:280`) | `graphExpand` field on the strict `RecallBody` |
| Schema validation | runtime kwargs filtering | zod `.strict()` + bounded `hops`/`limit` |
| OpenAPI | (separate) | auto-derived from `RecallBody` |
| New dependency | — | ZERO |

## ADRs

### D1 — Mirror `RecallOptions.graphExpand` as a bounded zod field on `RecallBody`
**Decision:** `graphExpand: z.object({ hops: z.union([z.literal(1), z.literal(2)]).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().optional()`.
**Rationale:** byte-mirrors the SDK option; `.strict()` + bounded `hops`/`limit` (limit ≤ 100 like `topK`) gives input-validation parity + a DoS guard; optional keeps it default-OFF.
**Alternatives:** free `z.record` (rejected — unbounded, unsafe); `hops: z.number()` (rejected — the SDK type is the `1|2` literal union; mirror it).
**Consequences:** one schema field; OpenAPI auto-derives.

### D2 — One-line handler mapping; no other handler change
**Decision:** destructure `graphExpand` + add it to the `scoped.recall({...})` options object in `recall.ts`.
**Rationale:** mirrors the existing `topK`/`threshold` mapping exactly; the SDK + factory already do the work.
**Alternatives:** a separate graph-recall endpoint (rejected — graphExpand is a recall OPTION, not a new verb; KISS).
**Consequences:** `recall.ts` gains one destructured key + one passed key.

### D3 — Additive + default-OFF; rerank/adaptive REST exposure deferred
**Decision:** expose ONLY `graphExpand` (the entity-graph knob); omitting it is byte-identical to today. rerank/diversify/adaptive REST exposure is a SEPARATE followup.
**Rationale:** scope discipline — the /goal is the entity-graph evolution; bundling the other opt-in families is scope creep (Inquebrável Rule 10 / YAGNI).
**Alternatives:** expose the whole opt-in family now (rejected — out of scope; each is its own feature).
**Consequences:** a focused diff; a documented followup for the parallel knobs.

## Recommendations (one per research question)

- **Q1 →** add `graphExpand` to the `recall.ts` destructure + the `scoped.recall({...})` call.
- **Q2 →** the bounded zod object per ADR D1.
- **Q3 →** additive optional field on the strict `RecallBody`; OpenAPI auto-derives; non-breaking + widening.
- **Q4 →** unit test via `app.fetch` (handlers.test.ts pattern); mem0 confirms the surface-knob norm.
- **Q5 →** GOAL: `POST /v1/recall` with `graphExpand` surfaces a shared-entity below-threshold memory vs real pgvector; without → absent.

## Blocked questions

None — all 5 answered (Q4 mem0 baseline = confirmed-present surface-knob pattern). deps + tools DEFER-CORNER'd with rationale.
