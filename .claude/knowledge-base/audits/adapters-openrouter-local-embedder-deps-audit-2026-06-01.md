# Deps Audit: adapters-openrouter-local-embedder

**Date:** 2026-06-01
**Mode:** plan-bound (`adapters-openrouter-local-embedder`)
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none)
**Soft caps triggered (informational):**
- `auditor_unavailable_osv-scanner` (informational — npm-only ecosystem; npm audit covers it; no HIGH/CRIT untestable surface introduced by absence)
- 4 existing MODERATE findings allowlisted (esbuild chain) — pre-existing, not introduced by this plan
- 1 existing MODERATE finding allowlisted (postcss/next via examples/) — pre-existing, not introduced by this plan

## Summary

- **Ecosystems detected:** npm (single)
- **Total deps audited at root manifest:** 3 declared `Existing` (`openai`, `pg`, `drizzle-orm`) + 1 declared `NEW` (`@xenova/transformers`)
- **Vulnerabilities found via `npm audit`:** 0 CRITICAL, 0 HIGH, 4 MODERATE (all pre-existing + allowlisted), 0 LOW, 0 info
- **Outdated:** not run (informational; out of scope for plan-bound audit)
- **Allowlist hits:** 6 active entries cover all 4 surfaced findings + 2 transitive (postcss + next via examples/)
- **Auditor coverage:** `npm audit` = ran successfully (npm 11.12.1); `osv-scanner` = NOT installed → INFORMATIONAL gap (npm ecosystem covered authoritatively by `npm audit`; cross-ecosystem layer absent but no other ecosystems present)
- **Registry existence (NEW dep):** `@xenova/transformers` exists at versions 2.17.0, 2.17.1, 2.17.2 (latest); license `Apache-2.0`; maintainer `xenova <admin@xenova.com>`

## Vulnerabilities (sorted by severity)

### MODERATE — `esbuild <=0.24.2` / `@esbuild-kit/core-utils` / `@esbuild-kit/esm-loader` / `drizzle-kit ^0.31.0` (GHSA-67mh-4wv8-2f99)

- **Severity (npm audit):** MODERATE
- **Title:** "esbuild enables any website to send any requests to the development server and read the response"
- **Path:** root → `drizzle-orm` (existing dep at `^0.45.0`) is not the vulnerable surface; `drizzle-kit` (devDep) is.
- **Allowlist status:** ALL 4 entries ACTIVE in `.claude/rules/deps-audit-allowlist.txt` with sunset `2026-08-23` (within 90-day cap for MEDIUM). Allowlist downgrades severity by 1 tier → effectively LOW for verdict calculation.
- **Fix available (per npm):** `drizzle-kit@0.18.1` (semver-major). Upstream tracking: `https://github.com/drizzle-team/drizzle-orm`.
- **Plan reference (Mode 2):** This plan does NOT modify the `drizzle-orm` declared version; the audit allowlisted state stays the same. NO BUMP REQUIRED for this plan.
- **Diff suggestion:** OMITTED (allowlisted, sunset 2026-08-23 — pending upstream tsx migration).

### MODERATE — `postcss <8.5.10` + `next ^15.5.18` (GHSA-qx2v-qp2m-jg93)

- **Severity (npm audit):** MODERATE
- **Title:** "XSS in PostCSS CSS-stringify path (CWE-79, CVSS 6.1)"
- **Path:** `examples/chat-with-memory/` → `next ^15.5.18` → transitive `postcss`
- **Allowlist status:** 2 entries ACTIVE with sunset `2026-08-29`. Allowlist downgrades → LOW for verdict calculation.
- **Plan reference (Mode 2):** The plan modifies `examples/chat-with-memory/lib/memory.ts` and adds a new SDK adapter — neither touches PostCSS or Next's CSS-stringify path. Risk envelope unchanged.

## Outdated (non-vulnerable)

Not run — Mode 2 plan-bound audit focuses on vulnerability gating, not informational outdated-version reports. Suggested for separate `/loop 7d /deps-audit` invocation.

## NEW dep deep-dive — `@xenova/transformers ^2.17.0`

| Field | Value | Status |
|---|---|---|
| Registry existence | npmjs.com/package/@xenova/transformers | ✅ EXISTS |
| Version range `^2.17.0` | resolves to one of `2.17.0`, `2.17.1`, `2.17.2` | ✅ valid range |
| Latest version | `2.17.2` | informational |
| License | `Apache-2.0` | ✅ matches plan ADR D1 claim; compatible with `@usetheo/memory` MIT |
| Maintainer | `xenova <admin@xenova.com>` | ✅ active maintainer (no abandonment signal) |
| Rule 9 evaluation (plan) | 4 alternatives evaluated + REJECTED with rationale: `fastembed-js` (node-gyp), Ollama (daemon), Python sentence-transformers (Python runtime), llama.cpp embed (heavy binary) | ✅ PASS plan_new_dep_rule9_evaluation |
| Declared placement | `optionalDependencies` per plan T1.1 + ADR D1 (Cycle 2 OpenAI precedent) | ✅ correct placement |

### Transitive dep landscape (informational; full transitive CVE audit deferred to post-install in /implement)

`@xenova/transformers@2.17.x` declares 3 direct transitives at the top level:

