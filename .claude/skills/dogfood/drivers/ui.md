# Dogfood driver — UI surface

> Scaffold (T1.2). Filled by T3.1. Tells Claude Code how to execute each J-UI-* journey from
> `knowledge-base/dogfood/journeys.md` AS A HUMAN and record one evidence file per journey
> (frontmatter per `dogfood-golden-rule.md § 5`: journey/date/operator/outcome/oracle_result/summary;
> `oracle_result` = the machine-observable proof; secrets redacted to `theo_live_`/`sk-or-` + ≤4 chars).

## Per-journey protocol (to be filled)

For each J-UI-N in the catalog:
1. Steps — the human actions on the UI surface.
2. Oracle — the machine observation recorded as `oracle_result`.
3. On failure — write `outcome: fail reason=<...>` (never a silent skip; EC-8 oracle_unresolvable).
