# Discovery Plan: Graph-aware recall temporal correctness (M0)

> **Version 1.0** — Investigate how temporal memory/knowledge-graph systems keep INVALIDATED facts out of graph traversal and how point-in-time (`asOf`) queries propagate through multi-hop expansion, so we can fix TheMemory's `PgGraphExpansionStore` (which omits the `t_invalid` predicate and never receives `asOf`) by reusing our already-shipped bi-temporal predicate. In scope: our own codebase (primary source of the reuse pattern), the `letta` peer (soft-delete-in-query precedent), and a targeted web study of Graphiti/Zep temporal traversal (not cloned). Output: a blueprint that locks the fix shape before any code.

**Slug:** `graph-aware-recall-temporal-correctness`
**Owner:** usetheodev (roadmap M0)
**Created:** 2026-07-10
**Time budget:** 3h (internal prior art 1.5h · letta peer 0.5h · Graphiti/Zep web 1h — per-project breakdown in ADR D1)

## Context

Milestone **M0** (`ROADMAP.md`, = `CLAUDE.md` Item 27) is a likely CORRECTNESS BUG: the graph-aware recall expansion query at `packages/core/src/infrastructure/db/pg-graph-expansion-store.ts:81-92` JOINs `memories` and filters by workspace/user/session/agent but **omits `m.t_invalid IS NULL`** — the predicate every other recall path applies. Graph expansion can therefore resurface superseded / evicted memories. It also never receives `RecallOptions.asOf`, so it cannot answer point-in-time queries the main path already answers.

We already ship the exact predicate to reuse: `packages/core/src/infrastructure/db/pgvector-store.ts:157-164` (ADR-0011 bi-temporal: `(t_valid IS NULL OR t_valid <= $N) AND (t_invalid IS NULL OR t_invalid > $N+1)` when `asOf` is set; else `t_invalid IS NULL`), and the `asOf` routing at `packages/core/src/infrastructure/db/scoped-memory.ts:66`. Prior discovery/plan art exists at `.claude/knowledge-base/discoveries/plans/graph-aware-recall-plan.md` and `.claude/knowledge-base/discoveries/plans/rest-graph-aware-recall-plan.md`.

Project rules that any borrowed pattern MUST respect: `.claude/rules/architecture.md` (§2 DIP — the temporal predicate lives behind the `GraphExpansionStore` store, not leaked to callers), `.claude/rules/testing.md` (§4.1 — a negative/edge test proving a superseded memory is NOT resurfaced), `.claude/rules/parsimony-ladder.md` (rung 4 — reuse the existing `pg` driver + existing predicate; no new dependency).

## Objective

Produce a blueprint that locks HOW to add the temporal filter (`t_invalid` + `asOf`) to the 1-2 hop graph expansion, reusing the shipped predicate, applied DURING the JOIN (not post-filter), consistent across core/REST/MCP.

- [ ] All research questions answered with real citations (internal `packages/**`, peer `.claude/knowledge-base/references/letta/**`, and web for Graphiti/Zep)
- [ ] Cross-cutting comparison of "apply-during-traversal vs post-filter" and "validity-on-edge vs derived-from-source" populated
- [ ] At least one concrete decision proposal per research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| (internal) `packages/core/src/infrastructure/db/` | `pg-graph-expansion-store.ts`, `pgvector-store.ts`, `scoped-memory.ts`, `*graph*.test.ts` | The bug site + the predicate to reuse + the asOf routing + existing tests |
| (internal) `.claude/knowledge-base/discoveries/plans/` | `graph-aware-recall-plan.md`, `rest-graph-aware-recall-plan.md` | Prior art: how graph-aware recall + its REST surface were designed |
| `.claude/knowledge-base/references/letta/` | `letta/orm/base.py` | Peer precedent: soft-delete (`is_deleted`) as a first-class row-validity column filtered in reads |
| (web) Graphiti / Zep | temporal traversal + fact-invalidation docs | Not cloned; targeted WebFetch in execute for the "during-traversal vs post-filter" + asOf-propagation technique |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/**` | mem0's TS/py graph memory is not the temporal-traversal shape we need; thin on validity-window traversal |
| Edge-own bi-temporality (`entity_edges.t_valid/t_invalid`) | That is milestone **M1**, out of scope for M0 (validity derived from source memory via FK here) |
| Graph-DB backend (AGE/Neo4j) | Item 14 declined; M0 is pure Postgres JOIN |
| `.claude/knowledge-base/references/*/{build,dist,.venv,node_modules}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** internal prior art 1.5h · letta peer 0.5h · Graphiti/Zep web 1h (total 3h).

**Rationale:** the fix is fundamentally internal (reuse our own predicate), so the deepest dive is our own code; letta gives a peer precedent that row-validity is filtered in-query; Graphiti/Zep (web) validate the "apply-during-traversal + asOf-propagation" technique but are not cloned.

**Alternatives considered:** clone Graphiti (heavy; deferred — WebFetch is enough for the technique); skip discover entirely (rejected — the multi-hop asOf-propagation shape genuinely warrants confirmation).

**Stop condition — per question:** if Fase A returns empty after 3 query-variant retries, mark BLOCKED with reason and continue. Never pad from another question's scope.

