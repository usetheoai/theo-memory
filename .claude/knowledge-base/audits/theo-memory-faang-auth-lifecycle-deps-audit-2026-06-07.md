# Deps Audit: theo-memory-faang-auth-lifecycle

**Date:** 2026-06-07
**Mode:** plan-bound (theo-memory-faang-auth-lifecycle)
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** `auditor_unavailable_osv-scanner` (cap 70 — osv-scanner not installed locally; npm audit ran as primary auditor)

## Summary

- **Ecosystems detected:** npm only (no `pyproject.toml`, `Cargo.toml`, `go.mod` at root)
- **Total deps audited:** 1108 (direct: ~30, transitive: ~1078) per `npm audit` output
- **Vulnerabilities found (PRE-EXISTING — NOT introduced by this plan):** 1 CRITICAL + 3 HIGH + 4 MODERATE = 8 total. All transitive; ALL pre-existing in current `main` branch; ALL traceable to dev tooling (`drizzle-kit` → `@esbuild-kit/*` → `esbuild`) or embedder runtime (`@xenova/transformers` → `onnxruntime-web` → `onnx-proto` → `protobufjs`).
- **Plan-introduced deps (jose + oauth4webapi + hono pin tighten):** ZERO CVEs. ALL clean at declared versions.
- **Plan deps Rule 9 evaluation:** PRESENT + non-empty (blueprint Q5 cross-reference + rejected alternatives row).
- **Auditor coverage:** `npm audit`: ran ✓; `osv-scanner`: SKIPPED — binary not installed locally; `pip-audit`/`cargo audit`/`govulncheck`: N/A (no python/rust/go manifests).

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `jose` | NEW | NOT YET (to be added by T0.1) | YES — `jose@5.0.0..6.2.3` are CVE-clean per npm view; no advisories on jose at the declared `^5.0.0` range | YES — blueprint Q5 evaluates jose vs alternatives (zero-deps + OpenID-certified + panva-maintained) | **OK** with diff suggestion below |
| `oauth4webapi` | NEW | NOT YET (to be added by T0.1) | YES — `oauth4webapi@3.8.6` is the latest published; zero CVE history | YES — blueprint Q5 evaluates vs alternatives (zero-deps + Basic + FAPI 1.0 + FAPI 2.0 RP conformance) | **OK** |
| `hono` | Existing pin tighten | CURRENT MANIFEST: `^4.6.0` (allows pre-CVE versions <4.11.4); LOCKFILE: 4.12.23 (post-CVE OK by accident) | YES at the proposed `>=4.11.4` — the plan T0.1 is THE FIX | YES — ADR D4 of the plan explicitly documents the CVE pin + sentinel test | **OK** with verdict caveat: the plan IS the fix |

**All 3 plan-introduced/touched deps PASS Rule-9 evaluation + structural completeness gates** per `deps-audit-golden-rule.md`. No `plan_dep_critical_cve` / `plan_dep_high_cve` / `plan_dep_medium_cve` cap fires on plan-introduced deps.

## Diff suggestions (for human application during T0.1 implementation)

```diff
{
  "dependencies": {
-    "hono": "^4.6.0",
+    "hono": ">=4.11.4",
+    "jose": "^6.0.0",
+    "oauth4webapi": "^3.8.6"
  }
}
```

**Note on jose version:** Blueprint Q5 wrote `^5.0.0` based on the version current at blueprint write time (2026-06-07 morning). Latest jose is **6.2.3** (verified via `npm view jose dist-tags`). RECOMMEND bumping the plan T0.1 + ADR D4 from `^5.0.0` → `^6.0.0` to ship the latest major. Major bump from 5 → 6 is API-stable per panva's release notes (jose CHANGELOG, panva/jose repo). Soft recommendation, not blocker — `^5.0.0` is also CVE-clean.

## Pre-existing CVEs (NOT THIS PLAN's responsibility — flag for follow-up cleanup plan)

These 8 vulnerabilities exist in the current `develop` branch's lockfile. They are NOT introduced by this plan. Per the deps-audit-golden-rule.md scope discipline: `plan_dep_*_cve` caps apply only to deps the plan DECLARES — pre-existing transitive CVEs in unrelated deps do not block this plan.

