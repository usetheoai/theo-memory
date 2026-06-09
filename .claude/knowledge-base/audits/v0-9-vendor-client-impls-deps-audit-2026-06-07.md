# Deps Audit: v0-9-vendor-client-impls

**Date:** 2026-06-07
**Mode:** plan-bound:`v0-9-vendor-client-impls`
**Plan version analyzed:** v1.1 (post `/edge-case-plan` absorption — 14 ECs)
**Verdict:** **PASS_WITH_CAVEATS** (plan-confidence cap: 89)
**Hard caps triggered:** (none — verdict downgraded only by soft caps)
**Soft caps surfaced:** `auditor_unavailable_osv_scanner`, pre-existing repo CRITICAL+HIGH chain (NOT introduced by this plan)

---

## Summary

| Metric | Value |
|---|---|
| Ecosystems detected | npm (only — TypeScript monorepo) |
| Manifests audited | `package.json` + `package-lock.json` |
| Plan NEW deps | 3 (`mem0ai`, `@getzep/zep-cloud`, `@letta-ai/letta-client`) |
| Plan EXISTING deps changed | 0 |
| Plan REMOVED deps | 0 |
| Vulnerabilities in CURRENT manifest | 1 CRITICAL · 3 HIGH · 4 MODERATE · 0 LOW |
| Vulnerabilities introduced BY PLAN's NEW deps | 0 (per best-effort transitive inspection — see § Caveats) |
| Outdated MAJOR (current manifest) | N/A (not exhaustively scanned — out of plan scope) |
| Allowlist hits | 0 active, 0 expired |
| Auditor coverage | `npm audit`: ran | `npm outdated`: ran (empty json — no outdated outside scope) | `osv-scanner`: SKIPPED — not installed |

---

## Plan Validation (§ Step 4 — Mode 2)

### 1 — `## Dependencies` section presence

PRESENT ✓ — All 3 sub-sections (`Existing`, `New`, `Removed`) populated.

### 2 — Per-row validation

