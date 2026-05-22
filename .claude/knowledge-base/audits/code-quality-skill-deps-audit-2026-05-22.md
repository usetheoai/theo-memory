# Deps Audit: code-quality-skill

**Date:** 2026-05-22
**Mode:** plan-bound:code-quality-skill
**Verdict:** **INVALID_PLAN_DEPS**
**Plan-confidence cap:** 49 (INVALID band)
**Hard caps triggered:** `plan_dep_not_on_registry`, `plan_dep_version_unspecified`

## Summary

- Ecosystems detected in plan: Python (6 deps), npm (2 external CLIs), Rust (1 external CLI), Go (1 external CLI)
- Manifests at repo root: NONE (pre-code phase; deps are forward-looking)
- Total deps audited: 10 (1 Existing + 9 NEW)
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW (no manifests installed → no CVE surface yet)
- Outdated MAJOR (vs declared): 3 (tree-sitter, mutmut, knip)
- Outdated MINOR (vs declared): 0
- Allowlist hits: 0 active, 0 expired
- Auditor coverage:
  - `npm`: ✅ available (used `npm view`)
  - `pip` / `pip-audit`: ✅ available (used `pip index versions`)
  - `cargo`: ✅ available (used crates.io API)
  - `govulncheck`: ✅ available (Go modules verified via pkg.go.dev)
  - `osv-scanner`: ❌ MISSING — cross-ecosystem unified pass skipped → soft cap `auditor_unavailable_osv-scanner`

## Vulnerabilities (sorted by severity)

None found at declared versions (no installed manifests to scan; future state only).

## Plan-declared-dep verification (Mode 2)

| # | Plan dep | Section | Registry | Exists? | Declared version | Latest | Status |
|---|---|---|---|---|---|---|---|
| 1 | `pyyaml` | Existing | PyPI | ✅ | `^6.0` | 6.0.3 | **OK** — in range |
| 2 | `tree-sitter` | NEW | PyPI | ✅ | `^0.23` | 0.25.2 | ⚠️ **OUTDATED MAJOR** (0.x semver: minor is breaking) — F3 |
| 3 | `tree-sitter-languages` | NEW | PyPI | ✅ | `^1.10` | 1.10.2 | **OK** |
| 4 | `requests` | NEW | PyPI | ✅ | `^2.32` | 2.34.2 | **OK** — within ^2 range |
| 5 | `vulture` | NEW | PyPI (CLI) | ✅ | `^2.14` | 2.16 | **OK** — within ^2 range |
| 6 | `mutmut` | NEW | PyPI (CLI) | ✅ | `^2.5` | 3.5.0 | ⚠️ **OUTDATED MAJOR** — F4 |
| 7 | `knip` | NEW | npm (CLI) | ✅ | `^5.x` | 6.14.2 | ⚠️ **OUTDATED MAJOR** — F5 |
| 8 | `stryker` | NEW | npm (CLI) | ✅ (wrong pkg) | `^8.x` | n/a at name `stryker` (npm `stryker` is v0.35.1, abandoned) | ❌ **HARD CAP — F1** |
| 9 | `cargo-udeps` | NEW | crates.io (CLI) | ✅ | `^0.1.x` | 0.1.61 | **OK** |
| 10 | `deadcode` | NEW | Go (CLI) | ✅ | `golang.org/x/tools/cmd/deadcode@latest` | golang.org/x/tools v0.45.0 | ❌ **HARD CAP — F2** |

## Findings

### F1 — HARD CAP — `plan_dep_not_on_registry` (npm: `stryker`)

**Severity:** HARD CAP (cap 49 — INVALID band)
**Affected:** Plan line 195 — `stryker (NEW) | ^8.x | npm (external CLI)`

**Cenário:** Plan declares dependency on npm package `stryker` at version `^8.x`. The unscoped npm package `stryker` exists but only at version 0.35.1 (abandoned project from before Stryker rebranded to scoped packages). No version matching `^8.x` exists at this name. The correct package for the JavaScript/TypeScript mutation testing tool referenced in blueprint Corner 4 Technique 3 is `@stryker-mutator/core` (current latest: 9.6.1).

**Impacto:**
- Anyone implementing the plan literally would either:
  - Install `stryker@0.35.1` (abandoned; lacks features assumed by T4.2)
  - Fail to install (`^8.x` no satisfies any version of the unscoped pkg)
- Plan-confidence consumes this verdict → caps plan at 49 → blocks `/implement`.

**Diff suggestion** (apply to plan `## Dependencies` Existing/NEW table):
```diff
- | `stryker` (NEW) | `^8.x` | npm (external CLI) | No mature alternatives in TS ecosystem. | De facto standard |
+ | `@stryker-mutator/core` (NEW) | `^9.6` | npm (external CLI) | No mature alternatives in TS ecosystem. | De facto standard; scoped pkg replaced unscoped `stryker` |
```

