# Deps Audit: verbs-as-cli-fixes-cycle-1

**Date:** 2026-06-04
**Mode:** plan-bound:verbs-as-cli-fixes-cycle-1
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none — all CRITICAL/HIGH findings are TRANSITIVE per § Transitive deps rule + allowlisted within sunset; identical surface to 3 prior 2026-06-04 audits)
**Soft caps surfaced:**
- `transitive_cve_chain_xenova_to_protobufjs` (cap 89 — per `deps-audit-golden-rule.md § Transitive deps`)
- `auditor_unavailable_osv-scanner` (cap 89 — informational; npm audit + npm outdated ran clean; osv-scanner cross-check absent)
- `plan_dep_dotenv_declared_devdep_section_inaccurate` (informational — plan declares dotenv as Existing devDep but `package.json#devDependencies.dotenv` is `n/a`; dotenv is transitively pulled by `natural@^8.1.0` which IS in manifest; cosmetic doc drift, no rubric cap fires)

## Summary

- **Ecosystems detected:** npm only (no Python, Rust, Go manifests)
- **Manifests:** `package.json` (v0.0.0-rc.3 — registry-published 2026-06-04 under --tag next) + `package-lock.json`
- **Auditor coverage:** `npm audit`: ran clean; `npm outdated`: ran clean; `osv-scanner`: SKIPPED — binary not installed
- **Vulnerabilities found:** **1 CRITICAL + 3 HIGH (cascaded) + 4 MODERATE** — ALL allowlisted within sunset (identical surface to parent verbs-as-CLI audit + p0-api-sdk-mcp-correctness-audit-fixes-cycle-1 audit + p0-api-sdk parent audit)
- **Allowlist hits:** 14 active entries cover every finding; 0 expired (earliest sunset 2026-07-01 = 27 days remaining)

**CVE surface IDENTICAL to the 2026-06-04 parent verbs-as-CLI audit** (`verbs-as-cli-themory-remember-recall-forget-reflect-deps-audit-2026-06-04.md`). Zero regression introduced by fix-cycle scope (refactor + docs + ADR amendments — no manifest mutation).

## Plan validation (Mode 2)

The fix-cycle-1 plan v1.1 declares 3 Existing rows + 0 NEW + 0 Removed:

| Plan dep | Plan version pin | Manifest version | Match? | Audit clean? | Rule 9 | Verdict |
|---|---|---|---|---|---|---|
| `commander` | `^12.1.0` | `^12.1.0` | yes (exact) | yes (no CVE) | n/a (Existing) | OK |
| `vitest` | `^4.0.0` | `^4.0.0` | yes (exact) | yes (no CVE) | n/a (Existing) | OK |
| `dotenv` | `^17.4.2` (devDep claim) | n/a in devDeps; **transitive** via `natural@^8.1.0` | **MISMATCH** (kind — plan claims Existing devDep, manifest carries it transitively only) | yes (no CVE) | n/a (Existing) | **caveat — kind misclassification** |

**Honest disclosure (Inquebrável Rule 3):** the plan's `## Dependencies § Existing — use as-is` row for `dotenv` claims it as a direct devDep at `^17.4.2`. Empirically: `jq '.devDependencies.dotenv' package.json` returns null; dotenv is pulled by `natural@^8.1.0` transitively. The CVE-scan + version semantics resolve correctly (transitively-locked `17.4.2` empirically observed via `jq '.version' node_modules/dotenv/package.json`), so the cycle's CHANGELOG note about `DOTENV_CONFIG_QUIET` workaround vs T3.1's runtime mutation strategy still applies as intended. Rubric has no stable identifier for "declared devDep but actually transitive"; soft recommendation only — bump plan to v1.2 with corrected row labeling `dotenv | ^17.4.2 (transitive via natural^8.1.0) | npm | Theme 3 mutation target` to match empirical reality. Does not affect cycle progression.

**Zero NEW deps** introduced by this fix-cycle — pure refactor + docs + ADR amendments. Inquebrável Rule 11 (YAGNI) clean. Rule 9 evaluation N/A.

## Vulnerabilities (sorted by severity)

Same risk-envelope analysis as the 2026-06-04 parent audits applies verbatim:

### GHSA-xq3m-2v4x-88gg — CRITICAL CVSS 9.8 (npm: protobufjs <=7.5.5; transitive)

- **Direct chain root:** `@xenova/transformers ^2.17.0` (devDep — Xenova MiniLM 384-dim embedder)
- **Path:** `@xenova/transformers → onnxruntime-web@1.14.0 → onnx-proto → protobufjs`
- **Allowlist:** ACTIVE — `.claude/rules/deps-audit-allowlist.txt:52`; sunset 2026-07-01 (27 days remaining)
- **Severity AFTER allowlist downgrade:** MEDIUM
- **Severity AFTER § Transitive deps rule:** soft warning (cap 89)
- **Fix bound:** upstream `@xenova/transformers` v3.x line release

### Cascaded HIGH + MODERATE findings

All same root cause (protobufjs chain via Xenova) + esbuild dev-server-leak via drizzle-kit chain. All allowlisted; same risk-envelope documented in `.claude/rules/deps-audit-allowlist.txt`.

## Outdated (non-vulnerable)

Same 11 outdated entries as prior 2026-06-04 audits (5 MAJOR + 6 MINOR/PATCH). The fix-cycle-1 plan introduces ZERO new deps; no MAJOR-outdated dep is part of `## Dependencies` table. Out of scope per `deps-audit-golden-rule.md § Severity rubric` rule (caps only plan-declared deps).

## Recommended next steps

1. **No manifest changes recommended.** All CVE findings allowlisted within sunset; zero new deps; protobufjs upstream fix tracked + budgeted.
2. **OPTIONAL pre-`/plan-confidence` polish:** bump plan v1.1 → v1.2 with 1-line edit fixing the dotenv kind misclassification (`Existing devDep` → `Existing transitive via natural^8.1.0`). Cosmetic; does not affect cycle progression.
3. **`auditor_unavailable_osv-scanner`** — install `osv-scanner` for belt-and-suspenders cross-check. Not blocking.
4. **Proceed with `/plan-confidence verbs-as-cli-fixes-cycle-1`.** Expected verdict cap: 89 (SHIPPABLE_WITH_CAVEATS) per PASS_WITH_CAVEATS verdict here. Plan structural score determines whether plan-confidence reaches 89 floor or higher within the cap.

## Sunset tracking (forward calendar — identical to parent audit)

| Sunset date | Days from today | Allowlist entries affected | Risk if not resolved |
|---|---|---|---|
| **2026-07-01** | **27 days** | protobufjs CRITICAL + 3 cascaded HIGH | Upstream `@xenova/transformers` v3.x must land OR allowlist extension + new ADR |
| 2026-08-01 | 58 days | 4 additional protobufjs HIGH entries | Same root cause |
| 2026-08-23 | 80 days | esbuild + 3 esbuild-kit + drizzle-kit (5 entries) | drizzle-kit migration to tsx upstream required OR cap drops 89→70 |

Fix-cycle-1 typical implement → review → merge ≤ 2 dias, bem dentro do 27-dias horizonte.
