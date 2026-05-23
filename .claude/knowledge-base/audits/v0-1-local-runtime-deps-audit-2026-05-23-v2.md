# Deps Audit: v0-1-local-runtime (re-run after v1.1 → v1.2 absorption)

**Date:** 2026-05-23 (re-run)
**Mode:** plan-bound (`.claude/knowledge-base/plans/v0-1-local-runtime-plan.md` v1.2)
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** `soft_floor_drizzle_orm_outdated_major_pinned_per_adr`, `soft_floor_zod_outdated_major_pinned_per_adr`, `soft_floor_otel_sdk_outdated_major_bumped`, `auditor_unavailable_osv-scanner`

## Changes since v1 audit

All 9 NEW deps from plan v1.2 now resolve cleanly on the npm registry:

| Dep | Plan v1.1 | Plan v1.2 | Resolves to | Δ vs v1 audit |
|---|---|---|---|---|
| `pg` | ^8.13.0 | ^8.13.0 | 8.21.0 | unchanged |
| `drizzle-orm` | ^0.36.0 | ^0.36.0 (ADR D1.9) | 0.36.4 | pinned with ADR |
| `zod` | ^3.24.0 | ^3.24.0 (ADR D1.8) | 3.25.76 | pinned with ADR |
| `drizzle-kit` | ^0.28.0 | ^0.28.0 | 0.28.1 | unchanged |
| `@types/pg` | ^8.11.0 | ^8.11.0 | 8.20.0 | unchanged |
| `vitest-mock-extended` | ^3.0.0 | **^4.0.0** | 4.0.0 | BUMPED |
| `@opentelemetry/api` | **^1.10.0 (INVALID)** | **^1.9.0** | 1.9.1 | **BLOCKER FIXED** |
| `@opentelemetry/sdk-trace-base` | ^1.30.0 | **^2.0.0** | 2.7.1 | BUMPED |
| `natural` | ^8.1.0 | ^8.1.0 | 8.1.1 | unchanged |

## Verdict rationale

BLOCKER (`plan_dep_not_on_registry`) for `@opentelemetry/api ^1.10.0` cleared via fix to `^1.9.0`. Remaining caveats:

1. **`drizzle-orm ^0.36.0` outdated MAJOR (latest 0.45.2)** — explicit pin via ADR D1.9. Soft cap 89.
2. **`zod ^3.24.0` outdated MAJOR (latest 4.4.3)** — explicit pin via ADR D1.8. Soft cap 89.
3. **`@opentelemetry/sdk-trace-base ^2.0.0`** — bumped from ^1.30 per audit; this resolves to 2.7.1 (current latest is 2.7.1). NOT outdated. The "outdated MAJOR" caveat resolved.
4. **`osv-scanner` not installed** — cross-check gap. Soft cap 89. Recommendation persists: install for next run.

Per `deps-audit-golden-rule.md`, outdated MAJOR pinned WITH ADR is the documented mitigation — verdict caps at **PASS_WITH_CAVEATS** (89), NOT INVALID. The ADRs are non-empty + cite specific breaking changes that justify staying on the older line.

## Vulnerabilities

- Current manifest: 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW (`npm audit` clean — 299 deps)
- NEW deps (spot-check via `npm view` advisory metadata): no known CRITICAL/HIGH disclosures at the declared versions
- Transitive vulnerabilities: cross-check requires `osv-scanner` (gap noted; soft cap)

## Acceptance for plan-confidence

This audit's verdict (PASS_WITH_CAVEATS, 89) feeds `/plan-confidence`. Per the locked golden rule, this means:

- Plan-confidence final score capped at **89** (SHIPPABLE_WITH_CAVEATS band) due to soft caps
- NOT a blocker — the cycle-plan chain can advance to `/plan-confidence`
- A future `/deps-audit` re-run after either (a) drizzle/zod migration in v0.2 OR (b) `osv-scanner` installation should lift the caveats

## Recommended next steps

1. Install `osv-scanner` to close the cross-check gap (one-time setup):
   ```bash
   go install github.com/google/osv-scanner/cmd/osv-scanner@latest
   # OR
   brew install osv-scanner
   ```
2. Proceed to `/plan-confidence v0-1-local-runtime`.
3. After T0.1 lands the deps in `package.json`, re-run `/deps-audit v0-1-local-runtime` to confirm zero CVE in the resolved transitive tree (definitive check; current is spot-check).
