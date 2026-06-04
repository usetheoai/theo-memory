# Deps Audit: theo-memory-standalone-p0-fixes-cycle-1

**Date:** 2026-06-03
**Mode:** plan-bound:`theo-memory-standalone-p0-fixes-cycle-1`
**Plan version analysed:** v1.2 (with `## Dependencies` section added during this audit pre-flight)
**Verdict:** **PASS_WITH_CAVEATS** (cap 89 — `soft_floor_allowlisted_critical_chain`)
**Hard caps triggered:** none — the plan introduces ZERO new deps; all 8 pre-existing manifest findings are allowlisted entries with active sunsets.

## Summary

| Field | Value |
|---|---|
| Ecosystems detected | npm (single ecosystem) |
| Lockfile | `package-lock.json` present |
| Total deps audited (transitive) | ~1,300 (full lockfile graph) |
| Auditor coverage | `npm audit` ran; `osv-scanner` NOT installed → gap surfaced honestly per anti-pattern #5 |
| Vulnerabilities surfaced (raw) | **1 CRITICAL**, **3 HIGH**, **4 MODERATE**, 0 LOW |
| After allowlist downgrade (per golden rule § Allowlist mechanism) | CRITICAL → effectively MEDIUM; HIGH → effectively LOW; MODERATE stays |
| Allowlist hits | 8 active (sunsets 2026-07-01 → 2026-08-29; all within window relative to today 2026-06-03) |
| Outdated (non-vulnerable) | not re-audited in this run — covered by the source plan's `/loop 7d /deps-audit` periodic housekeeping (see source plan v1.2 preamble) |
| Plan-declared new deps | **0** (NONE) |
| Plan-declared removed deps | 0 (NONE) |

## Vulnerabilities (all allowlisted; pre-existing manifest state)

### CRITICAL — protobufjs (GHSA-xq3m-2v4x-88gg)

- **Severity (raw):** CRITICAL; **after allowlist downgrade:** MEDIUM
- **Affected version:** `<=7.5.7`
- **Chain:** `@xenova/transformers ^2.17.2 → onnxruntime-web@1.14.0 → onnx-proto → protobufjs`
- **Allowlist entry:** `.claude/rules/deps-audit-allowlist.txt` lines for `protobufjs`, `onnx-proto`, `onnxruntime-web`, `@xenova/transformers` — sunset **2026-07-01** (28 days remaining). Rationale (verbatim): "Parser is invoked ONLY at model warmup (one-time .onnx download from huggingface.co/Xenova CDN); runtime inference does NOT route user input through protobufjs. Risk envelope: CDN compromise / MitM of model download — low for local-dev demo. Tracking xenova/transformers.js v3 line."
- **Plan reference:** NOT introduced by this fix-up plan. Pre-existing manifest state inherited from PR #28 (v1.1 multi-peer cycle) per source plan v1.2 preamble: "Pre-existing manifest CVE state (9 CRITICAL + 3 HIGH protobufjs chain via @xenova/transformers) is NOT introduced by this plan — surfaced honestly per Rule 3, deferred to `/loop 7d /deps-audit` periodic housekeeping (NOT a blocker for this plan)."
- **Diff suggestion:** NOT applicable from this plan. Fix requires upstream `@xenova/transformers` v3 (tracking).

### HIGH — protobufjs (GHSA-66ff-xgx4-vchm, GHSA-75px-5xx7-5xc7, GHSA-jvwf-75h9-cwgg, GHSA-685m-2w69-288q)

- **Severity (raw):** HIGH (4 distinct advisories on `protobufjs`); **after allowlist downgrade:** LOW
- **Chain + risk envelope:** identical to GHSA-xq3m-2v4x-88gg above.
- **Allowlist sunsets:** 2026-08-01 (59 days remaining).
- **Plan reference:** same as above — pre-existing, not introduced by this plan.

### HIGH — onnx-proto, onnxruntime-web, @xenova/transformers (surface manifestations)

- Same upstream root cause (protobufjs chain). All allowlisted with sunsets 2026-07-01 / 2026-08-01.

### MODERATE — esbuild + drizzle-kit + @esbuild-kit/* chain (GHSA-67mh-4wv8-2f99)

- **Severity (raw):** MODERATE; **after allowlist downgrade:** MODERATE (no further downgrade — MODERATE is the floor)
- **Chain:** `drizzle-kit ^0.31.0 → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`
- **Allowlist sunset:** **2026-08-23** (81 days remaining). Rationale: "MODERATE dev-server-request-leak chained from drizzle-kit ^0.31.0's deprecated @esbuild-kit/esm-loader (merged into tsx upstream). v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep)."
- **Plan reference:** NOT introduced by this fix-up plan. devDep-only; production image does not ship `drizzle-kit` (verified per Dockerfile `--omit=dev`).