**Stop condition — per project:** on budget exhaustion, mark remaining questions BLOCKED with reason "budget exhausted". If every remaining question is `done` or honestly `blocked`, emit `BLUEPRINT_BLOCKED` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate a Fase B answer (Unbreakable Rule 3).

**Consequences:** honest blocked-questions surface as next-discovery seed.

### D2 — External-reference thinness (honest scoping)

**Decision:** treat our own `packages/**` + prior blueprints as the PRIMARY source; `letta` as the single cloned peer precedent; Graphiti/Zep as WEB-only supplementary (not a `references/` citation).

**Rationale:** the cloned references (`mem0`, `letta`) are thin on temporal graph traversal specifically; forcing fabricated reference citations would fail the `discover-confidence` fabricated-citation hard cap AND violate Rule 3. M0 is largely answerable from our own code (`discover` anti-pattern acknowledged), but the multi-hop `asOf`-propagation technique warrants the web study — so discover is justified, not theater.

**Consequences:** the blueprint cites real internal paths + one real letta path + web URLs. Zero `references/` fabrication risk.

### D3 — Investigation depth

**Decision:** Read the bug site + predicate + asOf routing end-to-end; Grep the test tree for existing graph-expansion coverage; WebFetch 1-2 authoritative Graphiti/Zep pages for the traversal-temporal technique.

**Rationale:** line-exact citations are required for the fix; the technique needs prose, not just symbols.

**Consequences:** blueprint carries line-exact internal citations + web URLs.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep Read/Fetch) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does a peer memory system mark row validity and FILTER it in reads (precedent for filtering `t_invalid` in-query)? | techniques | `.claude/knowledge-base/references/letta/letta/orm/base.py` | Grep `is_deleted` across `references/letta/letta/orm/` to list where the flag is defined + where reads filter it | Read `base.py:18` + the accessor/query mixin that applies the filter | Prose: validity-column-on-row + filter-in-read pattern, with `references/letta/...:line` citations |
| Q2 | What is our canonical bi-temporal predicate and is it applied DURING the query (not post-filter)? | techniques | `packages/core/src/infrastructure/db/pgvector-store.ts` | Grep `t_invalid`/`asOf` in `pgvector-store.ts` | Read `pgvector-store.ts:157-164` end-to-end (the `asOf`-set vs `asOf`-omitted branches) | The exact SQL predicate to reuse + citation |
| Q3 | How does `asOf` route RecallOptions→Filters→SQL today, and precisely where does graph expansion diverge? | techniques | `packages/core/src/infrastructure/db/scoped-memory.ts`, `pg-graph-expansion-store.ts` | Grep `asOf` in `scoped-memory.ts`; Read the expansion `WHERE` at `pg-graph-expansion-store.ts:81-92` | Read the routing at `scoped-memory.ts:66` + the missing predicate/param in the expansion SELECT + seed CTE (line 78) | Diff-shaped answer: what to add (predicate + `asOf` param) and where, incl. seed CTE + hop-2 CTE |
| Q4 | How does the existing graph-aware-recall suite test the expansion boundary, and what temporal test is missing? | tests | `packages/core/src/infrastructure/db/in-memory-graph-expansion-store.test.ts` + integration | Grep `graphExpand`/`GraphExpansion` across `packages/**/*.test.ts` | Read the existing expansion tests + a real-pgvector integration test to see the fixture shape | Table: existing tests → the RED regression to add (superseded memory not resurfaced) |
| Q5 | Does threading `t_invalid` + `asOf` need any NEW dependency, or is it pure SQL over the existing `pg` driver? | deps | `packages/core/package.json` | Grep `"pg"`/`"drizzle"` in `packages/core/package.json` | Read the dep block | Confirmation: no new dep (parsimony rung 4 — reuse `pg`), version cited |
| Q6 | What is the local-dev/test harness to run the expansion against REAL pgvector? | tools | repo root + `packages/core` | Glob `docker-compose*.y*ml`, `vitest*.config.*`, test scripts in `package.json` | Read the compose service (`ankane/pgvector`) + the integration test command | Step-by-step: container tag + test command citations |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Each declared path exists (`packages/**` or `references/letta/**`) | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A | ≥1 hotspot OR 3 retries | After 3 retries, BLOCKED "Fase A exhausted" |
| After answering Qx | Qx blueprint section has ≥1 citation | Re-iterate Qx (1 retry) |
| Web source (Graphiti) | URL fetched from an allowlisted domain (`discover-web-allowlist.txt`) | If domain not allowlisted, mark the web sub-point BLOCKED; internal answer still stands |
| Before promising complete | All 4 corners populated | Refuse promise, continue |

## Acceptance Criteria

- [ ] All 6 research questions answered OR explicitly BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every `references/` citation points to a real path (letta); every internal citation points to a real `packages/**` line; web URLs from allowlisted domains
- [ ] At least one ADR in the blueprint synthesizes the fix decision (apply-during-JOIN; reuse `pgvector-store.ts:157` predicate; derive edge-validity from source memory)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/graph-aware-recall-temporal-correctness-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100%
- [ ] ADRs reference at least one project rule (`architecture.md` §2 DIP, `testing.md` §4.1, `parsimony-ladder.md` rung 4)
