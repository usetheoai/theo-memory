# Deps Audit: voyager-skill-library-fixes-v0-6-1

**Date:** 2026-05-30
**Mode:** plan-bound:voyager-skill-library-fixes-v0-6-1
**Plan:** `.claude/knowledge-base/plans/voyager-skill-library-fixes-v0-6-1-plan.md` v1.1
**Verdict:** **PASS_WITH_CAVEATS**
**Plan-confidence cap:** 89 (worst finding: 4 MODERATE CVEs all allowlisted-active → downgrade to LOW; multiple MAJOR-outdated deps without ADR pinning)
**Hard caps triggered:** (none — no FAIL_INSECURE / no INVALID_PLAN_DEPS)
**Soft caps triggered:** `plan_dep_major_outdated_unpinned` (4 occurrences)

## Summary

- **Ecosystems detected:** npm (only — no Python/Rust/Go manifests at repo root)
- **Tools run:** `npm audit --json`, `npm outdated --json` ✓
- **Tools missing:** `osv-scanner` (not installed) → cross-check skipped; soft note (NOT capping verdict because npm audit covers GitHub Advisory dataset for this stack)
- **Total deps audited:** 1265 (direct: 21 runtime + 19 dev; transitive: ~1225 per package-lock.json)
- **Vulnerabilities found:** 0 CRITICAL · 0 HIGH · **4 MODERATE (all allowlisted-active until 2026-08-23)** · 0 LOW
- **Outdated:** 4 MAJOR · 1 MINOR (typescript-eslint 8.59 → 8.60) · 0 PATCH
- **Allowlist hits:** 4 active (none expired)
- **Auditor coverage:** `npm-audit: ran`, `npm-outdated: ran`, `osv-scanner: SKIPPED — binary not installed (out-of-scope soft-note; npm audit covers this stack)`

## Plan validation

The plan's `## Dependencies` section declares:

```
NEW deps required: NONE. The fixes are all refactors + type relaxations + new test files
that reuse existing testing infra.
REMOVED deps: NONE.
```

Plus the implicit "Existing" set inherited from v0.4a baseline + v0.6 plan:

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `drizzle-orm@^0.45.0` | Existing (inherited) | yes (manifest: `^0.45.0`) | yes (no direct CVE) | n/a (inherited) | OK |
| `pg@^8.13.0` | Existing (inherited) | yes (manifest: `^8.13.0`) | yes | n/a | OK |
| `zod@^3.25.0` | Existing (inherited) | yes (manifest: `^3.25.0`) | yes | n/a | OK |
| `croner@^10.0.1` | Existing (inherited) | yes (manifest: `^10.0.1`) | yes | n/a | OK |

**No NEW rows** → Rule 9 evaluation column is N/A. **No REMOVED rows.**

Per `deps-audit-golden-rule.md`:
- `plan_dependencies_section_missing` — NOT triggered (section present)
- `plan_dep_version_unspecified` — NOT triggered (every dep is exact-pinned with `^`)
- `plan_new_dep_no_rule9_evaluation` — NOT triggered (no NEW deps)
- `plan_dep_not_on_registry` — NOT triggered

**Plan deps verdict:** clean.

## Vulnerabilities (sorted by severity)

### 1. GHSA-67mh-4wv8-2f99 — MODERATE → LOW (allowlist-downgrade) — `esbuild <=0.24.2`