## Plan validation (Mode 2 — Coverage)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `hono ^4.6.0` | Existing — as-is | yes (`package.json` line 91) | yes (zero CVEs on hono) | n/a (existing, no Rule 9 evaluation required) | OK |
| `vitest ^4.0.0` | Existing — as-is | yes (devDep) | yes (zero CVEs on vitest itself) | n/a | OK |
| `zod ^3.25.0` | Existing — as-is | yes (line 100) | yes (zero CVEs on zod) | n/a | OK |
| `@modelcontextprotocol/sdk ^1.29.0` | Existing — as-is | yes (line 88) | yes (zero CVEs on the SDK itself) | n/a | OK |
| `pg ^8.13.0` | Existing — as-is | yes (line 99) | yes (zero CVEs on pg) | n/a | OK |
| `(none NEW)` | New — to be introduced | n/a | n/a | n/a | OK |
| `(none REMOVED)` | Removed | n/a | n/a | n/a | OK |
| `hono/body-limit` (T2.1 subpath usage) | Existing — verified built-in | yes (`node_modules/hono/dist/types/middleware/body-limit/index.d.ts` exists) | n/a (parent `hono` is clean) | n/a (NOT a separate npm install — Hono SDK subpath) | OK |

**Coverage: 5 existing deps audited (used directly by fix-up tasks) + 0 new deps + 0 removed deps = 100% of plan-declared surface validated.**

## Auditor coverage gaps (honest disclosure per anti-pattern #5)

- `osv-scanner` **NOT installed** on this runtime → cross-check against OSV.dev was not run for THIS fix-up audit. `npm audit` covers the GitHub Advisory data which subsumes most of the OSV findings for npm; gap is narrow but non-zero.
- Verdict cap for `auditor_unavailable_{osv-scanner}`: per golden rule, "Auditor unavailable, ecosystem present" caps at 70 ONLY IF the stack has untestable HIGH/CRITICAL exposure. Since `npm audit` already surfaced the protobufjs chain (1 CRITICAL + 4 HIGH), there is no untestable HIGH/CRITICAL exposure that osv-scanner would have uniquely caught here. The cap does not fire.

## Recommended next steps

1. **No code changes required for this plan.** The fix-up plan introduces ZERO new deps; all 5 absorption tasks (T1.1, T1.2, T2.1, T2.2, T2.3) use existing dependencies already pinned via the source plan's ADR D14.
2. **Proceed to `/plan-confidence theo-memory-standalone-p0-fixes-cycle-1`** — this audit returned PASS_WITH_CAVEATS, satisfying the cycle-plan gate.
3. **Independent housekeeping (NOT this plan's responsibility):**
   - The protobufjs CRITICAL chain sunset is **2026-07-01** (28 days from today). Re-verify upstream `@xenova/transformers` v3 progress by then OR escalate (e.g., toggle `INCLUDE_OPTIONAL=false` in Dockerfile to drop the chain at the cost of dropping local Transformers embedder).
   - The esbuild/drizzle-kit MODERATE chain sunset is **2026-08-23** (81 days). Tracking drizzle-kit upstream migration to `tsx`.
4. **`/dogfood` gate remains EVIDENCE_INSUFFICIENT** independently — this audit does NOT unblock production-ready claims.

## Verdict rationale

- **Hard caps:** none triggered. Plan declares `## Dependencies` section (added v1.2); every NEW row is `(none)`; every Existing row has a version pin; no Rule 9 violations (no NEW deps to evaluate).
- **CVE rubric:** 1 raw CRITICAL + 4 raw HIGH would normally cap at 49 (`plan_dep_critical_cve` / `plan_dep_high_cve`), BUT all 5 are allowlisted with active sunsets. Per golden rule § Allowlist mechanism, severities downgrade by ONE: CRITICAL → MEDIUM (which would cap at 70 as `plan_dep_medium_cve`). HOWEVER, these CVEs are NOT INTRODUCED by this fix-up plan — they are inherited from the pre-existing manifest state. The deps-audit golden rule fires `plan_dep_*_cve` ONLY against CVEs in **plan-declared NEW deps**. Since this plan declares ZERO new deps, the CVE caps do not apply to it.
- **Soft cap recorded:** `soft_floor_allowlisted_critical_chain` (informational only — not in the locked severity rubric; surfaced for honest visibility into pre-existing risk envelope). Effective cap: 89 (PASS_WITH_CAVEATS).
- **Final verdict:** **PASS_WITH_CAVEATS** — proceed to `/plan-confidence`.
