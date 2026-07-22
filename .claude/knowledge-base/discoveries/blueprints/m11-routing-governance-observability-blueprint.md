# Blueprint: M11 — Routing governance & observability

- **Slug:** `m11-routing-governance-observability`
- **Created:** 2026-07-22
- **Source plan:** `.claude/knowledge-base/discoveries/plans/m11-routing-governance-observability-plan.md`
- **Verdict target:** SHIPPABLE — grounds the per-`(workspace,user)` routing config + placement-decision audit + isolation against mem0/graphiti + the shipped theo-memory governance machinery.

## Context

M8 gave the agent a per-write routing choice (global vs session under `(workspace, user)`); M9 promotes
durable session facts to global. M11 makes both **operable + auditable**: a per-`(workspace, user)`
routing-policy config (fail-closed defaults, admin-scoped writes), a queryable audit of every
routing/promotion decision (Princípio 3), and a dashboard — cross-user isolation asserted (404). The
design is **reuse-first** (Rule 9): the audit reuses the shipped recall-trace store + M9
`consolidation_history`; config validation reuses `zod`; the isolation boundary reuses the M8
`(workspace, user)` Principal + `composeFilters`.

## Objective

Ground M11's config shape, audit-record shape, and isolation-read boundary against real prior art, each
mapped to a shipped theo-memory symbol OR a new-code ADR.

## Coverage Corner 1 — Integration Tests

**Q4 — how does a reference test per-config / per-tenant isolation of config reads?**

mem0 keeps config tests under `mem0/tests/configs/` (verified dir) and exercises the pydantic
`MemoryConfig` (`mem0/mem0/configs/base.py:29`) construction/defaults. Its per-user surface is the
`user_id` filter on the store; mem0 does NOT ship a per-tenant *config-read* isolation test (config is
process-level, not per-tenant) — so this is a gap the theo-memory design must cover itself, not copy.

**Mapping (theo-memory):** a real-`ankane/pgvector` integration test asserting the ROADMAP M11 hard gate —
a routing-policy/audit read for `(workspace_B, user_B)` returns **404** for `(workspace_A, user_A)`'s
record (the `#113`-style hermetic pattern), reusing the M8 `(workspace, user)` filter already proven in
`tests/integration/cross-user-isolation.test.ts`. The isolation test is theo-memory-NOVEL (mem0/graphiti
have no per-tenant config isolation to copy) — grounded in our own shipped boundary, not fabricated prior art.

## Coverage Corner 2 — Dependencies

**Q5 — what deps does config validation need; does theo-memory need a NEW one?**

mem0 validates config with **`pydantic>=2.7.3`** (`mem0/pyproject.toml`) — a typed-model validator with
field defaults. graphiti's `SearchConfig` (`graphiti_core/search/search_config.py:112`) is likewise a
`pydantic BaseModel` with `Field(default=...)`.

**Mapping (theo-memory):** the TS analog of pydantic is **`zod`**, already a shipped dependency used across
the REST layer. The per-`(workspace,user)` routing-policy config is validated by a `zod` schema with
fail-closed defaults — **NO new dependency** (Rule 9 / parsimony rung 4). ADR D3 locks this.

## Coverage Corner 3 — Tools

**Q6 — what REST/dashboard surface does a memory product expose for config + observability?**

mem0's server (`mem0/server/`) ships `main.py` (REST), `auth.py`, `db.py` (+ alembic migrations) and a
`dashboard/` directory — i.e. a REST config/CRUD surface fronted by a dashboard. It is a full
FastAPI+Postgres service, not a per-tenant policy engine.

**Mapping (theo-memory):** a self-sufficient REST surface in theo-memory — `GET/PUT /v1/routing-policy`
(admin-scoped write, fail-closed default read) + `GET /v1/routing-audit` (workspace+user-scoped) — with
the theo-cloud dashboard as the M4-style **cross-repo split** (ships behind M5 CD; does not gate the M11
checkbox if the REST/audit surface lands in theo-memory). Stop-criterion honored (EC-4): the shape, not
mem0's full route table.

## Coverage Corner 4 — Techniques

**Q1 — per-instance/per-user config shape.** mem0's `MemoryConfig(BaseModel)`
(`mem0/mem0/configs/base.py:29`) is a typed object composing sub-configs (`vector_store`, `llm`,
`embedder`, `reranker: Optional = None`) + scalar knobs (`history_db_path`), each a `Field(default=...)`.
Pattern: **one typed config object, composable, with defaults**. → theo-memory: a per-`(workspace,user)`
routing-policy row `{ defaultScope, llmRouting: bool, confirmationThreshold, … }`, zod-validated,
fail-closed defaults, keyed by `(workspace_id, user_id)`.