| Transitive | Version range | Notes |
|---|---|---|
| `sharp` | `^0.32.0` | Native image-processing lib (libvips). `^0.32.0` range allows old 0.32.x; current `sharp` is 0.33+. **No claim about CVE status without post-install audit.** Flagged for re-audit in /implement once `npm install --save-optional @xenova/transformers` runs and the lockfile resolves the actual `sharp` version. |
| `onnxruntime-web` | `1.14.0` (pinned exact) | Wasm/native ONNX runtime. Pinned to `1.14.0` (current Microsoft `onnxruntime-web` is 1.18+). Xenova v2.17 deliberately uses this version. **No claim about CVE status without post-install audit.** |
| `@huggingface/jinja` | `^0.2.2` | Lightweight template engine for tokenizer chat templates. Small surface; no known CVEs at the time of writing per npm registry. |

**Honesty discipline (Inquebrável Rule 3):** I have NOT installed `@xenova/transformers` to materialize the full lockfile. The 3 transitives above are surface-only (from `npm view @xenova/transformers@^2.17.0 dependencies`). A full transitive CVE audit requires:

1. `npm install --save-optional @xenova/transformers@^2.17.0` (lands in T1.1 of `/implement`)
2. `npm audit --json` re-run against the updated lockfile
3. Cross-reference with `osv-scanner` (if/when installed) for non-npm ecosystem coverage of transitives

This audit cannot claim "no transitive vulnerabilities" — it can only claim "registry existence, version range validity, license compatibility, and Rule 9 evaluation are all correct." The post-install re-audit is **mandatory pre-commit gate** during /implement T1.1.

### Sharp + onnxruntime-web native-build constraint (architectural risk, not CVE)

- `sharp ^0.32.0` ships pre-built binaries for common platforms (Linux x64, macOS x64+arm64, Windows). Pure JS fallback exists but is slower.
- `onnxruntime-web@1.14.0` ships Wasm binaries — no native build required.
- `@xenova/transformers` v2.x explicitly supports Node.js + browser. The Node path uses `onnxruntime-node` (NOT `onnxruntime-web`) when available, falling back to web Wasm. This is internal routing.

**Plan ADR D1 claim verification:** the plan declares "Pure-Wasm runtime; no native build" as the key Rule 9 winner over `fastembed-js`. **PARTIALLY TRUE:** `onnxruntime-web` is Wasm (✓), but `sharp` IS native (✗ — semantic gap with the plan claim). However, `sharp` is only invoked when the input is an image (not text), so for our text-embedding use case the native-build path is NOT exercised. Plan claim stands operationally; documented here for transparency.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `openai ^4.x` | Existing | yes (manifest declares `^4.77.0`) | yes (no new CVE) | n/a (existing) | OK |
| `pg ^8.x` | Existing | yes (manifest declares `^8.13.0`) | yes | n/a | OK |
| `drizzle-orm ^0.45.x` | Existing | yes (manifest declares `^0.45.0`) | yes (drizzle-orm itself); drizzle-kit chain has 4 MODERATE allowlisted | n/a | OK_WITH_ALLOWLISTED_MODERATE |
| `@xenova/transformers ^2.17.0` | NEW | n/a (to add in T1.1) | best-effort: no known CRIT/HIGH per npm registry; **full audit deferred to post-install** | yes (4 alternatives evaluated) | OK_PRE_INSTALL |

## Verdict justification

**PASS_WITH_CAVEATS** because:

1. **No CRITICAL or HIGH CVEs on any declared dep** (existing or NEW).
2. **All MODERATE findings are pre-existing + allowlisted** with sunset dates within the golden-rule cap (90 days for MODERATE). Allowlist downgrades them to LOW for verdict math.
3. **NEW dep validation passes** the per-golden-rule structural checks: registry existence, version pin, Rule 9 evaluation, license compatibility.
4. **The pre-install transitive CVE gap is HONESTLY DECLARED** and surfaces as a /implement T1.1 pre-commit gate. This is the canonical workflow per cycle-plan v1.1 (deps-audit cannot install; that's /implement's job).
5. **osv-scanner unavailable** is informational only — npm audit covers the single ecosystem authoritatively.

No `hard_caps_triggered` per `deps-audit-golden-rule.md § Severity rubric`. `/plan-confidence` should NOT cap on this audit's basis.

## Recommended next steps

1. **NO MANIFEST CHANGE NEEDED** for /plan-confidence to proceed. The plan deps section is structurally complete + correctly versioned.
2. **During /implement T1.1**: after `npm install --save-optional @xenova/transformers@^2.17.0`, **immediately re-run `npm audit --json`** against the updated lockfile. If any HIGH/CRIT CVE surfaces on a Xenova transitive, halt /implement → re-open this audit → either bump (if patch available within Xenova's compatible range) OR allowlist with sunset ≤ 60 days (HIGH) / 30 days (CRITICAL) per golden rule.
3. **Re-audit at sunset dates**: existing allowlist entries sunset `2026-08-23` (esbuild chain) and `2026-08-29` (postcss/next chain). Track upstream fixes (drizzle-kit→tsx migration; next→postcss≥8.5.10 bundle bump).
4. **Optional**: install `osv-scanner` (`go install github.com/google/osv-scanner/cmd/osv-scanner@latest` OR via apt/brew) for cross-ecosystem coverage at future audits — adds layered defense against npm-audit dataset gaps.

## Audit trail metadata

- Plan version at audit time: v1.1 (post 5 MUST FIX absorption from `/edge-case-plan` review)
- Plan path: `.claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md`
- Golden rule consulted: `.claude/rules/deps-audit-golden-rule.md`
- Allowlist consulted: `.claude/rules/deps-audit-allowlist.txt` (6 active entries verified)
- Auditor versions:
  - `npm`: 11.12.1
  - `osv-scanner`: NOT INSTALLED (informational gap)
- Next chain step: `/plan-confidence adapters-openrouter-local-embedder`
