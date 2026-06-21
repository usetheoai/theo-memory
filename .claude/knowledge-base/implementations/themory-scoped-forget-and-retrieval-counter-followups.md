# Followups — themory-scoped-forget-and-retrieval-counter

| # | Observed during | Description | Recommended owner |
|---|---|---|---|
| F1 | T1.2 (SEPA pre-commit) | DRY: extract `pathParamsToScoped` + `SCOPE_TYPES`/`ScopeTypeSchema` to a shared `packages/api/src/server/handlers/_scope-params.ts`. Now duplicated across metrics.ts, entities.ts, graph.ts, scopes.ts, scoped-forget.ts. Deferred (atomic 5-handler extraction PR is cleaner than a partial extraction inside T1.2, which would touch already-shipped metrics/entities out of scope). | dedicated refactor PR |
