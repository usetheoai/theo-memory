---
slug: m11-routing-governance-observability
milestone_id: M11
created_at: 2026-07-22
goal: Ship a per-(workspace,user) routing-policy config + a queryable placement-decision audit + REST surface, proven by a real-pgvector test where a routing/promotion decision is retrievable for its own (workspace,user) and another user's request returns 404.
---

# M11 — Routing governance & observability

## Goal

Ship a per-`(workspace, user)` routing-policy config + a queryable placement-decision audit + a REST
surface, proven by a real-`ankane/pgvector` integration test where a routing/promotion decision is
retrievable for its own `(workspace, user)` and another user's request returns **404**.

## Context

M8 routes each write to global vs session under `(workspace, user)`; M9 promotes durable session facts to
global. M11 makes both operable + auditable: a per-`(workspace, user)` routing policy (fail-closed
defaults, admin-scoped writes) + an audit of every routing/promotion decision (Princípio 3) + REST, with
cross-user isolation asserted (404). Design is **reuse-first** per the SHIPPABLE_WITH_CAVEATS blueprint
`.claude/knowledge-base/discoveries/blueprints/m11-routing-governance-observability-blueprint.md` (ADRs
D1/D2/D3): config validated by shipped `zod`; audit reuses the recall-trace store + M9
`consolidation_history`; isolation reuses the M8 `(workspace, user)` Principal + `composeFilters`.

## Baseline Context

### Files that will be touched

| File | LoC | Last sha | Role in M11 |
|---|---|---|---|
| `packages/core/src/infrastructure/db/migrations/0025_routing_policies.sql` | 0 (NEW) | — | `routing_policies` table keyed by `(workspace_id, user_id)` |
| `packages/core/src/infrastructure/db/migrations/0026_routing_audit.sql` | 0 (NEW) | — | `routing_audit` table (or a view over reused governance) |
| `packages/core/src/domain/dip/routing-policy-store.ts` | 0 (NEW) | — | `RoutingPolicyStore` DIP (get/put, fail-closed default) |
| `packages/core/src/domain/dip/recall-trace-store.ts` | 197 | `0558ee6` | audit-store SHAPE reused (Rule 9, ADR D2) |
| `packages/core/src/infrastructure/db/scope-filters.ts` | 154 | `8777188` | `(workspace,user)` filter reused for isolation reads (ADR D3) |
| `packages/api/src/server/routes/register-routes.ts` | 191 | `eee1c13` | mount `GET/PUT /v1/routing-policy` + `GET /v1/routing-audit` |
| `packages/api/src/server/handlers/scoped-forget.ts` | 66 | `84f71a7` | `principalUserId`/`workspaceBoundMemory` + 404-on-mismatch pattern reused |
| `packages/core/src/infrastructure/db/migrations/0024_m8_composite_scope_index.sql` | 7 | `6ea50cf` | latest migration → next is `0025` |

### Current callers / boundaries

- Routing today = the agent's per-write scope-tier choice, enforced at the edge (M8: `schemas.ts`
  resolveScope + MCP routing). M11 governs THAT choice; it does not add a new write path.
- Audit machinery already shipped: `recall-trace-store.ts` (197 LoC DIP) + M9 `consolidation_history`.
- Isolation boundary shipped + proven: `tests/integration/cross-user-isolation.test.ts` (M8).

### Glossary

- **routing decision** — which scope (`global` vs `session`) a write landed in, under `(workspace, user)`.
- **routing policy** — the per-`(workspace, user)` config governing defaults (default scope, LLM-routing on/off, `confirmation` threshold).
- **placement audit** — a queryable record `{chosenScope, attribution(user|agent), decidedBy, at, why}` per routing/promotion decision.
- **fail-closed default** — an absent policy row resolves to the conservative system default (never disables isolation).

### Architecture boundaries

Domain declares `RoutingPolicyStore` (DIP); infrastructure implements it against Postgres. REST handlers
resolve a `Principal{workspaceId,userId}` and scope every read by it (`architecture.md § 2` DIP + M8
boundary). No domain→infra leak.

## Prior Art & Related Work

- Blueprint at `.claude/knowledge-base/discoveries/blueprints/m11-routing-governance-observability-blueprint.md` (SHIPPABLE_WITH_CAVEATS) — mem0
  `MemoryConfig`/`history` + graphiti `SearchConfig` recipes, mapped to reuse.
- Internal: M8 `(workspace,user)` isolation, M9 `consolidation_history`, shipped recall-trace governance.

## ADRs

