# Implementation Summary — evolving-entity-summaries (M2)

**Plan:** knowledge-base/plans/evolving-entity-summaries-plan.md · milestone_id: M2

| Task | What | Evidence |
|---|---|---|
| T1.1 | `EntityNodeSummary.summary: string` (additive DTO) | typecheck 0; 4 fixtures updated |
| T1.2 | `list()` LATERAL: on-demand active-relations digest (`string_agg` of `relation → target` over `t_invalid IS NULL`); zero LLM; reflects M1 supersession | integration RED (`expected '' to contain 'loves → Adidas'` without the LATERAL) → GREEN; evolves on supersession (drops Adidas); empty for no active relations |
| T1.3 | In-memory double | N/A — no in-memory `MemoryEntityStore` (only `PgMemoryEntityStore`); DTO field type-covered |
| T2.1 | REST `GET /v1/scopes/:type/:id/entities` surfaces `summary` | integration: node.summary contains `lives_in → Berlin` |
| T3.1 | CHANGELOG + full suite green | 1271 passed / 0 errors; lint 0 |

## Wiring triad
- **Caller:** `MemoryEntityStore.list` (REST entitiesHandler + graphHandler nodes half).
- **Integration test:** `tests/integration/entities/entity-summary.test.ts` vs real pgvector (2/2).
- **Runtime metric:** the read is part of the existing entities endpoint (existing observability); no new hot path.

## Verdicts
- plan-confidence SHIPPABLE 97.6 · code-quality PASS (pending) · full contract suite 1271 passed / 0 errors · integration 2/2 · RED→GREEN proven. No migration, no new dependency.
