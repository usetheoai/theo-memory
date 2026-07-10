# TheMemory — Temporal Context Graph Completeness Roadmap

> Created 2026-07-10 (resolving the `/roadmap-feature` impediment: no `ROADMAP.md` existed).
> This is a **macro** roadmap for the go-forward *temporal context graph* track. It is the
> formal, machine-parseable milestone tracker (`cycle-roadmap` / `/roadmap-feature`).
> The project's full historical record (Items 1–26, shipped) stays in `CLAUDE.md § Roadmap`.
> These three milestones **are** CLAUDE.md Items 27/28/29 — same three deltas, two views.
> Decomposition into tasks is `/to-plan`'s job per milestone (`/auto-plan M<N>`).

## Vision

TheMemory already ships a **temporal context graph** in Postgres-relational form — entities +
`entity_edges` (triples with provenance) + first-class episodes (v0.22) + ontology/custom-types
(v0.16) + graph-aware 1–2 hop recall (v0.19) + bi-temporal `asOf` (v1.1). That is **8 of the 11**
REDACTED/REDACTED "context graph" components already present. This roadmap closes the remaining three
deltas **without a graph database** (Item 14 stays declined) and without chasing feature-parity
with a competitor whose architecture bets on the graph being the substrate — ours is the deduped
bi-temporal memory, with the graph as augmentation.

## Problem

**Root problem:** the shipped graph has three honest gaps — one is a likely correctness bug
(graph traversal ignores temporal validity), the other two are parity niceties of varying value.

**Whose pain:** agents/consumers using `recall({ graphExpand })` can be handed **superseded /
forgotten** memories through the graph path (the only recall path that does not filter `t_invalid`).

## Users

- **Primary:** agent developers using `@usetheo/memory` graph-aware recall (SDK), REST `POST /v1/recall`, and the MCP `recall` tool.
- **Secondary:** dashboard users browsing the Entities / graph views.

## Scope

### In scope (this track)

- Make the graph traversal temporally correct (honor `t_invalid` + `asOf`) — the load-bearing fix.
- Optional edge-own validity windows — only if a concrete need appears (YAGNI-gated).
- On-demand evolving entity summaries — dashboard enrichment.
- Every delta crosses **core (SDK) + REST + MCP + Dashboard** where applicable, behind a DIP.

### Explicitly out of scope

- **Graph-DB backend (Apache AGE / Neo4j)** — *why excluded:* Item 14, declined 2026-06-22. 1–2 hop needs only Postgres JOINs; poly-store complexity is unjustified.
- **Wrapping REDACTED / REDACTED as a backend or data-adapter** — *why excluded:* direct competitors; the "Adapters (REDACTED/REDACTED/REDACTED) cut 2026-05-21" decision stands (be the native backend, not a wrapper).
- **Maintained-on-write entity summaries (eager LLM per update)** — *why excluded:* recurring LLM cost for marginal value; M2 is on-demand only.

> To reconsider any of these, write a new roadmap revision — do not silently expand scope.

## Constraints

- TS/Node + Postgres + `pgvector`; Apache-2.0; every capability behind a DIP (ADR-0008 method-count caps).
- No paper/marketing names in `src/**` (`rules/no-paper-names-in-code.md`).
- **Sequencing:** this track sits **behind the in-flight `agentic-skill-execution-sandbox` (CLAUDE.md Item 21)** — it must not jump that queue.
- TDD: every milestone starts with a failing test; M0 is a regression-test-first bug fix.

---

## M0 — [x] Graph-aware recall temporal correctness

> = CLAUDE.md Item 27. Priority **HIGH**, effort **S**. Do this first.

**Objective:** graph-aware recall must never resurface superseded/evicted memories and must honor `asOf`, reusing the shipped bi-temporal predicate (ADR-0011).

**Definition of done:**

- [ ] `PgGraphExpansionStore` final SELECT (`packages/core/src/infrastructure/db/pg-graph-expansion-store.ts:81-92`) filters `m.t_invalid IS NULL` — proven by a RED regression test where a superseded memory is NOT returned through graph expansion, then GREEN.
- [ ] `RecallOptions.asOf` is threaded into the expansion query so the traversal returns the bi-temporal state valid at `asOf` (additive optional field on the `GraphExpansionStore` DIP).
- [ ] Surface parity — core `recall({ graphExpand, asOf })`, REST `POST /v1/recall`, MCP `recall` tool each covered by an integration test asserting the temporal filter.
- [ ] Existing graph-aware-recall suite stays green; `CHANGELOG.md [Unreleased]` updated.

**Dependencies:** graph-aware-recall (v0.19, shipped) + bi-temporal `asOf` (v1.1, shipped). Sequenced after Item 21 (sandbox).

**Top risks (new):**