### D1 — Routing-policy config = a per-(workspace,user) zod-validated row with fail-closed defaults

The policy is a `routing_policies` row keyed `(workspace_id, user_id)`, validated by the shipped `zod`; an
absent row resolves to the conservative system default (routing off / default scope) so a mis-config never
silently disables isolation. Admin-scoped writes bound to the caller's own `(workspace, user)`.
**Alternative rejected:** a global process config (mem0's shape) — cannot express per-tenant policy, the
whole point of M11. **Alternative rejected:** storing policy in the memories table — conflates data with
governance.

### D2 — Audit reuses the shipped recall-trace store + `consolidation_history`, NOT a new engine (Rule 9)

The routing/promotion audit record `{chosenScope, attribution, decidedBy, at, why}` reuses the recall-trace
governance shape (`recall-trace-store.ts`) + M9 `consolidation_history`. **Alternative rejected:** a
bespoke routing-audit engine — duplicates M4/M9 governance (Rule 9). **Alternative rejected:** a graph
audit (Item 14) — stays declined.

### D3 — Config/audit reads scoped by the M8 Principal; mismatch → 404 (Rule 9)

Every config/audit read is scoped by the resolved `Principal{workspaceId,userId}` + `composeFilters`; a
cross-`(workspace,user)` read returns 404 (no existence leak), mirroring `scoped-forget.ts`.
**Alternative rejected:** a new isolation mechanism — the M8 boundary is proven.

## Dependency Graph

```
Phase 1 (config: table + DIP + zod + default) ─→ Phase 3 (REST) ─→ Phase 4 (integration + isolation)
Phase 2 (audit: table/reuse + emit)          ─┘
```

Phase 1 and Phase 2 are independent; Phase 3 consumes both; Phase 4 validates end-to-end.

## Phase 1 — Routing-policy config

### T1.1 — `routing_policies` table + `RoutingPolicyStore` DIP + fail-closed default

#### Files to edit
- `packages/core/src/infrastructure/db/migrations/0025_routing_policies.sql` (NEW)
- `packages/core/src/domain/dip/routing-policy-store.ts` (NEW)
- `packages/core/src/infrastructure/db/routing-policy-store-pg.ts` (NEW)

#### Why this step
The config is the governance primitive M11 adds (blueprint Q1/D1). A DIP keeps the domain free of pg
(`architecture.md § 2`); the table keyed `(workspace_id, user_id)` reuses the M8 isolation key.

#### TDD
- `RED: test_absent_policy_resolves_to_failclosed_default` — `get(ws,user)` with no row returns the
  conservative default (routing off / default scope), never null-that-disables-isolation.
- `RED: test_put_then_get_roundtrips_the_policy` — `put(ws,user,policy)` then `get(ws,user)` returns it.
- `RED: test_zod_rejects_invalid_policy` — an out-of-enum `defaultScope` throws a typed `InvalidRoutingPolicy`.

#### Concurrency tests
(none — single-threaded get/put; the UPSERT is atomic in one statement)

#### Acceptance criteria
- Absent row → fail-closed default; put→get roundtrip; invalid policy → typed error.

#### DoD
- `npm run typecheck` + the 3 unit tests green.

## Phase 2 — Placement-decision audit (reuse)

### T2.1 — Emit + store a routing/promotion audit record (reuse governance shape)

#### Files to edit
- `packages/core/src/infrastructure/db/migrations/0026_routing_audit.sql` (NEW)
- `packages/core/src/infrastructure/db/routing-audit-store-pg.ts` (NEW)

#### Why this step
Princípio 3 — every routing/promotion decision must be observable + queryable (blueprint Q3/D2). Reuses
the recall-trace/consolidation audit shape rather than a new engine (Rule 9).

#### TDD
- `RED: test_routing_decision_is_recorded_with_who_what_why` — a routing decision writes a
  `routing_audit` row `{workspace_id,user_id,chosen_scope,attribution,decided_by,at,why}`.
- `RED: test_audit_read_is_workspace_user_scoped` — `list(ws,user)` returns only that scope's rows.

#### Failure scenarios
- DB write of the audit row fails → the routing decision still succeeds (fail-soft, best-effort audit
  like `scoped forget`'s history), with an OTel `routing_audit_write_failed` event — never blocks the write.

#### Acceptance criteria
- Audit row carries who/what/why; reads are `(workspace,user)`-scoped; audit-write failure is fail-soft.

#### DoD
- 2 unit tests green + typecheck.

## Phase 3 — REST surface

### T3.1 — `GET/PUT /v1/routing-policy` (admin) + `GET /v1/routing-audit` (scoped)

#### Files to edit
- `packages/api/src/server/handlers/routing-policy.ts` (NEW)
- `packages/api/src/server/handlers/routing-audit.ts` (NEW)
- `packages/api/src/server/routes/register-routes.ts` (mount)

#### Why this step
Operators need a REST surface to configure + inspect placement (blueprint Q6/D3). Reuses
`principalUserId`/`workspaceBoundMemory` + the 404-on-mismatch pattern from `scoped-forget.ts`.

#### TDD
- `RED: test_put_policy_requires_admin_scope` — a non-admin caller → 403; admin → 200.
- `RED: test_get_audit_is_workspace_user_scoped_404_cross_user` — user B reading user A's audit → 404.

#### Failure scenarios
- `RoutingPolicyStore` throws → 500 with a typed body (never a silent 200).

#### Acceptance criteria
- Admin-scoped PUT; scoped GET; cross-user read → 404.

#### DoD
- 2 handler tests green + typecheck + lint.

## Phase 4 — Integration + isolation hard gate

### T4.1 — Real-pgvector: decision retrievable for own scope; cross-user → 404

#### Files to edit
- `tests/integration/routing/governance-isolation.test.ts` (NEW)

#### Why this step
The ROADMAP M11 hard gate: prove config + audit + isolation on real `ankane/pgvector`.

#### TDD
- `RED: test_routing_governance_and_isolation` — user A sets a policy + makes a routed write (audit row
  written); A reads its policy + audit back; user B in the SAME workspace reading A's policy/audit → 404.

#### Failure scenarios
- pgvector unavailable (`THEOMEM_PG_URI` unset) → `describe.skip` (no false green).

#### Acceptance criteria
- THE GOAL TEST passes on real pgvector; isolation 404 held.

#### DoD
- Integration test green under `THEOMEM_PG_URI`.

## Coverage Matrix

| M11 DoD item (ROADMAP) | Task(s) |
|---|---|
| Per-`(workspace,user)` routing-policy config, fail-closed, admin-scoped writes | T1.1 + T3.1 |
| Every routing/promotion decision is a queryable audit record | T2.1 |
| Dashboard (theo-cloud) — cross-repo split (does not gate the checkbox) | (out of repo — M4 precedent, see Drawbacks) |
| Isolation hard gate — cross-`(workspace,user)` config/audit read → 404 | T3.1 + T4.1 |
| Integration test (real pgvector): retrievable for own scope; other user → 404 | T4.1 |

100% of the in-repo M11 DoD maps to ≥ 1 task; the dashboard is the declared cross-repo split.

## Drawbacks & Risks

1. **Config surface = new misconfig/attack surface (HIGH).** A per-`(workspace,user)` policy that disables
   routing could force everything into one scope. **Mitigation:** fail-closed defaults (absent/invalid →
   conservative), admin-scoped writes bound to the caller's own `(workspace,user)`, every config change
   audited. **Owner:** T1.1/T3.1.
2. **Cross-repo dashboard dependency (MEDIUM).** The UI lives in theo-cloud. **Mitigation:** ship the
   self-sufficient REST/audit surface in theo-memory first; the dashboard rides M5 CD (M4 precedent); split
   the checkbox. **Owner:** T3.1.
3. **Audit write amplification on the hot write path (MEDIUM).** One audit row per routed write.
   **Mitigation:** fail-soft best-effort write (never blocks), reuse the shipped recall-trace retention/cron
   so audit volume is bounded. **Owner:** T2.1.

## Unresolved Questions

- Should the audit reuse the `recall_traces` table directly or a dedicated `routing_audit` table? **Resolved
  at plan time:** a dedicated `routing_audit` table (D2) — routing decisions have a distinct field set
  (`chosen_scope`, `attribution`) from recall traces; reuse the STORE shape/retention, not the table. (none other — every decision resolved at plan time.)

## Failure scenarios

- **DB driver (Postgres) audit write fails** → fail-soft: the routed write succeeds, an OTel
  `routing_audit_write_failed` event fires, no crash (T2.1).
- **DB read for a cross-`(workspace,user)` config/audit** → 404 (no existence leak), never 403 (T3.1/T4.1).
- **pgvector unavailable in CI** → integration `describe.skip` (no false green) (T4.1).

## Global Definition of Done

- All phase DoDs green; `npm run typecheck` + `npm run lint` clean.
- THE GOAL TEST (T4.1) passes on real `ankane/pgvector`.
- `/plan-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS; `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review`
  READY_TO_MERGE before release.
