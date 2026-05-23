# Deps Audit: v0-2-theokit-binding

**Date:** 2026-05-23
**Mode:** plan-bound:v0-2-theokit-binding
**Plan version:** v1.1 (with late-addition `## Dependencies` section per cycle-plan.md v1.1)
**Verdict:** **PASS_WITH_CAVEATS** (score cap 89)
**Hard caps triggered:** [] (zero hard caps — all CVE findings allowlisted with active sunset)
**Soft caps surfaced:** `plan_dep_major_outdated_unpinned` (zod 3 → 4)

## Summary

- Ecosystems detected: npm (only — no `pyproject.toml`, `Cargo.toml`, `go.mod`)
- Total deps audited: 3 runtime + 12 devDeps (+ ~290 transitive resolved via `package-lock.json`)
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, **4 MODERATE** (all allowlisted), 0 LOW
- Outdated: 4 MAJOR (3 devDeps + **1 runtime (zod)**), 0 MINOR, 0 PATCH (npm outdated output)
- Allowlist hits: **4 active** (all 4 MODERATE CVEs downgraded to LOW per allowlist), 0 expired
- Auditor coverage:
  - `npm audit`: **ran** ✓
  - `npm outdated`: **ran** ✓
  - `pip-audit`: SKIPPED — no `pyproject.toml`/`requirements.txt` in repo (graceful)
  - `cargo audit`: SKIPPED — no `Cargo.toml`
  - `govulncheck`: SKIPPED — no `go.mod`
  - `osv-scanner`: **NOT INSTALLED** — cross-check unavailable; downgrade signal documented but does NOT cap verdict because per-ecosystem auditor (`npm audit`) ran successfully

## Vulnerabilities (sorted by severity)

### GHSA-67mh-4wv8-2f99 — MODERATE → LOW (after allowlist downgrade)

Multiple manifestations of the same root advisory in the dev-only esbuild chain transitively pulled by `drizzle-kit ^0.31.0`:

| Package | Severity | Allowlist | Path (transitive) |
|---|---|---|---|
| esbuild | MODERATE → LOW | active (sunset 2026-08-23) | `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild` |
| @esbuild-kit/core-utils | MODERATE → LOW | active (sunset 2026-08-23) | same |
| @esbuild-kit/esm-loader | MODERATE → LOW | active (sunset 2026-08-23) | same |
| drizzle-kit | MODERATE → LOW | active (sunset 2026-08-23) | direct (devDep) |

**Fix path npm suggests:** `drizzle-kit @ 0.18.1` — REJECTED (semver-major downgrade is not a fix; would lose ORM features we depend on). The upstream fix requires `drizzle-kit` to migrate from deprecated `@esbuild-kit/esm-loader` to `tsx`. Tracked upstream at the drizzle-team/drizzle-orm repo.

**Why we accept the cap:** documented in `.claude/rules/deps-audit-allowlist.txt` — drizzle-kit usage is CLI-only (`db:push` / `db:generate` / `db:studio`); the vulnerable dev-server is never invoked. Production bundle (whatever ships under `files` in `package.json`) does NOT include `drizzle-kit` or `esbuild` (devDep). Sunset 2026-08-23 (3 months from now) forces re-audit before silent acceptance.

**No new fix-required entries**: this is the same set of 4 findings the v0.1 cycle allowlisted. v0.2 introduces ZERO new deps that affect this surface.

## Outdated (non-vulnerable)

### npm: zod@^3.24.0 → 4.4.3 (MAJOR) — RUNTIME DEP

- **Current**: 3.25.76 (installed) / `^3.24.0` (declared)
- **Latest**: 4.4.3
- **Plan reference**: v0-2 plan declares `zod ^3.24.0` under `Existing — use as-is`. T4.2's demo route uses zod for body schema.
- **Soft cap**: `plan_dep_major_outdated_unpinned` (cap 89)
- **Why not bump in v0.2**: zod 3 → 4 is a breaking change requiring migration across all schema declarations in `src/local/`, `src/core/`, and test fixtures. Out of scope for v0.2 (TheoKit binding). v0.2 inherits the same zod-3 stance from v0.1.
- **Recommendation**: open a separate `/to-plan` for `zod-4-migration` as its own cycle. Diff suggestion: **OMITTED for MAJOR** — review breaking changes first.

