# Deps Audit: themory-category-filter-server-side

**Date:** 2026-06-09
**Mode:** plan-bound:themory-category-filter-server-side
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** none — `plan_dependencies_section_missing` was triggered against v1.0 of the plan; absorbed at v1.1 via the new `## Dependencies` section declaring zero new deps. Re-audit at v1.1 = clean.

## Summary

- **Ecosystems detected:** npm (theo-memory repo cwd)
- **Total deps audited:** 1289 production + 1100 dev = 2389 (per `npm audit --json` metadata)
- **Vulnerabilities found (raw):** 1 CRITICAL, 3 HIGH, 4 MODERATE, 0 LOW (= 8 total)
- **Vulnerabilities AFTER allowlist downgrade:** effective severity MEDIUM at most (all 8 are allowlisted-active within sunset)
- **Outdated direct deps:** 12 (mix of MINOR and MAJOR; none on the plan's deps list)
- **Allowlist hits:** 13 active entries (matches all 8 unique CVEs, with multiple package-prefix entries per CVE chain)
- **Auditor coverage:** `npm audit`: ran; `npm outdated`: ran; `osv-scanner`: NOT AVAILABLE (binary not installed; npm audit alone is the authoritative npm tool); `pip-audit`/`cargo audit`/`govulncheck`: N/A (no Python/Rust/Go manifest in theo-memory)

## Vulnerabilities (sorted by raw severity)

### CRITICAL — `protobufjs` < 7.5.7 (GHSA-xq3m-2v4x-88gg)

- **Title:** Arbitrary code execution via generated `toObject` code (CWE-94)
- **Path:** root → `@xenova/transformers ^2.17.0` → `onnxruntime-web@1.14.0` → `onnx-proto` → `protobufjs`
- **Fixed in:** `protobufjs ≥ 7.5.8` (requires Xenova v3 upstream; tracked task #87)
- **Allowlist status:** **ALLOWLISTED-ACTIVE** until 2026-07-01 (sunset 22 days from now). Effective severity post-downgrade: **MEDIUM**.
- **Plan reference:** Plan does NOT declare or touch `@xenova/transformers` or `protobufjs`. Not introduced by this plan.
- **Diff suggestion:** OMITTED — fix requires Xenova v3 upstream release, not a direct bump in this repo.

### HIGH — `protobufjs` (GHSA-66ff-xgx4-vchm, GHSA-75px-5xx7-5xc7, GHSA-jvwf-75h9-cwgg, GHSA-685m-2w69-288q)

- 4 distinct HIGH advisories on the same `protobufjs ≤ 7.5.7` chain (code injection through `bytes` field defaults; prototype-pollution gadget; process-wide DoS via unsafe option paths; unbounded recursion DoS).
- **Allowlist status:** all **ALLOWLISTED-ACTIVE** until 2026-08-01 (53 days from now). Effective severity post-downgrade: **LOW**.
- **Plan reference:** Same chain as the CRITICAL; not touched by this plan.

### HIGH — `@xenova/transformers ^2.17.0` (GHSA-xq3m-2v4x-88gg surface)

- Surface manifestation of the protobufjs chain.
- **Allowlist status:** ALLOWLISTED-ACTIVE until 2026-07-01. Effective: LOW.

### HIGH — `onnxruntime-web ≤ 1.16.0-dev.20230910` (GHSA-xq3m-2v4x-88gg surface) + `onnx-proto`

- Same chain surface.
- **Allowlist status:** ALLOWLISTED-ACTIVE until 2026-07-01. Effective: LOW.

### MODERATE — `esbuild ≤ 0.24.2` (GHSA-67mh-4wv8-2f99)

- Dev-server-request-leak chained from `drizzle-kit ^0.31.0`'s deprecated `@esbuild-kit/esm-loader`.
- **Allowlist status:** ALLOWLISTED-ACTIVE until 2026-08-23. Effective: still MEDIUM (one-step downgrade from MODERATE bottoms out).
- **Plan reference:** Plan USES `drizzle-kit` (devDep) for migration generation. Risk envelope per allowlist entry: CLI-only usage; dev-server never invoked. Not aggravated by this plan.

### MODERATE — `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`, `next` postcss chain

- 4 MODERATE entries that are surface manifestations of the esbuild + postcss chains above. All ALLOWLISTED.

## Outdated (non-vulnerable)

12 direct deps are at least PATCH behind upstream. Examples:

- `@hono/node-server@1.19.14` → latest `2.0.4` (MAJOR)
- `commander@12.1.0` → latest `14.0.3` (MAJOR)
- `openai@4.104.0` → latest `6.42.0` (MAJOR)
- `typescript@5.9.3` → latest `6.0.3` (MAJOR)
- `hono@4.12.23` → latest `4.12.25` (PATCH)
- `typescript-eslint@8.59.4` → latest `8.61.0` (MINOR)

**Plan-relevance check:** Plan uses `zod`, `hono`, `drizzle-orm`, `drizzle-kit`, `pg`. Of these, `hono` is 2 PATCH behind (acceptable) and the rest are within `wanted` range. No MAJOR outdated dep is load-bearing for this plan.

**Diff suggestions:** OMITTED for MAJOR bumps — review breaking changes first; tracked outside this audit.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `drizzle-orm` | Existing | yes (`^0.36`) | yes (no direct CVE) | n/a (existing) | OK |
| `drizzle-kit` | Existing (devDep) | yes (`^0.31.0`) | MODERATE allowlisted (esbuild chain, sunset 2026-08-23, downgraded → effective MEDIUM) | n/a | OK_WITH_CAVEAT |
| `pg` | Existing | yes (`^8.x`) | yes | n/a | OK |
| `zod` | Existing | yes (`^3.x`) | yes | n/a | OK |
| `hono` | Existing | yes (`^4.x`) | yes; 2 patches behind upstream | n/a | OK |
| `ankane/pgvector:v0.5.1` (Docker) | Existing infra | yes | yes | n/a | OK |
| (none) | NEW | — | — | n/a (no NEW deps) | OK |

## Verdict rationale

- **No `plan_dep_critical_cve` / `plan_dep_high_cve` fires** — plan declares zero new deps and does not touch the vulnerable chain (`@xenova/transformers` → `protobufjs`). The CRITICAL + HIGH findings are PRE-EXISTING from prior cycles and are properly tracked in `deps-audit-allowlist.txt` with documented sunsets ≤ 90 days + risk-envelope justifications.
- **No `plan_new_dep_no_rule9_evaluation` fires** — plan has ZERO new deps; Rule 9 is satisfied trivially.
- **No `plan_dep_version_unspecified` fires** — every existing dep in the plan's section has a declared version range.
- **No `plan_dep_not_on_registry` fires** — all listed deps exist on npm.
- **`plan_dependencies_section_missing`** WAS missing at plan v1.0 — absorbed at v1.1 via new `## Dependencies` section. No longer triggering.
- **Caveat (PASS_WITH_CAVEATS not PASS):** `drizzle-kit ^0.31.0` (used by this plan for migration generation) is the surface dep on an esbuild MODERATE chain. Allowlisted with sunset 2026-08-23. Effective severity post-allowlist downgrade is still MEDIUM (MODERATE one-step downgrade bottoms out at MEDIUM, not LOW). This is the soft cap that prevents an unqualified PASS.

## Recommended next steps

1. **Do NOT apply any dep bump to land this plan** — zero new deps; existing deps unchanged.
2. Proceed to `/plan-confidence` per cycle-plan SoT.
3. Continue tracking task #87 (`deps-upgrade-xenova-transformers-v2-protobufjs-cve`) as a SEPARATE cycle; its closure removes the CRITICAL+HIGH chain and re-classifies this plan from `PASS_WITH_CAVEATS` to plain `PASS` on future audits.
4. At sunset 2026-07-01 (Xenova chain) and 2026-08-23 (esbuild chain): re-audit; if upstream still unfixed, the allowlist entries MUST be extended via PR with refreshed risk-envelope analysis OR the CVEs re-fire at full severity.

## Cross-references

- Plan: `.claude/knowledge-base/plans/themory-category-filter-server-side-plan.md` v1.1
- Edge-case review: `.claude/knowledge-base/reviews/themory-category-filter-server-side-edge-cases-2026-06-09.md`
- Allowlist: `.claude/rules/deps-audit-allowlist.txt`
- Golden rule: `.claude/rules/deps-audit-golden-rule.md`
- Related task: #87 (deps-upgrade-xenova-transformers-v2-protobufjs-cve)
