# Deps Audit: discover-web-v0-1

**Date:** 2026-05-25
**Mode:** plan-bound:discover-web-v0-1
**Plan version analyzed:** v1.1 (post edge-case absorption)
**Verdict:** **PASS**
**Hard caps triggered:** [] (empty)
**Soft caps triggered:** [] (empty — see "Auditor coverage gap" below for informational note)

## Summary

- **Ecosystems detected:** npm (1) — no Python/Rust/Go manifests at project root
- **Plan-declared deps:** 5 Existing, 0 NEW, 0 Removed
- **Plan-declared npm/Python packages requiring CVE check:** 0
- **Vulnerabilities found in project surface:** 0 CRITICAL, 0 HIGH, 4 MODERATE, 0 LOW
- **Allowlist hits:** 4 active (downgrade MODERATE → LOW), 0 expired
- **Outdated:** 3 MAJOR (`@types/node`, `eslint`, `typescript`), several MINOR/PATCH — all dev-deps unrelated to this plan
- **Auditor coverage:** `npm audit` ran (PASS); `npm outdated` ran (informational); `pip-audit` AVAILABLE but no Python manifest at project root scope; `osv-scanner` NOT INSTALLED (informational note below)

## Plan validation (Mode 2)

The plan's `## Dependencies` section declares only files, built-in tools, and system tools — **no npm/Python packages are introduced or modified by this plan**. Cross-reference per `deps-audit-golden-rule.md § Severity rubric`:

| Plan dep | Section | Type | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|
| `.claude/rules/discover-web-allowlist.txt` | Existing | file | yes — git-tracked, 18 entries verified | n/a (not a CVE-able artifact) | n/a (not a NEW dep) | OK |
| `.claude/knowledge-base/discoveries/snapshots/` | Existing | directory | yes — git-tracked, 4 v0-3 files | n/a | n/a | OK |
| `WebSearch` (built-in) | Existing | runtime tool | yes — Claude Code deferred tool, loaded via `ToolSearch select:WebSearch` | n/a | n/a | OK |
| `WebFetch` (built-in) | Existing | runtime tool | yes — Claude Code deferred tool, loaded via `ToolSearch select:WebFetch` | n/a | n/a | OK |
| `pytest` | Existing | python (system) | yes — assumed system Python + pytest available; sibling skills (`plan-confidence`, `code-quality`) use it via their own pyproject.toml; this plan invokes via `pytest .claude/skills/discover-confidence/tests` | n/a (system pytest, no version pin in plan) | n/a (not a NEW package introduction) | OK with note* |

\* **Note on pytest:** the plan declares pytest as "Existing" without version. This is consistent with how pytest is consumed across the discover-* skill tests today — there's no `.claude/skills/discover-confidence/pyproject.toml` declaring it (unlike sibling `plan-confidence/pyproject.toml` which pins `PyYAML>=6.0`). The plan honestly reflects current convention. If a future plan introduces pytest as a managed dep (in a new `discover-confidence/pyproject.toml`), it would need to declare a version pin then. For THIS plan, pytest is system-level and not capped.

**Plan deps verdict: clean.** No `plan_dependencies_section_missing`, no `plan_dep_version_unspecified` (5 Existing rows + 0 NEW = no missing version on NEW), no `plan_new_dep_no_rule9_evaluation`, no `plan_dep_not_on_registry`.

## Vulnerabilities (project surface, NOT introduced by this plan)

All 4 MODERATE findings are TRANSITIVE through `drizzle-kit` (v0.1 dev-only dep) AND are ALLOWLISTED-ACTIVE through 2026-08-23. Per `deps-audit-golden-rule.md § Allowlist mechanism`: allowlisted findings downgrade by ONE severity level → effective severity LOW. Per golden rule severity rubric, LOW CVE in DECLARED dep caps at 89 — but these are NOT declared in this plan's `## Dependencies` section (they're inherited from v0.1 + v0.3 surface), so no cap fires on `discover-web-v0-1`.

### GHSA-67mh-4wv8-2f99 — MODERATE (npm: esbuild ≤ 0.24.2)

- **Affected:** `esbuild` ≤ 0.24.2, `@esbuild-kit/core-utils` *, `@esbuild-kit/esm-loader` *, `drizzle-kit` ^0.31.0
- **Path:** all transitive through `drizzle-kit` (devDep)
- **Allowlist status:** ALLOWLISTED-ACTIVE (4 entries, all sunset 2026-08-23)
- **Allowlist rationale (verbatim):** "MODERATE dev-server-request-leak chained from drizzle-kit ^0.31.0's deprecated @esbuild-kit/esm-loader (merged into tsx upstream). v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep). Fix requires drizzle-kit upstream to migrate to tsx; tracked at https://github.com/drizzle-team/drizzle-orm/issues. Plan v1.3 ADR D1.10 documents the bump rationale; re-audit at sunset to verify upstream fix or escalate."
- **Fix available:** drizzle-kit 0.18.1 (SemVer major DOWNgrade — would lose v0.1 features; unsuitable)
- **Effective severity after allowlist:** LOW
- **Cap on this plan:** NONE — these deps are not declared in `discover-web-v0-1`'s Dependencies section; they're surface inherited from v0.1.
- **Action recommended:** Continue monitoring upstream drizzle-kit migration to tsx; re-audit when allowlist sunset arrives (2026-08-23). NO action required for this plan.