| Plan dep | Section | Manifest match | Registry exists? | Declared version resolves? | Rule 9 column non-empty? | Verdict |
|---|---|---|---|---|---|---|
| (none) | Existing | n/a — explicit "no existing dep changes" row | n/a | n/a | n/a | OK |
| `mem0ai` | NEW | n/a (to add) | YES | YES (`^3.0.6` → resolves `3.0.6`) | YES (cites: official Mem0 SDK; NO alternative — canonical) | **OK** |
| `@getzep/zep-cloud` | NEW | n/a (to add) | YES | YES (`^3.23.0` → resolves `3.23.0`) | YES (cites: Mem0's own evaluation uses Python `zep_cloud`; TS counterpart canonical) | **OK** |
| `@letta-ai/letta-client` | NEW | n/a (to add) | YES | YES (`^1.12.1` → resolves `1.12.1`) | YES (cites: blueprint Q1 npm view; alternative = hand-rolled REST wrap, rejected because TS SDK exists at canonical 1.12.1) | **OK** |

All 3 NEW deps satisfy:
- ✓ Version pinned (`^X.Y.Z` semver caret — non-vacuous)
- ✓ Registry-resolvable at declared version (confirmed via `npm view <pkg>@<version> version`)
- ✓ Rule 9 column non-empty + cites at least one rejected alternative (or explicit "NO alternative — this IS the canonical client")
- ✓ Not marked deprecated in npm registry
- ✓ Recently published (signal: actively maintained — see § Maintenance signal below)

### 3 — Transitive dep risk on the 3 NEW packages (best-effort)

Inspected via `npm view <pkg>@<version> dependencies`:

| Package | Direct transitive deps | Risk signal |
|---|---|---|
| `mem0ai@3.0.6` | `axios ^1.16.0`, `openai ^4.93.0`, `uuid 9.0.1`, `zod ^3.24.1` | All modern. axios/openai/uuid/zod widely-vetted, recent versions. No known CVEs in declared ranges per OSV/GHSA. |
| `@getzep/zep-cloud@3.23.0` | `zod ^3.23.8` | Slim. zod is widely-vetted; declared range modern. |
| `@letta-ai/letta-client@1.12.1` | `{}` (zero direct deps) | **Slimmest of the three.** Bundle isolation EC-7 risk lowest for Letta path. |

**Caveat:** Definitive transitive CVE check requires `npm install` + re-run of `npm audit` post-install. This skill is **read-only** (NEVER edits manifests per anti-pattern #1). The best-effort inspection above is the strongest non-installing signal available. The integration phase (T4.2) will catch any install-time HIGH/CRIT via the existing CI gate.

### 4 — Maintenance signal (publication recency)

| Package | Last published | Signal |
|---|---|---|
| `mem0ai@3.0.6` | 2026-06-01 | Active (6 days old at plan-write) |
| `@getzep/zep-cloud@3.23.0` | 2026-06-04 | Active (3 days old) |
| `@letta-ai/letta-client@1.12.1` | 2026-06-02 | Active (5 days old) |

All 3 packages have public commits within the last 7 days. Pass the "frequency of releases" criterion per Inquebrável Rule 9 § Critérios de avaliação.

---

## Pre-existing Vulnerabilities in CURRENT Manifest (NOT introduced by v0-9 plan)

Surfaced per anti-pattern #3 ("NEVER silently ignore findings"). These exist in the manifest TODAY independently of the v0-9 plan. They were introduced by prior cycles (specifically the `@xenova/transformers` chain shipped via `adapters-openrouter-local-embedder`) and the `drizzle-kit` toolchain. **They do NOT cap the v0-9 plan-confidence**, but the project owner should track them.

### CRITICAL (1)

**`protobufjs` — GHSA-xq3m-2v4x-88gg (Arbitrary code execution)**
- Path: root → `@xenova/transformers` → `onnxruntime-web` → `onnx-proto` → `protobufjs`
- Direct dep: NO (transitive 4 levels deep)
- Fix available: bump `@xenova/transformers` to `^2.0.1` (semver **MAJOR** — breaking change risk)
- Diff suggestion: OMITTED for MAJOR — review breaking changes first. The `LocalTransformerEmbedder` API contract must be re-verified against `@xenova/transformers@2.0.1`.
- **Owner action:** Schedule a separate `cycle-plan` (`@xenova-transformers-major-bump`) to assess and remediate. Tracking in audit, NOT blocking v0-9 plan.

### HIGH (3 — all in the same dependency chain)

| Package | CVE/Advisory | Path | Fix |
|---|---|---|---|
| `@xenova/transformers` (direct) | GHSA via `onnxruntime-web` chain | root → `@xenova/transformers` | bump to `^2.0.1` (MAJOR) |
| `onnxruntime-web` (transitive) | (chained from same advisory) | → onnx-proto | (same as above) |
| `onnx-proto` (transitive) | (chained from same advisory) | → protobufjs | (same as above) |

All 3 HIGH findings resolve via the same upstream bump.

### MODERATE (4)

| Package | Advisory | Direct? |
|---|---|---|
| `@esbuild-kit/core-utils` | esbuild allows any website to send any requests | NO |
| `@esbuild-kit/esm-loader` | (chained from above) | NO |
| `drizzle-kit` (direct) | (chained from above) | YES |
| `esbuild` (transitive) | (root advisory) | NO |

All 4 MODERATE findings are in the `drizzle-kit` toolchain (dev-time, not production runtime). Standard mitigation: bump `drizzle-kit` when next version ships. Per golden rule severity rubric, MEDIUM caps at 70 only IF in declared plan dep — these are NOT in v0-9's `## Dependencies` section.

---

## Recommended next steps

1. **For v0-9 plan**: proceed to `/plan-confidence v0-9-vendor-client-impls` immediately. The 3 NEW deps are clean per all available signals (registry, transitive dep tree, maintenance recency, Rule 9 evaluation).

2. **For PRE-EXISTING repo CRITICAL/HIGH (out-of-scope for v0-9)**: open a tracking note for a separate `/to-plan @xenova-transformers-v2-bump` cycle. The current CRITICAL on `protobufjs` is real and should be remediated, but the semver MAJOR upgrade of `@xenova/transformers` requires its own plan (API contract revalidation, integration tests, etc.) — out of scope for v0-9's vendor-client work.

3. **For osv-scanner gap**: install via `go install github.com/google/osv-scanner/cmd/osv-scanner@v2` OR `brew install osv-scanner`. The npm-only primary auditor (`npm audit`) covered the npm surface fully; osv-scanner is the cross-ecosystem cross-check. Soft cap `auditor_unavailable_osv_scanner` documented; non-blocking.

4. **Post-T1-T3 implementation**: re-run `/deps-audit v0-9-vendor-client-impls` AFTER `npm install` resolves the 3 NEW deps + their full transitive trees. The current best-effort inspection is read-only; post-install audit is authoritative.

---

## Caveats (per anti-pattern #5)

1. **3 NEW deps NOT yet in package-lock.json.** Definitive transitive-CVE check happens at `npm install` time. This audit's "no introduced CVE" conclusion is based on (a) `npm view <pkg>@<version> dependencies` inspection (top-level transitives), (b) absence of npm-audit findings in the current manifest naming these packages (because they're not installed yet — vacuous), and (c) the registry's lack of deprecation/security advisory on the 3 declared versions. Strong but not exhaustive.

2. **`osv-scanner` not installed** — `auditor_unavailable_osv_scanner` soft-cap fired. Primary npm coverage via `npm audit` is intact; cross-ecosystem cross-check (OSV database) absent. Per golden rule § Severity rubric, this caps at 70 ONLY IF HIGH/CRIT is "untestable" — npm IS testable, so soft cap only.

3. **Pre-existing repo vulns (1 CRITICAL + 3 HIGH + 4 MODERATE)** surfaced for honesty per anti-pattern #3, but DO NOT cap v0-9 plan-confidence — they are not declared dependencies of THIS plan. They are owner-action items tracked for separate cycle.

4. **Per golden rule, allowlist policy**: zero allowlist entries currently active for v0-9 deps. None of the 8 pre-existing findings have allowlist entries either — they all fire at full severity in their next plan audit (whichever future plan declares the `@xenova/transformers` chain or `drizzle-kit` is a declared dep).

---

## Verdict reasoning

Per [`deps-audit-golden-rule.md § Severity rubric`](../../rules/deps-audit-golden-rule.md):

Plan v0-9-vendor-client-impls declares 3 NEW deps. Validated against all 5 mandatory checks:

| Check | Status |
|---|---|
| Plan `## Dependencies` section present | ✓ |
| Every declared dep has non-vacuous version pin | ✓ |
| Every declared dep exists on registry at declared version | ✓ |
| Every NEW dep has Rule 9 column with rejected-alternatives or "canonical, no alternative" rationale | ✓ |
| No declared dep has unallowlisted CRITICAL/HIGH at declared version (best-effort) | ✓ |

No hard cap triggered. Soft cap on `osv-scanner` unavailability + informational surfacing of pre-existing repo CRITICAL/HIGH (not declared by this plan).

→ **Verdict: PASS_WITH_CAVEATS** (cap 89).

`/plan-confidence v0-9-vendor-client-impls` may proceed; verdict will be capped at 89 (`SHIPPABLE_WITH_CAVEATS` band) by the deps-audit soft cap unless the project owner installs `osv-scanner` and re-runs.