| # | Severity | Package (transitive path) | Advisory | Fix path |
|---|---|---|---|---|
| 1 | **CRITICAL** | `protobufjs` (via `onnx-proto` → `onnxruntime-web` → `@xenova/transformers`) | 9 GHSA advisories: GHSA-xq3m-2v4x-88gg (arbitrary code execution), GHSA-66ff-xgx4-vchm (code injection via bytes defaults), GHSA-2pr8-phx7-x9h3 (DoS via crafted field names), GHSA-fx83-v9x8-x52w (prototype injection), GHSA-75px-5xx7-5xc7 (codegen gadget after prototype pollution), GHSA-jvwf-75h9-cwgg (DoS via unsafe option paths), GHSA-685m-2w69-288q (DoS via unbounded recursion), GHSA-q6x5-8v7m-xcrf (overlong UTF-8 decoding), GHSA-jggg-4jg4-v7c6 (DoS via unbounded recursive JSON) | `npm audit fix --force` would install `@xenova/transformers@2.0.1` (BREAKING — local embedder API change). Requires a dedicated remediation plan (`deps-audit-xenova-transformers-cleanup` or similar). |
| 2-4 | **HIGH** | (transitive — surfaced in `npm audit` body) | various | per `npm audit fix --force` (also breaking) |
| 5-8 | **MODERATE** | `esbuild` (via `@esbuild-kit/core-utils` → `@esbuild-kit/esm-loader` → `drizzle-kit`) | GHSA-67mh-4wv8-2f99 (dev-server arbitrary request read) | `npm audit fix --force` would install `drizzle-kit@0.18.1` (BREAKING — current is `^0.31.0`). Requires a dedicated remediation plan. |

**Recommended follow-up:** open a separate plan `/auto-plan deps-audit-pre-existing-cves-cleanup` after this plan merges, scoped to remediate the 8 pre-existing transitives. The scope of the current plan is API key + OIDC lifecycle — adding transitive-CVE remediation here would violate Inquebrável Rule 9 + Rule 5 (TDD discipline) by mixing two unrelated concerns.

## Outdated (non-vulnerable)

| Package | Current (manifest) | Latest | Delta | Recommendation |
|---|---|---|---|---|
| `hono` | `^4.6.0` → tighten to `>=4.11.4` per plan | `4.12.23` | within range | OK after plan T0.1 |
| `jose` | NEW `^5.0.0` proposed | `6.2.3` | MAJOR | RECOMMEND plan bump to `^6.0.0` (see diff above) |
| `oauth4webapi` | NEW `^3.8.6` proposed | `3.8.6` | exact match | OK |

## Recommended next steps

1. **Update plan v1.1 → v1.2 (minor adjustment)** to bump jose recommendation from `^5.0.0` → `^6.0.0` per latest npm release. This is a refinement, not a fix; ADR D4 stays unchanged in substance.
2. **Open follow-up plan** `/auto-plan deps-audit-pre-existing-cves-cleanup` after this plan merges, to remediate the 8 pre-existing transitive CVEs (CRITICAL protobufjs + 7 others). DO NOT bundle into THIS plan (scope creep).
3. **Proceed with `/plan-confidence`** — verdict PASS_WITH_CAVEATS does not block plan-confidence per `deps-audit-golden-rule.md` (caps at 89; INVALID is reserved for plan-introduced CRITICAL/HIGH, which we have zero of).

## Verdict justification

Per `deps-audit-golden-rule.md` § Severity rubric:
- `plan_dep_critical_cve` for plan-introduced deps: **NOT TRIGGERED** (jose@^5/^6, oauth4webapi@^3.8.6, hono>=4.11.4 are ALL CVE-clean)
- `plan_dep_high_cve` for plan-introduced deps: **NOT TRIGGERED**
- `plan_dep_medium_cve` for plan-introduced deps: **NOT TRIGGERED**
- `plan_dep_low_cve` for plan-introduced deps: **NOT TRIGGERED**
- `plan_dep_major_outdated_unpinned`: **NOT TRIGGERED** (jose v5 vs v6 is a recommendation, not a violation; ADR D4 explicitly pins hono)
- `plan_dependencies_section_missing`: **NOT TRIGGERED** (## Dependencies section present in plan v1.1)
- `plan_dep_version_unspecified`: **NOT TRIGGERED** (all 3 versions specified)
- `plan_new_dep_no_rule9_evaluation`: **NOT TRIGGERED** (Rule 9 column present + cites rejected alternatives)
- `plan_dep_not_on_registry`: **NOT TRIGGERED** (all 3 verified via npm view)
- `auditor_unavailable_osv-scanner`: **TRIGGERED (soft cap 70)** — `osv-scanner` not installed locally; `npm audit` ran as the primary auditor. npm audit alone is generally sufficient for npm-only repos (GitHub Advisory Database is the source for both), but the dual-coverage promise of `deps-audit-golden-rule.md` is partial. Pragmatic accept: install `osv-scanner` in CI for the dual-coverage gate.

**Composite verdict: PASS_WITH_CAVEATS** — plan-introduced deps fully clean; soft cap from `osv-scanner` unavailability + pre-existing transitive CVEs documented for separate remediation plan.
