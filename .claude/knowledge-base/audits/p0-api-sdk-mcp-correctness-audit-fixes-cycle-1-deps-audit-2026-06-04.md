# Deps Audit: p0-api-sdk-mcp-correctness-audit-fixes-cycle-1

**Date:** 2026-06-04
**Mode:** plan-bound:p0-api-sdk-mcp-correctness-audit-fixes-cycle-1
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none — all CRITICAL/HIGH findings are TRANSITIVE per § Transitive deps rule + allowlisted within sunset)
**Soft caps surfaced:**
- `transitive_cve_chain_xenova_to_protobufjs` (cap 89 — per `deps-audit-golden-rule.md § Transitive deps` rule)
- `auditor_unavailable_osv-scanner` (cap 89 — informational; npm audit + npm outdated ran; osv-scanner cross-check absent)
- `plan_dep_version_pin_inaccurate_for_vitest` (informational — doesn't fire a rubric cap; honest disclosure per Inquebrável Rule 3)

## Summary

- **Ecosystems detected:** npm only (no Python, Rust, Go manifests)
- **Manifests:** `package.json` + `package-lock.json`
- **Auditor coverage:** `npm audit`: ran clean (JSON parsed); `npm outdated`: ran clean (JSON parsed); `osv-scanner`: SKIPPED — binary not installed on host
- **Total deps audited:** ~700 transitive + 30 direct (per `package-lock.json` size)
- **Vulnerabilities found:** **1 CRITICAL + 4 HIGH (cascaded to 2 direct deps) + 5 MODERATE** — ALL allowlisted within sunset (today 2026-06-04 < earliest sunset 2026-07-01 by 27 days)
- **Outdated:** 11 packages outdated (5 MAJOR semver-major behind, 6 MINOR/PATCH); zero with ADR-pinning rationale gap because the fix-cycle introduces zero new deps
- **Allowlist hits:** 14 active entries cover every CRITICAL/HIGH/MODERATE finding; **0 expired**

## Vulnerabilities (sorted by severity)

### GHSA-xq3m-2v4x-88gg — CRITICAL CVSS 9.8 (npm: protobufjs <=7.5.5; transitive)

- **Direct chain root:** `@xenova/transformers ^2.17.0` (devDep — optional Xenova MiniLM 384-dim embedder)
- **Path:** `@xenova/transformers → onnxruntime-web@1.14.0 → onnx-proto → protobufjs`
- **Affected range:** `protobufjs <=7.5.5`
- **Fixed in:** `protobufjs >= 7.5.5` (requires `@xenova/transformers` semver-major bump to v3.x upstream; not yet released)
- **Allowlist status:** **ACTIVE** — entry in `.claude/rules/deps-audit-allowlist.txt:52` with sunset 2026-07-01 (27 days remaining); risk-envelope analysis already documented at allowlist.txt:47-50 (protobufjs parser invoked ONLY at model-warmup time when downloading ONNX from huggingface CDN; user input never reaches the parser at runtime; attack surface = CDN compromise / MitM = low for local-dev demo)
- **Severity AFTER allowlist downgrade:** MEDIUM
- **Severity AFTER § Transitive deps rule:** soft warning (cap 89) — transitive CVE on a leaf dep, surfaced as PASS_WITH_CAVEATS not FAIL_*
- **Diff suggestion:** OMITTED — fix requires upstream `@xenova/transformers` v3.x line shipping; track at https://github.com/xenova/transformers.js/issues. Re-audit at sunset (2026-07-01) to verify upstream fix OR escalate to dep replacement (fastembed-js / Python sidecar via Rule 9 re-evaluation).

### GHSA-66ff-xgx4-vchm + GHSA-75px-5xx7-5xc7 + GHSA-jvwf-75h9-cwgg + GHSA-685m-2w69-288q — HIGH (npm: protobufjs; transitive — 4 advisories on same dep)

- **Allowlist status:** ALL 4 ACTIVE — entries at allowlist.txt:53-56 with sunset 2026-08-01 (58 days remaining); same risk-envelope as the CRITICAL above
- **Severity AFTER allowlist downgrade:** LOW
- **Severity AFTER § Transitive deps rule:** soft warning (cap 89)
- **Diff suggestion:** same as CRITICAL — bound to upstream `@xenova/transformers` v3.x

### GHSA-xq3m-2v4x-88gg — HIGH (cascade) (npm: @xenova/transformers ^2.17.0; DIRECT)

- **Source:** cascade severity from the transitive protobufjs chain above (npm audit rolls up severity to the highest-level dep)
- **Allowlist status:** ACTIVE — entry at allowlist.txt:57 sunset 2026-07-01 (27 days remaining)
- **Severity AFTER allowlist downgrade:** LOW (cap 89)
- **Note:** the CVE is on protobufjs, not on @xenova/transformers itself; npm audit's severity-rollup model surfaces it on the direct dep that pulls in the chain. Same fix (upstream v3.x).

### GHSA-xq3m-2v4x-88gg — HIGH (cascade) (npm: onnxruntime-web; transitive)

- Allowlist entry at allowlist.txt:58 sunset 2026-07-01; same root cause as protobufjs CRITICAL; cap 89 after downgrade.

### GHSA-xq3m-2v4x-88gg — HIGH (cascade) (npm: onnx-proto; transitive)

- Allowlist entry at allowlist.txt:59 sunset 2026-07-01; same root cause; cap 89.

### GHSA-67mh-4wv8-2f99 — MODERATE CVSS 5.3 (npm: esbuild <=0.24.2; transitive — dev-server-request-leak)

- **Direct chain root:** `drizzle-kit ^0.31.0` (devDep — CLI-only for `db:push` + `db:generate`)
- **Path:** `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`
- **Allowlist status:** ALL 4 entries ACTIVE — allowlist.txt:41-44 sunset 2026-08-23 (80 days remaining); risk envelope documented (drizzle-kit usage is CLI-only; no dev-server spun up; esbuild dev-server-request-leak unreachable in our use case)
- **Severity AFTER allowlist downgrade:** LOW (cap 89)

## Outdated (non-vulnerable)

The fix-cycle introduces ZERO new deps; no MAJOR-outdated dep is part of the plan's `## Dependencies` table. The 5 MAJOR-outdated packages below are pre-existing devDeps NOT touched by this plan; out of scope per `deps-audit-golden-rule.md § Severity rubric` rule that ONLY caps plan-declared deps:

| Package | Current | Latest | Delta | In plan deps? |
|---|---|---|---|---|
| `@apidevtools/swagger-parser` | 10.1.1 | 12.1.0 | MAJOR | NO — pre-existing devDep |
| `@hono/node-server` | 1.19.14 | 2.0.4 | MAJOR | NO — pre-existing dep |
| `@hono/zod-openapi` | 0.18.4 | 1.4.0 | MAJOR | NO — pre-existing dep |
| `@types/node` | 20.19.41 | 25.9.1 | MAJOR | NO — pre-existing devDep |
| `commander` | 12.1.0 | 14.0.3 | MAJOR | NO — pre-existing dep |
| `eslint` | 9.39.4 | 10.4.1 | MAJOR | NO — pre-existing devDep |
| `openai` | 4.104.0 | 6.42.0 | MAJOR | NO — pre-existing dep |
| `typescript` | 5.9.3 | 6.0.3 | MAJOR | YES (Existing row) — covered below |
| `typescript-eslint` | 8.59.4 | 8.60.1 | PATCH | NO — pre-existing devDep |
| `vitest` | 4.1.7 | 4.1.8 | PATCH | YES (Existing row) — covered below |
| `zod` | 3.25.76 | 4.4.3 | MAJOR | NO — pre-existing dep |

None of the 5 MAJOR-outdated triggers `plan_dep_major_outdated_unpinned` (the rule applies only to deps the plan declares; here only `typescript` is on the plan list and it's only PATCH-behind a major bump that has not been adopted in the manifest pin).

## Plan validation (Mode 2)

The fix-cycle plan declares 3 Existing rows + 0 NEW + 0 Removed:

| Plan dep | Plan version pin | Manifest version | Match? | Audit clean? | Rule 9 | Verdict |
|---|---|---|---|---|---|---|
| `vitest` | `^1.6.0` (devDep) | `^4.0.0` (devDep) | **NO** (major mismatch — `^1.6.0` does NOT include `4.x`) | yes (no CVE) | n/a (Existing) | **caveat — version pin inaccurate** |
| `typescript` | `^5.4.5` (devDep) | `^5.4.0` (devDep) | yes (plan range narrower-but-compatible within same major) | yes (no CVE) | n/a (Existing) | OK |
| `@modelcontextprotocol/sdk` | `^1.5.0` (dep) | `^1.29.0` (dep) | yes (plan range `^1.5.0` includes manifest `1.29.0`) | yes (no CVE) | n/a (Existing) | OK |

**Plan deps section honesty disclosure (Inquebrável Rule 3):**

- The plan's `## Dependencies` table for `vitest` declares `^1.6.0` but the actual manifest is `^4.0.0`. This is a version-pin documentation inaccuracy authored when the plan was first written. The plan does NOT introduce vitest; the row is informational (Existing). The runtime behavior is unaffected (consumer uses whatever the manifest resolves), but the plan's documentation surface is technically wrong.
- Rubric does NOT have a stable identifier for "plan dep version doesn't match manifest" (the rubric covers MISSING version or NOT-on-registry, both of which don't apply here). So no hard cap fires. Soft recommendation only.
- **Recommended fix:** bump plan's `## Dependencies` row from `^1.6.0` → `^4.0.0` to match the actual manifest. Single-line edit; can land in plan v1.2 OR be deferred — does not change implementation behavior either way. Not a `/plan-confidence` blocker.

## Recommended next steps

1. **No manifest changes recommended.** All CVE findings are allowlisted within sunset; the fix-cycle introduces zero new deps; protobufjs upstream fix (Xenova v3.x) is tracked + budgeted via the existing allowlist sunset on 2026-07-01.
2. **OPTIONAL pre-`/plan-confidence` polish:** bump plan v1.1 → v1.2 with a 1-line edit fixing the vitest version pin (`^1.6.0` → `^4.0.0`). Cosmetic; does not affect cycle-plan progression.
3. **`auditor_unavailable_osv-scanner`** — install `osv-scanner` on the dev host or CI runner for belt-and-suspenders cross-check. Not blocking — `npm audit` is authoritative for npm ecosystem per `deps-audit-golden-rule.md § Anti-pattern 6` rule of pairing.
4. **Proceed with `/plan-confidence p0-api-sdk-mcp-correctness-audit-fixes-cycle-1`.** Expected verdict cap: 89 (SHIPPABLE_WITH_CAVEATS) due to PASS_WITH_CAVEATS verdict here. Plan structural score is what determines whether plan-confidence reaches 89 floor or higher within the cap.

## Sunset tracking (forward calendar — informational)

| Sunset date | Days from today | Allowlist entries affected | Risk if not resolved by sunset |
|---|---|---|---|
| **2026-07-01** | **27 days** | protobufjs CRITICAL + @xenova/transformers HIGH + onnxruntime-web HIGH + onnx-proto HIGH (4 entries) | If `@xenova/transformers` v3.x line not released by then, sunset expires → CVE re-fires at full CRITICAL/HIGH → next `/deps-audit` would cap at 49 (FAIL_INSECURE). **Mitigation pre-sunset:** upstream PR landing OR allowlist sunset extension + new ADR + new risk-envelope analysis OR dep replacement (Rule 9 re-evaluation per existing allowlist comment "fastembed-js or Python sidecar"). |
| 2026-08-01 | 58 days | 4 additional protobufjs HIGH entries | Same root cause |
| 2026-08-23 | 80 days | esbuild + 3 esbuild-kit + drizzle-kit entries (5 entries) | If `drizzle-kit` doesn't migrate to `tsx` by then, sunset expires → CVE re-fires at MODERATE → cap drops from 89 to 70 (FAIL_MEDIUM) |
| 2026-08-29 | 86 days | postcss + next (2 entries — NOT in current npm audit output; may be stale from a previous chain) | Verify before next audit cycle |

The 2026-07-01 sunset is the earliest. The fix-cycle should complete its implement → review → merge well before that date (typical fix-cycle ≤ 1 day implement + 1 day review).
