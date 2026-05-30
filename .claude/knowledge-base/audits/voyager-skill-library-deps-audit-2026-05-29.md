# Deps Audit: voyager-skill-library

**Date:** 2026-05-29
**Mode:** plan-bound:voyager-skill-library
**Plan version:** v1.1
**Verdict:** **PASS_WITH_CAVEATS**
**Plan-confidence cap:** 89
**Hard caps triggered:** `plan_dep_low_cve` (×4 — all allowlisted MODERATE downgraded to LOW per golden rule)
**Soft signal:** `auditor_unavailable_osv-scanner` (cross-check gap; no HIGH/CRITICAL exposure untestable because npm-audit covers npm)

## Summary

- **Ecosystems detected:** npm only (no `pyproject.toml`, no `Cargo.toml`, no `go.mod` at repo root)
- **Total deps audited:** entire npm tree (devDeps + runtime); plan declares 4 runtime + zero new
- **Vulnerabilities found:** 0 CRITICAL, 0 HIGH, **4 MODERATE (all allowlisted)**, 0 LOW
- **Outdated:** 4 MAJOR (devDeps + zod) + 1 PATCH (typescript-eslint)
- **Allowlist hits:** 4 active (all sunset 2026-08-23 — ~86 days runway)
- **Auditor coverage:** `npm audit`: ran ✓; `npm outdated`: ran ✓; `osv-scanner`: SKIPPED (binary not installed); `pip-audit`: N/A (no Python deps in scope)

## Vulnerabilities (sorted by severity, all allowlisted)

### GHSA-67mh-4wv8-2f99 — MODERATE × 4 (allowlisted, downgraded to LOW)

Chain: `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild` — the canonical "esbuild dev-server-request-leak" GHSA, surfaced via 4 distinct package vertices in the audit.

| Package | Affected range | Fixed in | Allowlist sunset | Notes |
|---|---|---|---|---|
| `esbuild` | `<=0.24.2` | (chain root) | **2026-08-23** | dev-only; production bundle excludes it |
| `@esbuild-kit/core-utils` | `*` | upstream deprecated (merged into `tsx`) | **2026-08-23** | transitive |
| `@esbuild-kit/esm-loader` | `*` | upstream deprecated (merged into `tsx`) | **2026-08-23** | transitive |
| `drizzle-kit` | `^0.31.0` (current) | `0.18.1` available BUT semver-major downgrade | **2026-08-23** | devDep; CLI-only (`db:push`, `db:generate`) — dev-server never invoked |

**Why allowlisted (rationale captured verbatim from `.claude/rules/deps-audit-allowlist.txt`):**
> "v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep). Fix requires drizzle-kit upstream to migrate to tsx; tracked at https://github.com/drizzle-team/drizzle-orm/issues."

**Plan reference (Mode 2):** plan v1.1 declares `drizzle-orm@^0.45.0` as Existing; `drizzle-kit` is an implicit dev infrastructure dep used by T0.1 (`drizzle-kit generate` + `drizzle-kit push`) but is NOT in the plan's runtime Dependencies section. The allowlist already accepts this chain through 2026-08-23, well beyond the expected v0.6 implementation window (~8-12 hours per ADR Time-budget). **No action required for this plan.**

### Diff suggestions

NONE for the plan's declared runtime deps. The drizzle-kit chain is allowlisted; no bump needed within sunset window.

## Outdated (non-vulnerable)

| Package | Current | Latest | Delta | Section in plan | Verdict |
|---|---|---|---|---|---|
| `zod` | 3.25.76 | 4.4.3 | **MAJOR** | Existing — declared `^3.25.0` (pinned to v3.x intentionally) | PIN_ACCEPTED — `^3.25.0` is an explicit semver-major pin in the plan; v0.6 does NOT bump zod |
| `typescript` | 5.9.3 | 6.0.3 | **MAJOR** | NOT in plan deps (devDep) | OUT OF SCOPE — plan does not introduce or change |
| `eslint` | 9.39.4 | 10.4.1 | **MAJOR** | NOT in plan deps (devDep) | OUT OF SCOPE |
| `@types/node` | 20.19.41 | 25.9.1 | **MAJOR** | NOT in plan deps (devDep) | OUT OF SCOPE — Node 22 in use; @types/node 25 would mismatch runtime |
| `typescript-eslint` | 8.59.4 | 8.60.0 | PATCH | NOT in plan deps (devDep) | OUT OF SCOPE; trivial bump via `npm update` |