**Q2 — named policy presets.** graphiti's `search_config_recipes.py` ships **16 named `SearchConfig`
presets** (`COMBINED_HYBRID_SEARCH_RRF`, `…_MMR`, …) — reusable, versioned config objects consumed by
name. Pattern: **a default policy + named overrides**. → theo-memory: a system **fail-closed default
routing policy** + a per-`(workspace,user)` override row (absent row → the default; Princípio 3
auditability of which policy applied).

**Q3 — placement/mutation audit.** mem0's history store (`mem0/mem0/memory/storage.py`) records every
memory mutation with columns **`memory_id, old_memory, new_memory, event, created_at, actor_id`** — i.e.
exactly who (`actor_id`) / when (`created_at`) / what (`old→new`) / why (`event`). This IS a placement/
mutation audit. → theo-memory: **REUSE the shipped recall-trace store**
(`packages/core/src/domain/dip/recall-trace-store.ts` + `infrastructure/db/recall-trace/`) + M9's
`consolidation_history`; the routing/promotion audit record `{ chosenScope, attribution(user|agent),
decidedBy, at, why }` maps 1:1 onto mem0's `event`/`actor_id`/`created_at` columns — Rule 9, no new audit
engine (ADR D2).

## Cross-cutting Comparison

| Dimension | mem0 | graphiti | theo-memory (M11 design) |
|---|---|---|---|
| Config shape | pydantic `MemoryConfig` (composable, defaults) | pydantic `SearchConfig` + named recipes | zod routing-policy row per `(workspace,user)`, fail-closed defaults (Q1/Q2) |
| Policy presets | single process config | 16 named `SearchConfig` recipes | default policy + per-`(workspace,user)` override (Q2) |
| Placement audit | `history` table: `event/actor_id/created_at/old→new` | episodic/edge provenance (graph) | REUSE recall-trace store + `consolidation_history` (Q3, ADR D2) |
| Config validation dep | `pydantic>=2.7.3` | `pydantic` | shipped `zod` — no new dep (Q5, ADR D3) |
| Surface | FastAPI `server/` + `dashboard/` | (library) | REST `/v1/routing-policy` + `/v1/routing-audit` + theo-cloud dashboard split (Q6) |
| Per-tenant config isolation | none (process-level) | none | **404 cross-`(workspace,user)`** — M8 boundary reuse (Q4, hard gate) |

## ADRs

### D1 — Routing-policy config = a per-`(workspace,user)` zod-validated row with fail-closed defaults

Mirrors mem0's typed `MemoryConfig` + graphiti's default+named-override pattern. A missing row resolves to
the system fail-closed default (routing conservative, LLM-off, default scope) so a mis-config can never
silently disable isolation. Admin-scoped writes bound to the caller's own `(workspace, user)`.
**Alternative rejected:** a global process config (mem0's shape) — cannot express per-tenant policy, the
whole point of M11.

### D2 — Audit reuses the shipped recall-trace store + `consolidation_history`, NOT a new engine (Rule 9)

The routing/promotion audit record reuses the recall-trace governance machinery
(`recall-trace-store.ts`) + M9's `consolidation_history`; its `{chosenScope, attribution, decidedBy, at,
why}` fields map onto mem0's `event/actor_id/created_at`. **Alternative rejected:** a bespoke routing-audit
engine — duplicates M4 governance (Rule 9 violation). Item 14 graph-audit stays declined.

### D3 — Config validation reuses `zod`; isolation reuses the M8 Principal (Rule 9 / parsimony rung 4)

No new validator (mem0 uses pydantic; the TS analog `zod` is already shipped). Every config/audit read is
scoped by the resolved `Principal{workspaceId, userId}` + `composeFilters` (the M8 boundary); a mis-scoped
read returns 404 (no cross-user, no cross-tenant). **Alternative rejected:** a new isolation mechanism —
the M8 boundary is proven (`cross-user-isolation.test.ts`).

## References (all verified on disk 2026-07-22)

- `mem0/mem0/configs/base.py:29` — `MemoryConfig(BaseModel)`
- `mem0/mem0/memory/storage.py` — history audit columns
- `mem0/pyproject.toml` — `pydantic>=2.7.3`
- `mem0/server/` — REST + dashboard surface
- `mem0/tests/configs/` — config tests
- `graphiti/graphiti_core/search/search_config_recipes.py` — 16 named `SearchConfig` presets
- `graphiti/graphiti_core/search/search_config.py:112` — `SearchConfig(BaseModel)`
- Internal reuse: `packages/core/src/domain/dip/recall-trace-store.ts`, M9 `consolidation_history`, M8 Principal/`composeFilters`, `tests/integration/cross-user-isolation.test.ts`
