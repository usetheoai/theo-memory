# Deps Audit: verbs-as-cli-fixes-cycle-2

**Date:** 2026-06-04
**Mode:** plan-bound:verbs-as-cli-fixes-cycle-2
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none — all CRITICAL/HIGH findings are TRANSITIVE per § Transitive deps rule + allowlisted within sunset; identical surface to 4 prior 2026-06-04 audits)
**Soft caps surfaced:**
- `transitive_cve_chain_xenova_to_protobufjs` (cap 89 — per `deps-audit-golden-rule.md § Transitive deps`)
- `auditor_unavailable_osv-scanner` (cap 89 — informational; npm audit + npm outdated ran clean; osv-scanner cross-check absent)

## Summary

- **Ecosystems detected:** npm only (no Python, Rust, Go manifests)
- **Manifests:** `package.json` (v0.0.0-rc.3 — registry-published 2026-06-04 under --tag next) + `package-lock.json`
- **Auditor coverage:** `npm audit`: ran clean; `npm outdated`: ran clean; `osv-scanner`: SKIPPED — binary not installed
- **Vulnerabilities found:** **1 CRITICAL + 3 HIGH (cascaded) + 4 MODERATE** — ALL allowlisted within sunset (identical surface to verbs-as-cli-fixes-cycle-1 + p0-api-sdk-mcp-correctness-audit-fixes-cycle-1 + verbs-as-cli parent + p0-api-sdk parent audits)
- **Allowlist hits:** 14 active entries cover every finding; 0 expired (earliest sunset 2026-07-01 = 27 days remaining)

**CVE surface IDENTICAL to the 4 prior 2026-06-04 audits** (`verbs-as-cli-fixes-cycle-1-deps-audit-2026-06-04.md`, `verbs-as-cli-themory-remember-recall-forget-reflect-deps-audit-2026-06-04.md`, etc.). Zero regression introduced by this fix-cycle scope (pure refactor + docs + JSDoc tags + build-script extension — no manifest mutation).

## Plan validation (Mode 2)

The fix-cycle-2 plan v1.0 declares 3 Existing rows + 0 NEW + 0 Removed:

| Plan dep | Plan version pin | Manifest version | Match? | Audit clean? | Rule 9 | Verdict |
|---|---|---|---|---|---|---|
| `commander` | `^12.1.0` | `^12.1.0` | yes (exact) | yes (no CVE) | n/a (Existing) | OK |
| `vitest` | `^4.0.0` | `^4.0.0` | yes (exact) | yes (no CVE) | n/a (Existing) | OK |
| `typescript` | `^5.x` | `^5.7.2` | yes (caret-major) | yes (no CVE) | n/a (Existing) | OK |

**Zero NEW deps** introduced by this fix-cycle — pure refactor + docs + JSDoc tags + npm script extension (`prebuild:clean` + `prepack` via shell-only, no new packages). Inquebrável Rule 11 (YAGNI) clean. Rule 9 evaluation N/A.

**Plan declaration of `typescript ^5.x` is precise** — the manifest carries `^5.7.2`; the caret-x semver intent matches per cycle-plan.md spec.

## Vulnerabilities (sorted by severity)

Same risk-envelope analysis as the 4 prior 2026-06-04 audits applies verbatim:

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

Same 11 outdated entries as prior 2026-06-04 audits (5 MAJOR + 6 MINOR/PATCH). The fix-cycle-2 plan introduces ZERO new deps; no MAJOR-outdated dep is part of `## Dependencies` table. Out of scope per `deps-audit-golden-rule.md § Severity rubric` rule (caps only plan-declared deps).

## Recommended next steps

1. **No manifest changes recommended.** All CVE findings allowlisted within sunset; zero new deps; protobufjs upstream fix tracked + budgeted.
2. **`auditor_unavailable_osv-scanner`** — install `osv-scanner` for belt-and-suspenders cross-check. Not blocking.
3. **Proceed with `/plan-confidence verbs-as-cli-fixes-cycle-2`.** Expected verdict cap: 89 (SHIPPABLE_WITH_CAVEATS) per PASS_WITH_CAVEATS verdict here. Plan structural score determines whether plan-confidence reaches 89 floor or higher within the cap.

## Sunset tracking (forward calendar — identical to parent audit)

| Sunset date | Days from today | Allowlist entries affected | Risk if not resolved |
|---|---|---|---|
| **2026-07-01** | **27 days** | protobufjs CRITICAL + 3 cascaded HIGH | Upstream `@xenova/transformers` v3.x must land OR allowlist extension + new ADR |
| 2026-08-01 | 58 days | 4 additional protobufjs HIGH entries | Same root cause |
| 2026-08-23 | 80 days | esbuild + 3 esbuild-kit + drizzle-kit (5 entries) | drizzle-kit migration to tsx upstream required OR cap drops 89→70 |

Fix-cycle-2 typical implement → review → merge ≤ 2 dias, bem dentro do 27-dias horizonte.