Also update SKILL T4.2 file references that say `npx stryker`:
```diff
- Wrap `npx stryker run --mutate {critical_paths}` + parse output.
+ Wrap `npx stryker run --mutate {critical_paths}` (binary still `stryker`; package is `@stryker-mutator/core`)
```

The `npx stryker` invocation stays the same — the CLI binary name is `stryker`; only the npm package metadata is scoped.

### F2 — HARD CAP — `plan_dep_version_unspecified` (Go: `deadcode`)

**Severity:** HARD CAP (cap 49 — INVALID band)
**Affected:** Plan line 194 — `deadcode (NEW) | golang.org/x/tools/cmd/deadcode@latest | Go (external CLI)`

**Cenário:** Plan declares `deadcode` with version `@latest`. The deps-audit-golden-rule explicitly forbids loose ranges `*` or `latest`. Every declared dep MUST have a version pin (`^X.Y.Z`, `~X.Y.Z`, `=X.Y.Z-rc1`, etc.).

**Impacto:**
- Future-you (or another implementer) installs whatever `@latest` resolves to AT THAT MOMENT, which may break parsing assumptions in `GoDetector` (e.g., JSON output schema changes between deadcode v0.45 and v0.50).
- Reproducibility breaks: two runs of `/implement` on different days install different deadcode binaries.

**Diff suggestion:**
```diff
- | `deadcode` (NEW) | `golang.org/x/tools/cmd/deadcode@latest` | Go (external CLI) | ... |
+ | `deadcode` (NEW) | `golang.org/x/tools/cmd/deadcode@v0.45.0` | Go (external CLI) | Pin v0.45.0 (current latest) so JSON schema is stable; reassess at v0.5.0 cut |
```

### F3 — SOFT_FLOOR — `plan_dep_major_outdated_unpinned` (Python: `tree-sitter`)

**Severity:** SOFT_FLOOR (cap 89 — PASS_WITH_CAVEATS)
**Affected:** Plan line 188 — `tree-sitter ^0.23`

**Cenário:** Plan declares `^0.23` but PyPI latest is `0.25.2`. In semver `0.x`, minor version IS breaking — `0.23 → 0.24 → 0.25` each potentially break API. Plan doesn't include an ADR pinning the major.

**Diff suggestion (3 options):**
```diff
# Option A — adopt latest:
- | `tree-sitter` (NEW) | `^0.23` | Python | ... |
+ | `tree-sitter` (NEW) | `^0.25` | Python | ... |

# Option B — pin major via ADR rationale in the row:
- | `tree-sitter` (NEW) | `^0.23` | Python | ... |
+ | `tree-sitter` (NEW) | `~0.23` | Python | (Pinned to 0.23.x — 0.24+ introduced changes to Query API requiring code revision; revisit in v0.2) ... |
```

### F4 — SOFT_FLOOR — `plan_dep_major_outdated_unpinned` (Python: `mutmut`)

**Severity:** SOFT_FLOOR (cap 89)
**Affected:** Plan line 196 — `mutmut ^2.5`

**Cenário:** Plan declares `^2.5` but PyPI latest is `3.5.0`. mutmut 3.x is significant rewrite (different command structure; `mutmut results --output json` not yet stabilized in 3.x).

**Diff suggestion:**
```diff
- | `mutmut` (NEW) | `^2.5` | Python (external CLI) | ... | Most maintained Python mutation tool |
+ | `mutmut` (NEW) | `^3.5` | Python (external CLI) | ... | mutmut 3.x rewrite; JSON output via `mutmut results --json` (NOTE: T4.1 references `--output json` flag — verify against v3 docs before implementation) |
```

Action required at T4.1: re-check mutmut 3.x CLI before implementation; the plan's `mutmut run --paths-to-mutate` syntax may have changed.

### F5 — SOFT_FLOOR — `plan_dep_major_outdated_unpinned` (npm: `knip`)

**Severity:** SOFT_FLOOR (cap 89)
**Affected:** Plan line 191 — `knip ^5.x`

**Cenário:** Plan declares `^5.x` but npm latest is `6.14.2`. Knip v6 introduces config changes; v5 → v6 has known breaking changes (config file shape).

**Diff suggestion:**
```diff
- | `knip` (NEW) | `^5.x` | npm (external CLI) | ... | Knip succeeded ts-prune; first-class monorepo support; matched against [Effective TypeScript article] |
+ | `knip` (NEW) | `^6.14` | npm (external CLI) | ... | Knip succeeded ts-prune; first-class monorepo support; pin to ^6 since v5 → v6 has breaking config changes |
```

T1.2 fixture should be revalidated against knip v6 JSON output schema (may differ from v5).

### F6 — SOFT_CAP — `auditor_unavailable_osv-scanner`

**Severity:** SOFT_CAP (cap 70 — FAIL_MEDIUM band)
**Affected:** environment (not plan-specific)