## Outdated (informational, NOT capping)

The following MAJOR-outdated deps exist in `package.json` but are NOT declared by this plan and therefore do NOT trigger `plan_dep_major_outdated_unpinned`:

| Package | Current | Latest | Delta | Type | Why not cap |
|---|---|---|---|---|---|
| `@types/node` | 20.19.41 | 25.9.1 | MAJOR (×5) | devDep | Pinned at ^20.0.0 in package.json; Node 20 is LTS through 2026-04-30 per nodejs.org schedule. Bump to 22+ planned at next runtime upgrade. |
| `eslint` | 9.39.4 | 10.4.0 | MAJOR (×1) | devDep | eslint 10 was released 2026-04; awaiting `typescript-eslint` 9.x compat. |
| `typescript` | 5.9.3 | 6.0.3 | MAJOR (×1) | devDep | TS 6.0 released 2026-05; awaiting ecosystem stabilization + breaking-change review. |

None of these are mentioned in `discover-web-v0-1`'s `## Dependencies`. Per `deps-audit-golden-rule.md`, `plan_dep_major_outdated_unpinned` applies only to "declared dep" — these are not declared by this plan, so no cap.

**Note for cycle hygiene:** these MAJOR-outdated items SHOULD be addressed in a separate plan (e.g., `infra-deps-bump-v0-1`) before they expand the attack surface. Not a blocker for `discover-web-v0-1` proceeding.

## Auditor coverage gap (informational)

- `npm audit` (GitHub Advisory DB): **ran** — clean for plan scope
- `npm outdated`: **ran** — informational only
- `osv-scanner` (cross-ecosystem OSV DB): **NOT INSTALLED**
- `pip-audit`: **available** but no Python manifest at project root scope (sibling skills have their own pyproject.toml that would be audited separately; this plan touches `discover-confidence/scripts/*.py` but no Python deps file in that skill)

Per `deps-audit-golden-rule.md` rubric: `auditor_unavailable_{name}` caps at 70 ONLY IF "HIGH/CRIT untestable". Since we have:
- 0 HIGH/CRITICAL findings via `npm audit` on the project surface
- 0 NEW deps in this plan to evaluate
- `npm audit` covers npm via GitHub Advisory which is more comprehensive than OSV for npm specifically (per Anti-pattern #6 in golden rule)

→ The osv-scanner gap is **informational, not capping**. No `auditor_unavailable_osv-scanner` triggered.

**Recommended for project hygiene (not for this plan):** install osv-scanner (`brew install osv-scanner` OR `go install github.com/google/osv-scanner/cmd/osv-scanner@latest`) so future audits get cross-ecosystem coverage. Tracked as a project-level followup.

## Recommended next steps

1. **No action required for this plan.** Proceed to `/plan-confidence discover-web-v0-1`.
2. **Independent project followup** (NOT blocking): plan + execute a `npm-deps-bump-v0-1` to address the 3 MAJOR-outdated devDeps (Node 22 LTS, eslint 10, TS 6) before they grow stale. This is unrelated to discover-web.
3. **Independent project followup** (NOT blocking): install `osv-scanner` in the dev/CI environment for cross-ecosystem coverage in future audits.
4. **Monitor allowlist sunset** (2026-08-23) for the 4 esbuild/drizzle-kit entries — if drizzle-kit hasn't migrated to tsx by then, decision required (extend OR escalate).

## Verdict rationale

| Check | Result | Notes |
|---|---|---|
| Plan `## Dependencies` section present? | YES | 5 Existing, 0 NEW, 0 Removed |
| All declared deps have version (where applicable)? | N/A | All declared deps are files/built-in tools/system; version pin not applicable |
| All NEW deps have Rule 9 evaluation? | N/A | 0 NEW deps |
| Any declared dep affected by unallowlisted CRITICAL/HIGH CVE? | NO | Plan deps are not npm packages; project npm surface has 0 CRITICAL/HIGH unallowlisted |
| Auditors ran without HIGH/CRIT untestable gap? | YES | npm audit covered the npm surface; no untestable HIGH/CRIT |

**Final verdict: PASS.** No caps fire. Plan can proceed to `/plan-confidence discover-web-v0-1` without deps-related re-work.
