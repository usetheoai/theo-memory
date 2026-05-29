# Deps Audit: v0-4b-forgetting-pipeline

**Date:** 2026-05-26
**Mode:** plan-bound (`v0-4b-forgetting-pipeline-plan.md` v1.1)
**Verdict:** **PASS_WITH_CAVEATS** (allowlisted MODERATE → downgraded to LOW per golden rule § Allowlist mechanism)
**Hard caps triggered:** [`plan_dep_low_cve` (downgraded from MEDIUM via allowlist)]
**Plan-confidence cap (effective):** 89 (SHIPPABLE_WITH_CAVEATS band)

## Summary

- **Ecosystems detected:** npm only (no `pyproject.toml`, `Cargo.toml`, `go.mod` at repo root)
- **Auditor coverage:**
  - `npm audit` (json): ran
  - `osv-scanner`: SKIPPED — binary not installed (`osv-scanner not found` in PATH); per golden rule anti-pattern #5 reported honestly. Single-tool coverage acceptable here because npm audit + GitHub Advisory cover the actual stack; the unallowlisted gap risk is bounded (drizzle-kit chain is the only allowlist).
  - `pip-audit` / `cargo audit` / `govulncheck`: N/A (no Python/Rust/Go manifests)
- **Total deps audited:** all of `package.json` + transitive (via lockfile)
- **Vulnerabilities found:** 0 CRITICAL, 0 HIGH, 4 MODERATE, 0 LOW
- **Allowlist hits:** 4 active (all 4 MODERATE findings are entries in `deps-audit-allowlist.txt` with sunset 2026-08-23 ≥ today 2026-05-26 → downgraded to LOW); 0 expired

## Vulnerabilities (sorted by severity)

### GHSA-67mh-4wv8-2f99 — MODERATE (npm: esbuild + @esbuild-kit/* + drizzle-kit)

- **Affected packages:** `esbuild <= 0.24.2`, `@esbuild-kit/core-utils *`, `@esbuild-kit/esm-loader *`, `drizzle-kit ^0.31.0`
- **Severity (raw):** MODERATE
- **Severity (post-allowlist):** LOW (downgraded; allowlist entry active until 2026-08-23 ≥ today)
- **Path:** `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`
- **Fix:** drizzle-kit upstream must migrate to `tsx` (deprecated `@esbuild-kit` chain merged into `tsx`); tracked in `https://github.com/drizzle-team/drizzle-orm/issues`
- **Allowlist rationale (verbatim from `.claude/rules/deps-audit-allowlist.txt`):** "MODERATE dev-server-request-leak chained from drizzle-kit ^0.31.0's deprecated @esbuild-kit/esm-loader (merged into tsx upstream). v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep). Fix requires drizzle-kit upstream to migrate to tsx; tracked at https://github.com/drizzle-team/drizzle-orm/issues. Plan v1.3 ADR D1.10 documents the bump rationale; re-audit at sunset to verify upstream fix or escalate."
- **v0.4b plan relevance:** v0.4b REUSES drizzle-kit for the `0002_eviction_columns.sql` migration (T0.1). The allowlist coverage applies; no v0.4b-specific bump action required. **Sunset reminder:** 2026-08-23 — before that date, the v0.4b implementation team SHOULD verify whether drizzle-kit has migrated to `tsx` upstream and update the allowlist entry accordingly.
- **Diff suggestion:** None for v0.4b (allowlist active; pre-existing v0.1 condition; v0.4b adds no related dep).

## Outdated (non-vulnerable)

Not deeply inspected (Mode 2 focuses on plan dep validation). `npm outdated --json` could surface bumps but they are outside this plan's scope per the **ZERO new deps adopted** verdict (v0.4b plan ADR D1 + Coverage Matrix row 11). Sibling cleanup task TBD via `/loop 7d /deps-audit`.

## Plan validation (Mode 2)