### npm: typescript@^5.4.0 → 6.0.3 (MAJOR) — devDep

- **Current**: 5.9.3 / `^5.4.0`. **Latest**: 6.0.3.
- TS 6 is fresh; ecosystem tools (eslint plugins, vitest type-checker) may not have caught up. devDep only — does NOT cap verdict for runtime safety.
- **Recommendation**: defer until next devDep refresh cycle.

### npm: eslint@^9.0.0 → 10.4.0 (MAJOR) — devDep

- **Current**: 9.39.4 / `^9.0.0`. **Latest**: 10.4.0.
- ESLint 10 requires plugin updates (`typescript-eslint` etc.). devDep only.
- **Recommendation**: defer.

### npm: @types/node@^20.0.0 → 25.9.1 (MAJOR) — devDep

- **Current**: 20.19.41 / `^20.0.0`. **Latest**: 25.9.1.
- TypeScript types only; should be paired with actual Node runtime upgrade (currently Node ≥ 20 per `engines`). devDep only.
- **Recommendation**: defer; bump alongside engines.node bump in a future cycle.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| drizzle-orm | Existing | yes (^0.45.0) | yes | n/a | OK |
| pg | Existing | yes (^8.13.0) | yes | n/a | OK |
| zod | Existing | yes (^3.24.0) | yes (CVE-clean) BUT MAJOR-outdated | n/a | **Soft cap** `plan_dep_major_outdated_unpinned` |
| @opentelemetry/api | Existing | yes (^1.9.0 devDep) | yes | n/a | OK |
| typescript | Existing (devDep) | yes (^5.4.0) | yes | n/a | OK (MAJOR-outdated but devDep — not blocking) |
| vitest | Existing (devDep) | yes (^4.0.0) | yes | n/a | OK |
| vitest-mock-extended | Existing (devDep) | yes (^4.0.0) | yes | n/a | OK |
| eslint + plugins | Existing (devDep) | yes (^9.0.0) | yes | n/a | OK |
| (none — NEW) | NEW | — | — | N/A (zero new deps) | **OK** — plan explicitly states no new runtime deps; Rule 9 column documents reason (`src/theokit/` depends only on `src/core/` DIPs per architecture.md § 3) |
| @usetheo/memory (cross-repo) | NEW cross-repo | n/a (lives in sibling theokit repo) | will be audited by theokit's CI when PR-B lands | n/a (self-reference) | OK — out of scope for this skill's invocation; theokit repo's own `/deps-audit` will validate at PR-B merge time |
| (none — Removed) | Removed | n/a | n/a | n/a | OK |

## Recommended next steps

1. **Accept the 4 MODERATE allowlist-downgraded LOWs.** They are already documented in `.claude/rules/deps-audit-allowlist.txt` with active sunset 2026-08-23. v0.2 inherits the v0.1 stance unchanged.
2. **Note the soft cap on zod-3 MAJOR-outdated.** v0.2 plan does NOT pin zod-3 explicitly via ADR — opening `/to-plan zod-4-migration` is the proper follow-up. For v0.2's `/plan-confidence`, the soft cap of 89 will fire (plan-confidence's final cap will be `min(prior_cap, 89)`).
3. **Defer the 3 devDep MAJOR-outdated** (typescript/eslint/@types/node) — they don't cap runtime safety; track in a devDep-refresh follow-up.
4. **Proceed to `/plan-confidence`** — verdict PASS_WITH_CAVEATS does NOT force INVALID; it caps at 89, which is already the cap from the pre-code-phase `symbol_fab_unverifiable_typescript` allowlist downgrade. Net effect: plan-confidence stays at SHIPPABLE_WITH_CAVEATS 86.8.

## Audit trail invariants honored

- Read-only: no manifest edits performed ✓
- No fabricated CVE IDs (all from `npm audit` JSON output) ✓
- Allowlist downgrade applied (not silent hiding) — findings appear in full in this report ✓
- Auditor unavailable gracefully reported (osv-scanner not installed; pip/cargo/go skipped due to absent manifests) ✓
- No `--force` / `--skip-audit` flags used (do not exist per golden rule) ✓
- `referencia/` clones excluded from audit surface ✓