- **Title:** esbuild enables any website to send any requests to the dev server and read the response
- **Path (transitive):** root → `drizzle-kit` (devDep) → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`
- **Fixed in:** drizzle-kit ^0.31+ migrates away from `@esbuild-kit` chain (upstream tracking issue); short-term fix is `drizzle-kit@0.18.1` (SemVer-MAJOR downgrade — rejected at the v0.1 dep audit)
- **Allowlist:** ACTIVE — entry at `.claude/rules/deps-audit-allowlist.txt:36` with sunset **2026-08-23** (today + 85 days). Rationale: dev-only; `drizzle-kit` CLI is invoked for `db:push` / `db:generate`; no esbuild dev-server is ever spun up; production bundle excludes drizzle-kit entirely.
- **Diff suggestion:** none — fix requires upstream `drizzle-kit` to migrate to `tsx` (long-running upstream effort)

### 2. GHSA-67mh-4wv8-2f99 — MODERATE → LOW — `@esbuild-kit/core-utils`

- Same root cause as #1 — same allowlist entry covers it
- Allowlist line: `npm|@esbuild-kit/core-utils|*|GHSA-67mh-4wv8-2f99|...|2026-08-23`

### 3. GHSA-67mh-4wv8-2f99 — MODERATE → LOW — `@esbuild-kit/esm-loader`

- Same root cause as #1
- Allowlist line: `npm|@esbuild-kit/esm-loader|*|GHSA-67mh-4wv8-2f99|...|2026-08-23`

### 4. GHSA-67mh-4wv8-2f99 — MODERATE → LOW — `drizzle-kit@^0.31.0`

- Surface manifestation of the same root cause (drizzle-kit's transitive `@esbuild-kit` chain)
- Allowlist line: `npm|drizzle-kit|^0.31.0|GHSA-67mh-4wv8-2f99|...|2026-08-23`

**All 4 entries share the same upstream cause + the same allowlist line family + the same sunset date (2026-08-23). After allowlist downgrade: 4 LOW findings → `plan_dep_low_cve` cap 89.**

## Outdated (non-vulnerable)

### npm: `zod` 3.25.76 → 4.4.3 (MAJOR)

- **Changelog:** https://github.com/colinhacks/zod/releases (v4 breaking changes: improved error messages, new `coerce` API behavior, deprecated patterns removed)
- **Diff suggestion:** OMITTED for MAJOR — review breaking changes first; zod is the schema validation surface across `src/agent-tools/` + `src/core/extraction/`
- **Soft cap:** `plan_dep_major_outdated_unpinned` (no ADR pins zod to v3 explicitly in this plan)

### npm: `eslint` 9.39.4 → 10.4.1 (MAJOR)

- **Changelog:** https://eslint.org/blog/category/release-notes/
- **Diff suggestion:** OMITTED — eslint 10 requires Node 20.18+ (we run 22; OK on Node side) + plugin compatibility checks (typescript-eslint, etc.)
- **Soft cap:** `plan_dep_major_outdated_unpinned`

### npm: `typescript` 5.9.3 → 6.0.3 (MAJOR)

- **Changelog:** https://devblogs.microsoft.com/typescript/
- **Diff suggestion:** OMITTED — TS 6 may surface new strictness errors; this fixes plan already relaxes types in T0.2; coordinate TS 6 upgrade as a separate cycle
- **Soft cap:** `plan_dep_major_outdated_unpinned`

### npm: `@types/node` 20.19.41 → 25.9.1 (MAJOR)

- **Changelog:** github.com/DefinitelyTyped/DefinitelyTyped
- **Diff suggestion:** wait for @types/node to reach the LTS Node version we target (Node 22 is LTS); 25 tracks edge releases. Per `package.json#engines.node`: `>=22` — sticking with `@types/node` matching the same major is fine.
- **Soft cap:** `plan_dep_major_outdated_unpinned`

### npm: `typescript-eslint` 8.59.4 → 8.60.0 (MINOR)

- Minor bump; safe to upgrade in a separate `chore(deps)` commit
- **Diff suggestion:**
  ```diff
  -    "typescript-eslint": "^8.59.0"
  +    "typescript-eslint": "^8.60.0"
  ```
- Does NOT trigger `plan_dep_major_outdated_unpinned` (MINOR only)

## Recommended next steps

1. **No diff suggestions to apply for the v0.6.1 fixes plan.** The plan does not introduce new deps; no manifest edits needed.
2. **Proceed to `/plan-confidence voyager-skill-library-fixes-v0-6-1`.** The cap is 89 (PASS_WITH_CAVEATS) — verdict band SHIPPABLE_WITH_CAVEATS is achievable.
3. **Out-of-scope follow-ups** (separate cycle):
   - Watch for `drizzle-kit` upstream migration to `tsx` (closes the GHSA-67mh-4wv8-2f99 chain at the source); re-audit at the 2026-08-23 sunset.
   - Plan a `chore(deps)` cycle for zod 3 → 4 + eslint 9 → 10 + typescript 5 → 6 MAJOR bumps. These touch the wider codebase; out of scope for this fixes plan.
4. **Install `osv-scanner` locally** (`go install github.com/google/osv-scanner/cmd/osv-scanner@latest`) for cross-ecosystem coverage in future audits. Not blocking today — npm audit covers GitHub Advisory for this stack.

## Allowlist status

All 4 active entries protect against the same upstream issue (GHSA-67mh-4wv8-2f99) with consistent sunset 2026-08-23. No expired entries (would re-fire at full severity). Recheck at sunset.

```
npm|esbuild|<=0.24.2|GHSA-67mh-4wv8-2f99|...|2026-08-23                          ACTIVE
npm|@esbuild-kit/core-utils|*|GHSA-67mh-4wv8-2f99|...|2026-08-23                 ACTIVE
npm|@esbuild-kit/esm-loader|*|GHSA-67mh-4wv8-2f99|...|2026-08-23                 ACTIVE
npm|drizzle-kit|^0.31.0|GHSA-67mh-4wv8-2f99|...|2026-08-23                       ACTIVE
```