Plan declares `## Dependencies` with explicit version pins per `cycle-plan.md` v1.1 requirement.

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `pg` | Existing | yes (`^8.11.0`) | yes (no CVE) | N/A (v0.1 inherited) | OK |
| `drizzle-orm` | Existing | yes (`^0.36.0`) | yes (no CVE) | N/A (v0.1 inherited) | OK |
| `drizzle-kit` | Existing | yes (`^0.30.0`) | MODERATE (allowlisted → LOW) | N/A (v0.1 inherited) | OK (caveat) |
| `croner` | Existing | yes (pinned at v0.4a) | yes (no CVE) | N/A (v0.4a inherited per ADR D10) | OK |
| `pgvector` extension | Existing | yes (`v0.5.1` Docker image) | N/A (Postgres extension, not npm) | N/A | OK |
| `vitest` | Existing | yes (`^2.x`) | yes (no CVE) | N/A (v0.1 inherited) | OK |
| **(NEW deps)** | — | **NONE** | **N/A** | **N/A** | OK — blueprint Q2 Rule 9 verdict REJECTED all 3 candidates (`lru-cache`, `quick-lru`, `keyv`) for wrong-abstraction-layer reasons. Plan Dependencies § "New: NONE" honors Rule 9 + KISS + ≈ 100 LoC in-house cost ≪ external lib bundle cost. |
| **(Removed deps)** | — | **NONE** | **N/A** | **N/A** | OK |

**Plan dep validation: 6/6 Existing rows confirmed; 0/0 NEW (Rule 9 negative outcome documented honestly in blueprint Q2); 0/0 Removed.**

## Hard caps check

| Stable identifier | Triggered? | Reason |
|---|---|---|
| `plan_dep_critical_cve` | NO | Zero CRITICAL findings |
| `plan_dep_high_cve` | NO | Zero HIGH findings |
| `plan_dep_medium_cve` | NO (downgraded) | 4 MODERATE findings ALL allowlisted (sunset 2026-08-23 active) → downgrade to LOW per golden rule § Allowlist mechanism |
| `plan_dep_low_cve` | YES (post-downgrade) | 4 entries now at effective LOW severity; caps verdict at PASS_WITH_CAVEATS (89) |
| `plan_dep_major_outdated_unpinned` | NO | No NEW deps; existing version pins respected via `^`/`~` ranges per plan |
| `plan_dependencies_section_missing` | NO | Plan has explicit `## Dependencies` section with Existing/New/Removed tables |
| `plan_dep_version_unspecified` | NO | All declared deps have version pins |
| `plan_new_dep_no_rule9_evaluation` | NO | NEW table explicitly states "NONE" with cross-reference to blueprint Q2 Rule 9 verdict |
| `plan_dep_not_on_registry` | NO | Every declared dep verifiable on npm registry |
| `auditor_unavailable_osv-scanner` | NO (informational) | osv-scanner not installed; npm audit + GHSA coverage acceptable for the npm-only stack |

## Recommended next steps

1. ✅ Plan dep structure is valid; advance to `/plan-confidence`.
2. ⏰ Set calendar reminder for 2026-08-23 to verify drizzle-kit `tsx` migration upstream and either renew or remove the allowlist entries.
3. (No bumps to apply now; v0.4b adopts zero new deps.)

## Verdict reasoning (post-allowlist)

- Raw npm audit findings: 4 MODERATE → would FAIL_MEDIUM (cap 70).
- All 4 covered by ACTIVE allowlist entries (sunset 2026-08-23 ≥ today 2026-05-26) → downgraded to LOW per golden rule.
- LOW severity → PASS_WITH_CAVEATS verdict (cap 89).
- Plan dep structure passes ALL 4 INVALID_PLAN_DEPS gates.

**Effective verdict: PASS_WITH_CAVEATS (cap 89).**

`/plan-confidence` may proceed; the LOW caveat propagates honestly to the score. The plan SHOULD reach SHIPPABLE_WITH_CAVEATS (89) — sufficient for `/implement` per `cycle-plan.md` Phase contracts.

## Related

- Plan: `.claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md` v1.1
- Blueprint Q2 Rule 9 verdict: `.claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md` § Coverage Corner 2
- Allowlist source: `.claude/rules/deps-audit-allowlist.txt` (v0.1 entries cover the 4 findings)
- Golden rule: `.claude/rules/deps-audit-golden-rule.md`
- Cycle: `.claude/rules/cycle-plan.md` v1.1
- Previous v0.4a audit (companion REUSED `croner` adoption): `.claude/knowledge-base/audits/` (search for v0-4a entry — to be archived per audit-trail-rotation policy)