1. Hidden callers relying on stale-inclusion behavior — mitigate: grep callers + integration coverage before merge.
2. `asOf` threading touches the DIP signature (pre-release breaking) — mitigate: additive **optional** field, default preserves current behavior.

**Why now:** it is almost certainly a correctness bug — the graph path is the ONLY recall path that ignores `t_invalid`, so it can silently resurrect forgotten facts. Cheap (S) and it restores trust in graph recall; it also delivers ~80% of M1's value via the source-memory FK.

---

## M1 — [x] Edge-level validity windows + fact invalidation

> = CLAUDE.md Item 28. Priority **MEDIUM**, effort **L**, **~80% redundant with M0**. YAGNI-gated — stays `[ ]` by design until a real need appears.

**Objective:** give `entity_edges` their own temporal validity + automatic fact invalidation, for contradictions that are independent of a single source memory.

**Definition of done:**

- [ ] **Decision gate FIRST** — a concrete edge-granular historical query is demonstrated to be needed. If not, this milestone remains `[ ]` (documented as intentionally parked, not incomplete).
- [ ] Migration adds `entity_edges.t_valid` / `t_invalid`.
- [ ] Invalidation policy behind a DIP; reuse distillation `ConflictResolutionPolicy` rather than fork a second contradiction engine.
- [ ] Surfaces: core, REST `/v1/entities` + graph, MCP, Dashboard graph view distinguishes active vs superseded edges.
- [ ] `CHANGELOG.md [Unreleased]` updated.

**Dependencies:** M0 (delivers ~80% of this via the `source_memory_id` FK).

**Top risks (new):**

1. Building it speculatively is wasted effort (~80% redundant with M0) — mitigate: the DoD's decision gate blocks work until need is proven.
2. Auto edge-invalidation duplicates distillation's `ConflictResolutionPolicy` — mitigate: reuse that policy, do not fork (DRY).

**Why now:** NOT now — parked. Listed for completeness/traceability so the delta is not lost.

---

## M2 — [ ] Evolving entity summaries (on-demand)

> = CLAUDE.md Item 29. Priority **LOW**, nice-to-have. On-demand only — never eager LLM per write.

**Objective:** entities expose a `summary` reflecting accrued facts, computed on-demand at view time.

**Definition of done:**

- [ ] Entities expose a `summary` via REST `GET /v1/scopes/:type/:id/entities`.
- [ ] Summary is computed **on-demand** at view time (no per-write LLM cost) — locked by an ADR; optional cache invalidated on write.
- [ ] Surfaces: core, REST, MCP, Dashboard Entities tab renders it.
- [ ] `CHANGELOG.md [Unreleased]` updated.

**Dependencies:** entity+relation extraction (v0.11, shipped) + ontology (v0.16, shipped).

**Top risks (new):**

1. On-demand latency/cost if recomputed per view — mitigate: cache + invalidate-on-write.
2. Scope creep into maintained-on-write (eager LLM) — mitigate: ADR locks on-demand.

**Why now:** lowest priority; dashboard enrichment after M0. Do only if the Entities view demands it.

---

## State-of-the-art references

Conceptual comparison peers. `REDACTED` / `REDACTED` / `REDACTED` are already cloned under
`knowledge-base/references/` (see `_catalog.md`). REDACTED / REDACTED are **not cloned** — this track
used a conceptual cross-check only; clone them via `/roadmap-feature` Step 5 SOTA delta if a
milestone needs line-level study.

| Peer | License | Why it's here | Supports milestone(s) |
|---|---|---|---|
| REDACTED (REDACTED/REDACTED) | Apache-2.0 | Reference temporal context-graph engine — the source of the 3 deltas | M0, M1, M2 |
| REDACTED | (managed) | Productized context-graph infra — validates the "graph as augmentation over a memory substrate" framing | M0, M2 |
| REDACTED (cloned) | Apache-2.0 | Our architectural base (vector + LLM extraction + hybrid retrieval) | M0 |

---

## Revision protocol

- **Marking progress:** flip the checkbox in the `## M<N>` header. `cycle-release` flips it on merge when a plan declares `milestone_id: M<N>`.
- **Adjusting a milestone's DoD:** edit in place, note the date in `CHANGELOG.md`.
- **Adding a milestone:** append `## M3 …` via `/roadmap-feature` (inserts before the `---` above `## State-of-the-art references`). Never renumber/reorder existing milestones.
- **Removing a milestone:** mark `~~## M<N> — [-] <name> (cancelled YYYY-MM-DD — reason)~~` rather than deleting.

## Unresolved at inception

- M1 is intentionally gated on a demonstrated need (YAGNI) — resolve that gate before starting M1.
- Naming note: informal "M1/M2" labels in `CLAUDE.md` / memory refer to memory-gap *workstreams* (Item 21 sandbox, episodes), NOT these ROADMAP.md milestones. This file's M0/M1/M2 are the formal machine-tracked milestones.