**Cenário:** `osv-scanner` binary is not installed in the runtime environment. This is the cross-ecosystem unified scanner (covers npm + Python + Rust + Go in a single pass) that complements the per-ecosystem auditors. Without it, we cannot cross-check findings across stacks (e.g., a Rust transitive dep that also has a JS counterpart).

**Impacto:** Per golden rule, "NEVER claim no vulnerabilities when an auditor failed" — although we have per-ecosystem auditors, the cross-coverage gap caps verdict at 70 if untested HIGH/CRITICAL exposure is possible. In this audit, no manifests exist, so per-ecosystem auditors couldn't run against installed deps anyway; the gap is concrete but the surface is empty (pre-code). Once `src/` exists + manifests are written, this missing auditor becomes more consequential.

**Fix suggestion** (environment, not plan):
```bash
# Install osv-scanner
go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest
# Verify
osv-scanner --version
```

Document in plan T0.3 (setup.sh) or PORTABLE.md: `osv-scanner` is a recommended dev tool for cross-ecosystem auditing.

## Outdated (non-vulnerable)

Already covered above as F3-F5 (MAJOR outdated). No MINOR-level outdated findings — all `^X.Y` declarations are satisfied by current registry latest within the major.

## Recommended next steps

1. **Bump `stryker` → `@stryker-mutator/core ^9.6`** in plan v1.2 (fix F1, removes HARD CAP).
2. **Pin `deadcode` to `@v0.45.0`** in plan v1.2 (fix F2, removes HARD CAP).
3. **Decision on F3-F5** (3 MAJOR-outdated SOFT_FLOORs):
   - Either bump to current latest (tree-sitter ^0.25, mutmut ^3.5, knip ^6.14), OR
   - Add ADR-shaped rationale in the Why column explaining the pin (with sunset date for revisit)
4. **Install `osv-scanner`** in dev env to remove F6 (or add to plan PORTABLE.md as a dev prerequisite).
5. **Re-run `/deps-audit code-quality-skill`** after applying fixes; verify verdict moves to `PASS_WITH_CAVEATS` (cap 89) at worst.
6. Then proceed with `/plan-confidence code-quality-skill`.

## Plan validation (Mode 2 summary)

| Plan dep | Section | Registry | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| pyyaml | Existing | ✅ | n/a (no manifest yet) | n/a (Existing) | OK |
| tree-sitter | NEW | ✅ | OUTDATED MAJOR | ✅ | F3 (SOFT_FLOOR) |
| tree-sitter-languages | NEW | ✅ | OK | ✅ | OK |
| requests | NEW | ✅ | OK | ✅ | OK |
| vulture | NEW | ✅ | OK | ✅ | OK |
| mutmut | NEW | ✅ | OUTDATED MAJOR | ✅ | F4 (SOFT_FLOOR) |
| knip | NEW | ✅ | OUTDATED MAJOR | ✅ | F5 (SOFT_FLOOR) |
| stryker | NEW | ❌ wrong pkg | n/a | ✅ | **F1 (HARD CAP)** |
| cargo-udeps | NEW | ✅ | OK | ✅ | OK |
| deadcode | NEW | ✅ | n/a (version unpinned) | ✅ | **F2 (HARD CAP)** |

## Allowlist hits

| Status | Count | Notes |
|---|---|---|
| Active (within sunset) | 0 | Allowlist is seed-empty |
| Expired (re-fired at full severity) | 0 | n/a |

## Verdict rationale

Worst finding wins. Severity ladder (per golden rule cap table):

1. F1 + F2 → HARD CAP 49 (INVALID_PLAN_DEPS family).
2. F6 → SOFT_CAP 70 (auditor_unavailable_osv-scanner) — would cap at 70 alone.
3. F3 + F4 + F5 → SOFT_FLOOR 89 (plan_dep_major_outdated_unpinned, 3 instances) — would cap at 89 alone.

Smallest cap wins: **49 → INVALID_PLAN_DEPS**.

Plan-confidence MUST receive this verdict and apply cap 49 to its own score. `/implement` MUST refuse to start while this audit reports INVALID_PLAN_DEPS.

## Cross-references

- Plan: [`code-quality-skill-plan.md`](../plans/code-quality-skill-plan.md) v1.1
- Edge-case report: [`code-quality-skill-edge-cases-2026-05-22.md`](../reviews/code-quality-skill-edge-cases-2026-05-22.md)
- Blueprint: [`wiring-deadcode-gates-blueprint.md`](../discoveries/blueprints/wiring-deadcode-gates-blueprint.md)
- Golden rule: [`deps-audit-golden-rule.md`](../../rules/deps-audit-golden-rule.md)
- Allowlist: [`deps-audit-allowlist.txt`](../../rules/deps-audit-allowlist.txt) (seed empty)
- Cycle rule: [`cycle-plan.md`](../../rules/cycle-plan.md) v1.1 § Phase contracts § `deps-audit` row
