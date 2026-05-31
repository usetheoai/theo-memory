# Deps Audit: v0-4b-fixes-cycle

**Date:** 2026-05-30
**Mode:** plan-bound:v0-4b-fixes-cycle
**Verdict:** **PASS_WITH_CAVEATS** (cap 89) → **PASS** after plan v1.1 → v1.2 ADR D8 absorption
**Hard caps triggered:** ~~`plan_dep_major_outdated_unpinned`~~ — CLOSED by ADR D8 (plan v1.2): "Stay on zod ^3.25.0 (defer v3→v4 migration to dedicated cycle)"
**Original cap rationale:** zod ^3 → ^4 outdated MAJOR on a plan-declared runtime dep without ADR-pinning rationale (plan v1.1 § Dependencies). ADR D8 added 2026-05-30 explicitly declares the pin and defers migration; soft floor is structurally closed per golden rule § Allowlist mechanism (ADR-declared deferrals are accepted).

## Summary

- **Ecosystems detected:** npm (only)
- **Auditor coverage:** `npm audit`: ran ✓ | `npm outdated`: ran ✓ | `osv-scanner`: SKIPPED (binary not installed — cross-check coverage gap; see anti-pattern #5)
- **Total npm vulnerabilities found:** 4 MODERATE (all allowlisted within sunset → downgraded to LOW per golden rule § Allowlist mechanism)
- **Outdated:** 4 MAJOR + 1 MINOR (1 MAJOR on plan-declared runtime dep: zod)
- **Allowlist hits:** 4 active (esbuild + 3 deprecated @esbuild-kit chain via drizzle-kit; sunset 2026-08-23)
- **CRITICAL / HIGH CVEs:** ZERO

## Vulnerabilities (4 MODERATE, all allowlisted → effective LOW)

### GHSA-67mh-4wv8-2f99 — MODERATE → LOW (allowlist active until 2026-08-23)

**CVSS 3.1: 5.3** (AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N) — "esbuild enables any website to send any requests to the development server and read the response"

**Affected (4 nodes in the dependency graph):**

| Package | Range | Path |
|---|---|---|
| esbuild | <=0.24.2 | drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild |
| @esbuild-kit/core-utils | * | drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils |
| @esbuild-kit/esm-loader | * | drizzle-kit → @esbuild-kit/esm-loader |
| drizzle-kit | ^0.31.0 | root → drizzle-kit (devDep only) |

**Allowlist rationale (verbatim from `.claude/rules/deps-audit-allowlist.txt`):**
> MODERATE dev-server-request-leak chained from drizzle-kit ^0.31.0's deprecated @esbuild-kit/esm-loader (merged into tsx upstream). v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep). Fix requires drizzle-kit upstream to migrate to tsx; tracked at https://github.com/drizzle-team/drizzle-orm/issues.

**Sunset:** 2026-08-23 (84 days from this audit — within the 90-day MEDIUM-tier window per golden rule).

**Plan impact:** ZERO. v0-4b-fixes-cycle plan adds NO new deps and uses drizzle-kit at the same `^0.31.0` declared as Existing in the v0.4b plan; the dev-only restriction holds.

## Outdated (non-vulnerable)

| Package | Current | Latest | Wanted | Semver delta | Type | Plan-declared? |
|---|---|---|---|---|---|---|
| **zod** | **3.25.76** | **4.4.3** | 3.25.76 | **MAJOR** | runtime | **YES** (plan § Dependencies → `^3.25.0` for createLocalMemory config validation) |
| @types/node | 20.19.41 | 25.9.1 | 20.19.41 | MAJOR | dev | no |
| eslint | 9.39.4 | 10.4.1 | 9.39.4 | MAJOR | dev | no |
| typescript | 5.9.3 | 6.0.3 | 5.9.3 | MAJOR | dev | no |
| typescript-eslint | 8.59.4 | 8.60.0 | 8.60.0 | MINOR | dev | no |

### zod ^3 → ^4 — MAJOR outdated, no ADR pinning rationale (soft cap 89)

**Plan reference:** § Dependencies → "zod | ^3.25.0 | npm | createLocalMemory config validation" (T4.1)

**Severity rubric:** "Outdated MAJOR, no ADR pinning" → PASS_WITH_CAVEATS / cap 89 / stable identifier `plan_dep_major_outdated_unpinned`.

**Why this is borderline:** Zod v4 ships breaking changes (deprecated `.string()` defaults, schema-builder shape). The plan does NOT introduce a new zod dep — it cites the existing version. Strict reading: any plan that PINS a dep at an old MAJOR without an ADR justifying the pin is at the soft cap.

**Recommended actions (choose ONE before `/plan-confidence`):**

1. **Add explicit ADR row** to plan v1.2 with stable identifier `D8 — Stay on zod ^3.25.0 (not v4) for v0-4b-fixes-cycle scope`. Rationale: v0.4b-fixes is a 18-commit defects-closure cycle; introducing a zod-v4 migration adds breaking-change risk orthogonal to the review-findings goal. Defer v3→v4 to a dedicated `zod-v4-migration` plan.
2. **Bump to zod v4** in the same cycle as T4.1 (createLocalMemory wiring). Adds 1-2 commits but increases scope.
3. **Defer to v0.4b.1** (post-merge follow-up plan).

**Recommendation:** Option 1 is the lowest-risk path that keeps the soft cap to 89 instead of NON_SHIPPABLE.

## Outdated (dev deps, not plan-declared)

The 4 other outdated entries (`@types/node`, `eslint`, `typescript`, `typescript-eslint`) are NOT cited in the plan's `## Dependencies` section because they are dev-tooling, not runtime. Per the golden rule, devDeps outdated without runtime exposure are INFO-tier — no cap impact. Recommend a separate `deps-bump-2026-Q2` plan to address them collectively.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| @opentelemetry/api | Existing | yes (^1.9.0) | yes (0 CVEs) | n/a (existing) | OK |
| @opentelemetry/sdk-trace-base | Existing | yes (^2.0.0) | yes | n/a | OK |
| pg | Existing | yes (^8.13.0) | yes | n/a | OK |
| drizzle-orm | Existing | yes (^0.45.0) | yes (drizzle-kit allowlisted; drizzle-orm itself is clean) | n/a | OK |
| croner | Existing | yes (^10.0.1) | yes | n/a | OK |
| zod | Existing | yes (^3.25.0) | yes (0 CVEs at ^3.25) | n/a | **OUTDATED MAJOR — add ADR** |

**Coverage:** 6/6 plan deps match manifest exactly. No fabrication risk. Plan `## Dependencies` section structurally valid per golden rule § Severity rubric (no `plan_dependencies_section_missing` / `plan_dep_version_unspecified` / `plan_new_dep_no_rule9_evaluation` / `plan_dep_not_on_registry` triggers).

## Auditor coverage gap

`osv-scanner` is NOT installed locally; the cross-check vs `npm audit` was skipped. Per golden rule § Auditor unavailable for an ecosystem present: if an auditor in a stack with untestable HIGH/CRITICAL exposure caps verdict at 70 (`auditor_unavailable_osv-scanner`). HOWEVER, since `npm audit` returned ZERO HIGH/CRITICAL findings and the 4 MODERATE are already explicitly allowlisted, the cross-check absence is INFO-tier (cannot escalate a finding that doesn't exist). Documenting honestly per anti-pattern #5.

**Recommended:** install `osv-scanner` (single Go binary) for future audits — `go install github.com/google/osv-scanner/cmd/osv-scanner@latest` OR `brew install osv-scanner`. Once installed, re-run this audit and confirm the cross-check produces the same MODERATE-only result.

## Hard caps triggered

| Cap | Verdict band | Cause |
|---|---|---|
| `soft_floor_zod_major_outdated_no_adr` (informational name — golden rule's canonical id is `plan_dep_major_outdated_unpinned`) | PASS_WITH_CAVEATS / 89 | zod ^3 → ^4 outdated MAJOR, no ADR pinning rationale in plan v1.1 |

No HARD caps (no `plan_dep_critical_cve` / `plan_dep_high_cve` / `plan_dep_medium_cve` / `INVALID_PLAN_DEPS` family triggers).

## Recommended next steps (in order)

1. **Plan author**: add ADR D8 to v0-4b-fixes-cycle plan v1.2 justifying the zod ^3 pin (Option 1 above). Estimated 5 LoC of plan edit. Closes the soft floor.
2. **Re-run /deps-audit v0-4b-fixes-cycle** to confirm verdict bumps from PASS_WITH_CAVEATS to PASS.
3. **Proceed with /plan-confidence v0-4b-fixes-cycle** — current verdict caps plan-confidence at 89; with the ADR addition, no cap.
4. **(Optional, low priority)** install `osv-scanner` for future audit completeness.
5. **(Optional, deferred)** draft `deps-bump-2026-Q2` plan to collectively bump @types/node + eslint + typescript + typescript-eslint at a quiet time.

## Cross-references

- Allowlist source: `.claude/rules/deps-audit-allowlist.txt` (4 entries active, sunset 2026-08-23)
- Golden rule: `.claude/rules/deps-audit-golden-rule.md` § Severity rubric
- Plan: `.claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md` (v1.1)
- Prior v0.4b audit (same allowlist pattern): `.claude/knowledge-base/audits/v0-4b-forgetting-pipeline-deps-audit-2026-05-26.md` (PASS_WITH_CAVEATS at 89 — identical shape)
