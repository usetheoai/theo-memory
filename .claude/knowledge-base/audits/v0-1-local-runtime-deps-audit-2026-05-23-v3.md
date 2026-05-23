# Deps Audit: v0-1-local-runtime (v3 — post-D1.10 bump + allowlist)

**Date:** 2026-05-23 (third run, after plan v1.2 → v1.3 forced-bump revision)
**Mode:** plan-bound (`.claude/knowledge-base/plans/v0-1-local-runtime-plan.md` v1.3)
**Verdict:** **PASS_WITH_CAVEATS** (89)
**Hard caps triggered:** `soft_floor_dev_only_moderate_cve_allowlisted`, `auditor_unavailable_osv-scanner`

## What changed since v2

Real-tree audit during /implement T0.1 (iteration 1, 2026-05-23 12:18) exposed a HIGH CVE on drizzle-orm <0.45.2 (GHSA-XXXX SQL injection via improperly escaped SQL identifiers). v3 absorbs the fix per plan v1.3 + ADR D1.10:

| Dep | v1.2 (planned) | v1.3 (planned) | Reality after bump |
|---|---|---|---|
| `drizzle-orm` | ^0.36.0 | **^0.45.0** | drizzle-orm@0.45.2 resolved; HIGH CVE CLEARED |
| `drizzle-kit` | ^0.28.0 | **^0.31.0** | drizzle-kit@0.31.10 resolved; brings esbuild ^0.25.4 directly but transitive @esbuild-kit chain still pulls old esbuild |

## Vulnerabilities (resolved tree, scratch-dir audit)

| Severity | Count | Sources | Status |
|---|---|---|---|
| CRITICAL | 0 | — | clean |
| HIGH | 0 | (drizzle-orm CVE cleared by bump) | clean |
| MODERATE | 4 | esbuild + @esbuild-kit/core-utils + @esbuild-kit/esm-loader + drizzle-kit (all from single root GHSA-67mh-4wv8-2f99) | **ALLOWLISTED** sunset 2026-08-23 |
| LOW | 0 | — | clean |

### Root-cause analysis of the 4 MODERATE findings

All 4 chain to **GHSA-67mh-4wv8-2f99** on esbuild ("esbuild enables any website to send any requests to the development server and read the response"). Propagation path:

```
drizzle-kit ^0.31.0
  └── @esbuild-kit/esm-loader (DEPRECATED — merged into tsx upstream)
        └── @esbuild-kit/core-utils
              └── esbuild <=0.24.2 (vulnerable)
```

drizzle-kit 0.31.10 ALSO declares `esbuild ^0.25.4` as a direct dep (patched) but the deprecated `@esbuild-kit/esm-loader` keeps the old esbuild in the tree.

### Why allowlisted (4 entries, sunset 2026-08-23, 92 days from today)

1. **Dev-only impact.** The CVE affects the esbuild dev-server's response handling. TheMemory uses drizzle-kit purely as a CLI invocation (`db:push`, `db:generate`) — no dev-server is spun up.
2. **devDep, not runtime.** drizzle-kit + esbuild + @esbuild-kit/* are devDependencies. The production npm package `@usetheo/memory` does NOT bundle them.
3. **Upstream fix in flight.** `@esbuild-kit/esm-loader` is deprecated by its maintainer (merged into `tsx`). drizzle-kit upstream needs to migrate to `tsx`. Tracked via the upstream issue tracker; not under our control.
4. **Sunset 90 days.** Per `deps-audit-golden-rule.md § Allowlist mechanism` MEDIUM CVEs allow ≤ 90-day sunset. Re-audit at sunset to verify either (a) drizzle-kit migrated to tsx OR (b) escalate by switching ORM.

Allowlist entries written to `.claude/rules/deps-audit-allowlist.txt`:
```
npm|esbuild|<=0.24.2|GHSA-67mh-4wv8-2f99|...|2026-08-23
npm|@esbuild-kit/core-utils|*|GHSA-67mh-4wv8-2f99|...|2026-08-23
npm|@esbuild-kit/esm-loader|*|GHSA-67mh-4wv8-2f99|...|2026-08-23
npm|drizzle-kit|^0.31.0|GHSA-67mh-4wv8-2f99|...|2026-08-23
```

## Plan validation (v1.3)

| Plan dep | Section | Declared | Resolves to | Audit clean? | Verdict |
|---|---|---|---|---|---|
| `pg` | New (runtime) | `^8.13.0` | 8.21.0 | yes | OK |
| `drizzle-orm` | New (runtime) | `^0.45.0` (D1.10) | 0.45.2 | yes (HIGH cleared) | OK |
| `zod` | New (runtime) | `^3.24.0` (D1.8 pin) | 3.25.76 | yes | OK |
| `drizzle-kit` | New (dev) | `^0.31.0` (D1.10) | 0.31.10 | MODERATE allowlisted | PASS_WITH_CAVEATS |
| `@types/pg` | New (dev) | `^8.11.0` | 8.20.0 | yes | OK |
| `vitest-mock-extended` | New (dev) | `^4.0.0` | 4.0.0 | yes | OK |
| `@opentelemetry/api` | New (dev) | `^1.9.0` | 1.9.1 | yes | OK |
| `@opentelemetry/sdk-trace-base` | New (dev) | `^2.0.0` | 2.7.1 | yes | OK |
| `natural` | New (optional peer) | `^8.1.0` | 8.1.1 | yes | OK |

## Verdict rationale

- HIGH CVE on drizzle-orm CLEARED by D1.10 bump → no `plan_dep_high_cve`
- 4 MODERATE CVEs on dev-only deps ALLOWLISTED with 90-day sunset → downgraded to soft floor (cap 89)
- `osv-scanner` cross-check still unavailable → soft floor (cap 89; gap noted)

Effective cap: 89 (PASS_WITH_CAVEATS). Plan-confidence v1.3 returns SHIPPABLE (94.0) because plan-confidence dimensions are independent of deps-audit's soft floor (the cap merge only applies at the cycle-plan-runner level; this audit is run standalone for documentation).

## Acceptance for plan-confidence

Per cycle-plan v1.1 wiring: plan-confidence ingests deps-audit verdict. With `--no-code-quality` flag (used because code-quality runs as a separate gate in cycle-implement, not at plan-time), plan-confidence returns SHIPPABLE (94.0). The deps-audit cap of 89 applies if cycle-plan-runner enforces the merge — operational equivalence: SHIPPABLE_WITH_CAVEATS (89) at most.

## Recommended next steps

1. Commit plan v1.3 + deps-audit v3 report + allowlist updates
2. Re-attempt /implement v0-1-local-runtime in a fresh session OR continue this one
3. At T0.1, re-run `npm install` + `npm audit` — expect 0 CRITICAL / 0 HIGH / 4 MODERATE (allowlisted); commit will succeed
4. Re-audit at sunset 2026-08-23 to verify upstream drizzle-kit fix OR escalate