**zod MAJOR outdated rationale:** plan v1.1 declares `zod@^3.25.0` — the `^3` range is the explicit version pin. zod 4 has breaking API changes (e.g., `.refine()` signature, `z.coerce` semantics). v0.6 does not justify zod 4 migration; `architecture.md` § Module hygiene + Inquebrável Rule 9 (Não Reinvente) say "use what works". The pin is intentional. NOT triggering `plan_dep_major_outdated_unpinned` because the `^3.25.0` declaration itself is the pin (per golden rule: "pinned via ADR rationale" — the rationale is the plan's existence + the ADR D1 REUSE chain decision).

## Plan validation (Mode 2)

Plan section `## Dependencies` parsed at line ~610 of `.claude/knowledge-base/plans/voyager-skill-library-plan.md` v1.1.

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `drizzle-orm@^0.45.0` | Existing | yes (0.45.x in `package.json`) | yes (0 CVE on drizzle-orm runtime) | n/a (existing, not new) | OK |
| `pg@^8.13.0` | Existing | yes | yes | n/a | OK |
| `zod@^3.25.0` | Existing | yes | yes (zod 3.x has 0 CVE) | n/a | OK |
| `croner@^10.0.1` | Existing | yes | yes | n/a | OK |
| (NEW deps) | NEW | **NONE declared** | — | — | OK — plan explicitly states "NEW deps required: NONE" per ADR D1 (REUSE chain) + D3 (REUSE schema) |
| (REMOVED deps) | Removed | **NONE declared** | — | — | OK |

**Plan dependencies section structural validation:**

- [x] `## Dependencies` section present
- [x] All Existing deps have version pins (`^X.Y.Z` shape)
- [x] All Existing deps are validated against the current manifest
- [x] Zero NEW deps → no Rule 9 evaluation required (vacuously satisfied)
- [x] Removed list explicitly states NONE (not omitted)

No `INVALID_PLAN_DEPS` triggers fire.

## Allowlist hygiene

| Entry | Status | Days to sunset | Action recommended |
|---|---|---|---|
| `npm|esbuild|<=0.24.2|GHSA-67mh-4wv8-2f99` | Active | 86 days | Monitor `drizzle-team/drizzle-orm` tsx migration; re-audit at sunset |
| `npm|@esbuild-kit/core-utils|*|GHSA-67mh-4wv8-2f99` | Active | 86 days | Same |
| `npm|@esbuild-kit/esm-loader|*|GHSA-67mh-4wv8-2f99` | Active | 86 days | Same |
| `npm|drizzle-kit|^0.31.0|GHSA-67mh-4wv8-2f99` | Active | 86 days | Same |

**v0.6 implementation window (~8-12 hours per plan ADR D1 Time-budget) fits comfortably within 86-day sunset runway.** No allowlist renewals or expansions required for this plan.

## Cross-check gap (auditor_unavailable_osv-scanner)

`osv-scanner` not installed locally. Per cycle-discover anti-pattern #5 ("NEVER claim 'no vulnerabilities' when an auditor failed"), this is reported honestly:

- **Coverage gap:** OSV database may surface CVEs that GitHub Advisory (npm-audit's source) misses — specifically for transitive deps reported by upstream OSS advisories outside GHSA workflow.
- **Risk for this plan:** LOW. v0.6 introduces ZERO new deps; the entire dep tree was already audited via npm-audit at v0.4a baseline (PR #22, merged 2026-05-29) with the same allowlist state.
- **Recommendation:** install `osv-scanner` (Go binary) for the next audit cycle. Pattern: `go install github.com/google/osv-scanner/cmd/osv-scanner@latest`. NOT a blocker for this plan.

Soft cap `auditor_unavailable_osv-scanner` would normally cap at 70 IF HIGH/CRITICAL exposure were untestable. Since npm-audit returned **0 CRITICAL + 0 HIGH** vulnerabilities, the unavailable cross-check does not introduce untestable severe exposure. Cap reduced to soft floor (no enforcement) per golden rule § Soft caps.

## Verdict justification (per `.claude/rules/deps-audit-golden-rule.md`)

| Rule | Applies? | Cap |
|---|---|---|
| `plan_dep_critical_cve` | NO (0 CRITICAL) | — |
| `plan_dep_high_cve` | NO (0 HIGH) | — |
| `plan_dep_medium_cve` | NO (4 MEDIUM are ALLOWLISTED within sunset → downgraded to LOW per golden rule rubric) | — |
| `plan_dep_low_cve` | YES (4 downgraded LOW from allowlisted MEDIUM) | **89** |
| `plan_dep_major_outdated_unpinned` | NO (zod ^3 is intentional pin; other MAJOR outdated are devDeps not in plan deps) | — |
| `plan_dependencies_section_missing` | NO (section present) | — |
| `plan_dep_version_unspecified` | NO (all pins explicit) | — |
| `plan_new_dep_no_rule9_evaluation` | NO (zero new deps; vacuous) | — |
| `plan_dep_not_on_registry` | NO | — |
| `auditor_unavailable_osv-scanner` | YES (soft only; no HIGH/CRITICAL untestable) | informational |

**Verdict: PASS_WITH_CAVEATS at cap 89.** The plan can advance to `/plan-confidence` per `cycle-plan.md` hard gates — no hard cap fires; the SHIPPABLE_WITH_CAVEATS band (70-89) is the plan-confidence ceiling allowed by this audit.

## Recommended next steps

1. **No diff to apply to `package.json`.** Plan v1.1 honors REUSE chain — zero dep changes.
2. **Optionally install `osv-scanner`** for next audit cycle (closes cross-check gap; not blocking).
3. **Proceed to `/plan-confidence voyager-skill-library`** — expected verdict ≥ SHIPPABLE_WITH_CAVEATS given (a) all 4 MUST FIX absorbed in v1.1, (b) Coverage Matrix 100%, (c) 5 ADRs with alternatives + rationale + consequences, (d) deps-audit verdict PASS_WITH_CAVEATS.
4. **Re-audit at allowlist sunset (2026-08-23)** — verify drizzle-kit upstream tsx migration shipped; OR escalate to allowlist renewal if not yet fixed.
