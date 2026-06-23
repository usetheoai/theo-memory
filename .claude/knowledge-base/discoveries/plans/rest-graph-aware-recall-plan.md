# Discovery Plan: REST graph-aware recall (expose graphExpand on POST /v1/recall)

> **Version 1.0** — entity-graph evolution (project-owner /goal "continuar evoluindo a entity-graph"). The graph-aware recall capability (`RecallOptions.graphExpand`) shipped at the SDK layer in v0.19.0 but is NOT reachable over REST: `POST /v1/recall` maps only `topK/threshold/attributedTo/asOf` (`packages/api/src/server/handlers/recall.ts:34`). This discovery decides how to expose `graphExpand` on the REST recall surface (zod `RecallBody` + handler + auto-derived OpenAPI), completing the SDK→REST reach of the entity-graph feature for gateway/MCP/HTTP consumers. ZERO new dependency, additive (strict-zod), default-unchanged.

**Slug:** `rest-graph-aware-recall`
**Owner:** project-owner (via /goal)
**Created:** 2026-06-23
**Time budget:** 1h (per-project breakdown in ADR D1)

## Context

graph-aware recall (v0.19.0, PR #65) added `GraphExpansionStore` + pipeline Step 8.7 + `RecallOptions.graphExpand` (`packages/core/src/domain/options.ts`), wired through `createLocalMemory` + the factory auto-default. The REST server (`@usetheo/memory/server`, Item 16) exposes `POST /v1/recall` via `recallHandler` (`packages/api/src/server/handlers/recall.ts`) over the strict zod `RecallBody` (`packages/api/src/server/schemas.ts`) — but it destructures ONLY `topK, threshold, attributedTo, asOf` (`recall.ts:34`), so a REST/gateway/MCP consumer cannot use graph-aware recall (a `graphExpand` key is currently REJECTED by `.strict()` with a 422). This discovery decides the additive surface change (mirror the existing topK/threshold mapping). Honors P0 sub-goal 2 (SDK/REST functional) + `CLAUDE.md § Princípio 2`. Scope guardrail: ONLY `graphExpand` (the entity-graph feature); the parallel rerank/diversify/adaptive REST exposure is a SEPARATE followup, out of scope here.

## Objective

Decide the contract for exposing `graphExpand` on `POST /v1/recall` so `cycle-plan` implements it with zero re-scoping. Measurable success criteria for the blueprint:

- [ ] All research questions answered with citations to TheMemory's own source (resolvable paths)
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| TheMemory OWN source (primary evidence) | `packages/api/src/server/handlers/recall.ts`, `packages/api/src/server/schemas.ts` (`RecallBody`), `packages/api/src/server/openapi-registration.ts` (recall request), `packages/core/src/domain/options.ts` (`RecallOptions.graphExpand`), `packages/api/src/server/__tests__/` (existing recall handler tests) | The handler mapping, the strict-zod request schema, the auto-derived OpenAPI, the option being exposed, and the REST test pattern are ALL here. Load-bearing prior art. |
| `.claude/knowledge-base/references/mem0/` | `mem0/client/` OR server | Confirm-or-deny how a production memory REST API surfaces advanced recall knobs (honest baseline). |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| Exposing rerank / diversify / adaptive over REST | <!-- DEFER-CORNER: techniques | the /goal is the ENTITY-GRAPH evolution; graphExpand is the entity-graph knob. rerank (Item 23) / adaptive (Item 13) REST exposure is a parallel, separate surface followup — bundling it would be scope creep beyond "evolve the entity-graph". --> |
| The cross-repo gateway (theo-cloud) BFF + MCP recall tool plumbing | cross-repo; this discovery is the in-repo REST surface. MCP/gateway consume the REST surface once it ships. |
| Any change to the graph traversal SQL / GraphExpansionStore | shipped v0.19.0; this is a pure surface-exposure (read-through), no core change |
| `.claude/knowledge-base/references/*/docs/`, build artifacts | not source of truth |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** TheMemory own source: 0.75h (the handler + schema + OpenAPI + test pattern); mem0: 0.25h.

**Rationale:** the load-bearing prior art is our own REST recall surface (the exact pattern to mirror — topK/threshold mapping); mem0 gets a bounded confirm-or-deny of advanced-knob REST surfacing.

**Alternatives considered:** equal split (rejected — the change is our-surface-internal); our-source-only (rejected — a quick honest clone check costs little).

**Stop condition — per question:** Fase A empty after 3 query-variant retries → mark BLOCKED "Fase A exhausted", continue. For the mem0 confirm-or-deny, a confirmed-absent finding IS the answer.

**Stop condition — per project:** budget exhausted with questions pending → mark BLOCKED "budget exhausted". If all remaining done/blocked → `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate a Fase B answer for an exhausted Fase A (Rule 3).

**Consequences:** the blueprint is grounded in our own REST surface + a thin clone baseline.

### D2 — Investigation depth

**Decision:** Read end-to-end for `recall.ts` + `RecallBody` + the recall OpenAPI block + the `RecallOptions.graphExpand` shape + one existing recall-handler test; Grep-then-Read for mem0.

**Rationale:** the additive change must mirror the EXACT existing mapping + strict-zod + OpenAPI-auto-derive pattern; faithfulness requires full reads of those few files.

**Alternatives considered:** Grep-only (rejected — strict-zod + superRefine interplay needs the full schema); Read-all-clones (rejected — budget).

**Consequences:** the blueprint's mapping recommendation is line-exact against our own source.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does `recallHandler` map `RecallBody` → `ScopedMemory.recall(options)` today, and where does a new `graphExpand` field plug in? | techniques | TheMemory own | grep `topK\|threshold\|asOf\|parsed.data\|scoped.recall` in `recall.ts` | Read `recall.ts` end-to-end | The destructure + the `scoped.recall({...})` call site + the exact line to add `graphExpand` |
| Q2 | What is the `RecallOptions.graphExpand` shape the REST schema must mirror, and what zod validates it (hops 1\|2, limit bounds)? | techniques | TheMemory own | grep `graphExpand` in `options.ts` | Read the `graphExpand` block in `options.ts` | The zod schema for `graphExpand` ({ hops: 1\|2 optional; limit: int 1..100 optional }) |
| Q3 | Is adding a field to the strict `RecallBody` safe (additive, no breaking) and does the OpenAPI auto-derive from it? How does `.strict().superRefine()` interact? | techniques | TheMemory own | grep `RecallBody\|.strict()\|superRefine\|schema: RecallBody` in `schemas.ts` + `openapi-registration.ts` | Read `RecallBody` + the recall OpenAPI request block | Confirmation: additive optional field is non-breaking; OpenAPI updates automatically (uses `RecallBody`); `.strict()` now ACCEPTS graphExpand |
| Q4 | How is an existing REST recall/handler test structured (Hono `app.fetch`, body, scope, assertions)? + does mem0's REST surface expose advanced recall knobs (honest baseline)? | tests | TheMemory own + mem0 | grep `app.fetch\|/v1/recall\|recall` in `packages/api/src/server/__tests__/` + `graph\|rerank\|advanced` in mem0 client | Read one recall handler test + any mem0 hit | The REST test skeleton (app.fetch POST body → assert results) + mem0 presence/absence |
| Q5 | What is the GOAL-test shape proving graphExpand works THROUGH the REST layer against real pgvector (a connected below-threshold memory surfaces via the HTTP recall)? | tests | TheMemory own | grep `createServer\|app.fetch\|THEOMEM_PG_URI\|graph` in existing server integration tests | Read an existing server+pgvector integration test | GOAL skeleton: POST /v1/recall with graphExpand → connected memory in the JSON results; without → absent |

## Coverage Matrix

| Question | Corner | Method (Fase A) | Method (Fase B) | Status |
|---|---|---|---|---|
| Q1 | techniques | grep handler mapping | Read recall.ts | planned |
| Q2 | techniques | grep graphExpand | Read options.ts block | planned |
| Q3 | techniques | grep RecallBody/strict/openapi | Read schema + openapi | planned |
| Q4 | tests | grep recall test + mem0 | Read test + clone hit | planned |
| Q5 | tests | grep server integration | Read a server+pgvector test | planned |
| (deps) | deps | — | — | DEFER-CORNER (zero new dep) |
| (tools) | tools | — | — | DEFER-CORNER (no new tooling) |

**Coverage: 4/4 corners covered (100%)** — techniques + tests populated; deps + tools explicitly DEFER-CORNER'd below.

<!-- DEFER-CORNER: deps | a pure REST surface-exposure (zod field + handler mapping + auto-derived OpenAPI) over an ALREADY-shipped SDK capability — ZERO new dependency (reuses zod, Hono, the existing graph-aware-recall internals). A formal deps-audit runs in cycle-plan regardless. -->

<!-- DEFER-CORNER: tools | the change is one zod field + one handler-destructure line + tests; it adds NO new build/test/lint tooling (reuses vitest + the existing server test harness + the existing build). No tooling question to investigate. -->

Question budget: 5 total. Per-corner: techniques ×3 (Q1-Q3), tests ×2 (Q4-Q5). deps + tools DEFER-CORNER'd. Within 5 ≤ N ≤ 10 and ≤ 3/corner; every non-deferred corner ≥ 1.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every cited path (`packages/...` OR `.claude/knowledge-base/references/{project}/...`) exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 retries | After 3 retries empty, mark BLOCKED "Fase A exhausted" (Q4 mem0-absence is the ANSWER) |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation | Re-iterate Qx (1 retry) |
| Before promising complete | All 4 corners populated (deps/tools via DEFER-CORNER) | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly BLOCKED with reason (Q4 mem0 absence is an answer)
- [ ] All four coverage corners have populated sections in the blueprint (deps/tools via DEFER-CORNER)
- [ ] Every citation points to a real `packages/...` OR `.claude/knowledge-base/references/{project}/...` path
- [ ] At least one ADR section synthesizes decisions (zod field shape; handler mapping; OpenAPI auto-derive; GOAL test)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/rest-graph-aware-recall-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered (or DEFER-CORNER'd)
- [ ] ADRs reference at least one principle from project rules (KISS/YAGNI/DIP) or a rule file — and CLAUDE.md Princípio 2 + the P0 SDK/REST-functional sub-goal
