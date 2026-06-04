# Deps Audit: verbs-as-cli-themory-remember-recall-forget-reflect

**Date:** 2026-06-04
**Mode:** plan-bound:verbs-as-cli-themory-remember-recall-forget-reflect
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none — all CRITICAL/HIGH findings are TRANSITIVE + allowlisted within sunset; same surface as 2026-06-04 parent audit for `p0-api-sdk-mcp-correctness-audit-fixes-cycle-1`)
**Soft caps surfaced:**
- `transitive_cve_chain_xenova_to_protobufjs` (cap 89 — per `deps-audit-golden-rule.md § Transitive deps`)
- `auditor_unavailable_osv-scanner` (cap 89 — informational; npm audit + npm outdated ran clean; osv-scanner cross-check absent)
- `plan_dep_version_pin_inaccurate_for_pg` (informational — plan declares pg ^8.16.0; manifest is ^8.13.0; cosmetic doc drift, no rubric cap fires)

## Summary

- **Ecosystems detected:** npm only (no Python, Rust, Go manifests)
- **Manifests:** `package.json` (v0.0.0-rc.3 — registry-published 2026-06-04 under --tag next) + `package-lock.json`
- **Auditor coverage:** `npm audit`: ran clean; `npm outdated`: ran clean; `osv-scanner`: SKIPPED — binary not installed
- **Vulnerabilities found:** **1 CRITICAL + 3 HIGH (cascaded) + 4 MODERATE** — ALL allowlisted within sunset
- **Allowlist hits:** 14 active entries cover every finding; 0 expired
- **Per-package severity (npm audit JSON `vulnerabilities` field):**

| Package | Severity | Type | Allowlist sunset |
|---|---|---|---|
| protobufjs | CRITICAL | transitive | 2026-07-01 (27 days) |
| @xenova/transformers | HIGH (cascade) | direct devDep | 2026-07-01 |
| onnxruntime-web | HIGH (cascade) | transitive | 2026-07-01 |
| onnx-proto | HIGH (cascade) | transitive | 2026-07-01 |
| esbuild | MODERATE | transitive | 2026-08-23 (80 days) |
| @esbuild-kit/core-utils | MODERATE | transitive | 2026-08-23 |
| @esbuild-kit/esm-loader | MODERATE | transitive | 2026-08-23 |
| drizzle-kit | MODERATE | direct devDep | 2026-08-23 |

**CVE surface IDENTICAL to the 2026-06-04 parent audit** (`p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-deps-audit-2026-06-04.md`). No regression introduced by the rc.3 version bump.

## Plan validation (Mode 2)

The verbs-as-cli plan v1.1 declares 3 Existing rows + 0 NEW + 0 Removed:

| Plan dep | Plan version pin | Manifest version | Match? | Audit clean? | Rule 9 | Verdict |
|---|---|---|---|---|---|---|
| `commander` | `^12.1.0` | `^12.1.0` | yes (exact) | yes (no CVE) | n/a (Existing) | OK |
| `pg` | `^8.16.0` | `^8.13.0` | **NO** (plan claims newer minor — `^8.16.0` does NOT match manifest `^8.13.0` range overlap is broken; manifest range `[8.13, 9)` covers everything plan range needs, so consumer behavior unaffected, but plan documentation is technically inaccurate) | yes (no CVE) | n/a (Existing) | **caveat — cosmetic doc drift** |
| `vitest` | `^4.0.0` | `^4.0.0` | yes (exact) | yes (no CVE) | n/a (Existing) | OK |

**Honest disclosure (Inquebrável Rule 3):** the plan's `## Dependencies` table for `pg` declares `^8.16.0` (newer than manifest's `^8.13.0`). Cosmetic mismatch only:
- Runtime: consumer uses whatever the manifest resolves; `^8.13.0` resolves to `8.16.x` if available at install time (npm picks highest within range)
- The plan does NOT introduce pg; the row is informational (Existing)
- Rubric does NOT have a stable identifier for "plan dep version doesn't match manifest" (the rubric covers MISSING version or NOT-on-registry, neither applies here)
- **Recommended fix (cosmetic; optional):** bump plan v1.1 → v1.2 with 1-line edit `^8.16.0` → `^8.13.0` to match manifest exactly. Does not affect cycle-plan progression.

**Zero NEW deps** introduced by this fix-cycle plan — Inquebrável Rule 11 (YAGNI) clean. Rule 9 evaluation N/A (no NEW rows).

## Vulnerabilities (sorted by severity)

Same risk-envelope analysis as the 2026-06-04 parent audit applies verbatim:

### GHSA-xq3m-2v4x-88gg — CRITICAL CVSS 9.8 (npm: protobufjs <=7.5.5; transitive)

- **Direct chain root:** `@xenova/transformers ^2.17.0` (devDep — Xenova MiniLM 384-dim embedder)
- **Path:** `@xenova/transformers → onnxruntime-web@1.14.0 → onnx-proto → protobufjs`
- **Affected range:** `protobufjs <=7.5.5`
- **Allowlist:** ACTIVE — `.claude/rules/deps-audit-allowlist.txt:52`; sunset 2026-07-01 (27 days remaining); risk envelope documented (parser invoked ONLY at model-warmup time when downloading ONNX from huggingface CDN; user input never reaches parser at runtime)
- **Severity AFTER allowlist downgrade:** MEDIUM
- **Severity AFTER § Transitive deps rule:** soft warning (cap 89)
- **Fix bound:** upstream `@xenova/transformers` v3.x line release

### Other HIGH + MODERATE findings

All same root cause (protobufjs chain via Xenova) + esbuild dev-server-leak via drizzle-kit chain. All allowlisted; same risk-envelope as documented in `.claude/rules/deps-audit-allowlist.txt`.

## Outdated (non-vulnerable)

Same 11 outdated entries as parent audit (5 MAJOR + 6 MINOR/PATCH). The verbs-as-cli plan introduces ZERO new deps; no MAJOR-outdated dep is part of the plan's `## Dependencies` table. Out of scope per `deps-audit-golden-rule.md § Severity rubric` (rule caps only plan-declared deps).

## Recommended next steps

1. **No manifest changes recommended.** All CVE findings allowlisted within sunset; the fix-cycle introduces zero new deps; protobufjs upstream fix tracked + budgeted.
2. **OPTIONAL pre-`/plan-confidence` polish:** bump plan v1.1 → v1.2 with 1-line edit fixing pg version pin (`^8.16.0` → `^8.13.0`). Cosmetic; does not affect cycle-plan progression.
3. **`auditor_unavailable_osv-scanner`** — install `osv-scanner` on dev host/CI for belt-and-suspenders cross-check. Not blocking.
4. **Proceed with `/plan-confidence verbs-as-cli-themory-remember-recall-forget-reflect`.** Expected verdict cap: 89 (SHIPPABLE_WITH_CAVEATS) due to PASS_WITH_CAVEATS verdict here. Plan structural score determines whether plan-confidence reaches 89 floor or higher within the cap.

## Sunset tracking (forward calendar — informational, identical to parent audit)

| Sunset date | Days from today | Allowlist entries affected | Risk if not resolved |
|---|---|---|---|
| **2026-07-01** | **27 days** | protobufjs CRITICAL + 3 cascaded HIGH | Upstream `@xenova/transformers` v3.x must land OR allowlist extension + new ADR + new risk-envelope OR dep replacement (Rule 9 re-evaluation) |
| 2026-08-01 | 58 days | 4 additional protobufjs HIGH entries | Same root cause |
| 2026-08-23 | 80 days | esbuild + 3 esbuild-kit + drizzle-kit (5 entries) | drizzle-kit migration to tsx upstream required OR cap drops 89→70 |
| 2026-08-29 | 86 days | postcss + next (2 entries — stale; verify) | Re-audit before sunset |

The 2026-07-01 sunset is the earliest. Verbs-as-cli plan should complete its implement → review → merge well before that date (typical cycle ≤ 1-2 days).
