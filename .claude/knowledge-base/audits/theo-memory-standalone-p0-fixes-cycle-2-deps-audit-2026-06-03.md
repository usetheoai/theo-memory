# Deps Audit: theo-memory-standalone-p0-fixes-cycle-2

**Date:** 2026-06-03
**Mode:** plan-bound (Mode 2) — `theo-memory-standalone-p0-fixes-cycle-2`
**Plan:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-fixes-cycle-2-plan.md` v1.1
**Verdict:** **PASS** for plan scope (declared deps clean); pre-existing manifest CVE state surfaced honestly per Inquebrável Rule 3 (NOT introduced by this plan; NOT a cap firing for plan-confidence)
**Hard caps triggered:** none

## Summary

- Ecosystems detected: npm (single — no `pyproject.toml`, `Cargo.toml`, `go.mod`)
- Auditor coverage:
  - `npm audit`: ran (data: GitHub Advisory + OSV)
  - `npm outdated`: ran
  - `osv-scanner`: SKIPPED — binary not installed
  - `pip-audit`: SKIPPED — no Python manifest
- Plan-declared NEW deps: **0**
- Plan-declared EXISTING deps: **6** (all transitive-or-direct pins from source plan ADR D14)
- Plan-declared REMOVED deps: **0**
- Auditor-reported vulnerabilities (manifest-wide, NOT scoped to this plan):
  - 1 CRITICAL — `protobufjs` (transitive via `@xenova/transformers → onnxruntime-web → onnx-proto → protobufjs`)
  - 5 HIGH — `protobufjs` (multiple advisories) + `@xenova/transformers` (direct) + `onnxruntime-web` + `onnx-proto`
  - 4 MODERATE — `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`, `esbuild` (dev/CI chain via drizzle-kit; pre-existing per source plan v0.1 allowlist)
- Outdated (non-vulnerable) MAJOR pins relevant to plan-declared deps:
  - `vitest 4.1.7 → 4.1.8` (PATCH — not capped by golden rule)
  - `zod 3.25.76 → 4.4.3` (MAJOR — already pinned by source plan ADR D7 sunset 2026-09-01)
  - 4 other MAJOR-outdated NEW-from-source-plan deps (`@hono/node-server`, `@hono/zod-openapi`, `commander`, `@apidevtools/swagger-parser`) — already pinned by source plan ADR D14 sunset 2026-09-01

## Plan validation

Plan v1.1 § Dependencies declares ZERO new deps. All 6 EXISTING deps mentioned in the plan are present in `package.json` at versions compatible with the declared range.

| Plan dep | Section | Manifest match | Plan version | Manifest installed | Audit clean for this dep? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|---|
| `@asteasolutions/zod-to-openapi` | Existing (transitive via `@hono/zod-openapi`) | yes | n/a (transitive) | (transitive) | yes — zero CVEs reported on this package | n/a (transitive) | OK |
| `zod` | Existing | yes | `^3.25.0` | `3.25.76` | yes — zero CVEs on zod 3.x | n/a (already in tree) | OK |
| `vitest` | Existing | yes | `^4.0.0` | `4.1.7` | yes — zero CVEs on vitest 4.x | n/a | OK |
| `pg` | Existing | yes | `^8.13.0` | (present in manifest) | yes — zero CVEs on pg 8.x | n/a | OK |
| `@modelcontextprotocol/sdk` | Existing | yes | `^1.29.0` | (present in manifest) | yes — zero CVEs reported | n/a | OK |
| `hono` | Existing | yes | `^4.6.0` | (present in manifest) | yes — zero CVEs reported on hono 4.x | n/a | OK |

**All 6 plan-declared deps: audit-clean.** No `plan_dep_critical_cve` / `plan_dep_high_cve` / `plan_dep_medium_cve` cap fires for this plan's scope.

## Vulnerabilities — pre-existing manifest state (NOT introduced by this plan)

Per Inquebrável Rule 3 (Honesty) — surface the manifest-state CRITICAL/HIGH chain explicitly even though it falls outside this plan's `## Dependencies` declaration scope. This mirrors the source plan v1.2 amendment + cycle-1 plan v1.2 amendment which honestly disclosed the same chain. **cycle-2 introduces ZERO new vulnerable deps; pre-existing state is unchanged.**

### CVE chain 1 — `@xenova/transformers` → `protobufjs` (CRITICAL + multiple HIGH)

- **Direct dep at root:** `@xenova/transformers` (declared in `package.json#dependencies` — used by `LocalTransformerEmbedder` per `adapters-openrouter-local-embedder` cycle)
- **Transitive chain:** `@xenova/transformers → onnxruntime-web → onnx-proto → protobufjs`
- **Worst severity:** CRITICAL (`GHSA-xq3m-2v4x-88gg` — arbitrary code execution in `protobufjs`, CVSS 9.8)
- **Other HIGH advisories on `protobufjs ≤7.5.5`:**
  - `GHSA-66ff-xgx4-vchm` — code injection through bytes field defaults
  - `GHSA-75px-5xx7-5xc7` — code generation gadget after prototype pollution (CVSS 8.1)
  - `GHSA-jvwf-75h9-cwgg` — process-wide DoS through unsafe option paths (CVSS 7.5)
  - `GHSA-685m-2w69-288q` — DoS through unbounded protobuf recursion (CVSS 7.5)
- **Fixed in:** `@xenova/transformers ≥2.0.2` reverts onnxruntime-web → protobufjs chain (no direct upgrade path exists since `@xenova/transformers ≥2.0.2` is currently THE version we use; the chain is intrinsic to `onnxruntime-web` for in-browser ONNX support; upstream resolution requires waiting on `microsoft/onnxruntime` to bump `protobufjs` past 7.5.5)
- **Plan-scope impact:** **NONE.** cycle-2 does NOT touch `@xenova/transformers` OR `protobufjs` OR `onnxruntime-web`. Pre-existing state.
- **Honest deferral:** Per cycle-1 plan v1.2 amendment + source plan v1.2 amendment, this chain is "deferred to `/loop 7d /deps-audit` periodic housekeeping" pending upstream `onnxruntime-web` bump. Tracked across the project's CVE follow-up cycle.

### CVE chain 2 — `drizzle-kit` → `esbuild ≤0.24.2` (4× MODERATE, dev/CI only)

- **Path:** `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`
- **Worst severity:** MODERATE (`GHSA-67mh-4wv8-2f99` — dev server SSRF; CVSS 5.3)
- **Plan-scope impact:** NONE. cycle-2 does NOT touch drizzle-kit or esbuild.
- **Honest deferral:** Dev/CI tooling only (not in runtime path); pre-existing per source plan v0.1 allowlist with sunset 2026-08-23.

## Outdated (non-vulnerable) — plan-declared deps only

Per the golden rule, MAJOR-outdated WITHOUT an ADR pinning fires `plan_dep_major_outdated_unpinned` (cap 89). For cycle-2's declared deps:

| Plan dep | Manifest version | Latest | Semver delta | ADR pin? | Cap fires? |
|---|---|---|---|---|---|
| `zod` | `3.25.76` | `4.4.3` | MAJOR | yes — source plan ADR D7 (sunset 2026-09-01) | NO |
| `vitest` | `4.1.7` | `4.1.8` | PATCH | n/a (PATCH below MAJOR threshold) | NO |
| `pg` | (latest 8.x) | unknown | MINOR/PATCH likely | n/a | NO |
| `@modelcontextprotocol/sdk` | `^1.29.0` | (not in outdated list) | NONE | n/a | NO |
| `hono` | `^4.6.0` | (not in outdated list — latest 4.x) | NONE | n/a | NO |
| `@asteasolutions/zod-to-openapi` | (transitive) | (transitive) | n/a | n/a | NO |

**Zero MAJOR-outdated UNPINNED plan-declared deps.** No cap fires.

## Outdated — manifest-wide (NOT introduced by this plan)

For honesty, surfacing outdated deps OUTSIDE this plan's scope but in the manifest:

| Package | Current | Latest | Delta | ADR pin? | Notes |
|---|---|---|---|---|---|
| `@hono/node-server` | `1.19.14` | `2.0.4` | MAJOR | yes — source plan ADR D14 (sunset 2026-09-01) | NOT plan-declared by cycle-2 |
| `@hono/zod-openapi` | `0.18.4` | `1.4.0` | MAJOR | yes — source plan ADR D14 (sunset 2026-09-01) | NOT plan-declared by cycle-2 |
| `@types/node` | `20.19.41` | `25.9.1` | MAJOR | implicit (Node 22 engines pin per source plan T0.1) | NOT plan-declared |
| `commander` | `12.1.0` | `14.0.3` | MAJOR | yes — source plan ADR D14 | NOT plan-declared by cycle-2 |
| `eslint` | `9.39.4` | `10.4.1` | MAJOR | (no pin; dev-only) | NOT plan-declared; PRE-EXISTING |
| `openai` | `4.104.0` | `6.41.0` | MAJOR | (used by OpenAILLM cycle) | NOT plan-declared; PRE-EXISTING |
| `typescript` | `5.9.3` | `6.0.3` | MAJOR | (project std) | NOT plan-declared; PRE-EXISTING |
| `typescript-eslint` | `8.59.4` | `8.60.1` | PATCH | n/a | NOT plan-declared; PATCH below threshold |
| `vitest` | `4.1.7` | `4.1.8` | PATCH | n/a | PATCH; trivial bump available |
| `@apidevtools/swagger-parser` | `10.1.1` | `12.1.0` | MAJOR | yes — source plan ADR D14 | NOT plan-declared by cycle-2 |

## Recommended next steps

1. **No action required for cycle-2 plan-declared deps.** All 6 are audit-clean and pin-respected.
2. **(NOT a cycle-2 task)** Track `protobufjs` chain remediation upstream (`microsoft/onnxruntime` issue). This stays open until `onnxruntime-web` ships with `protobufjs ≥7.5.5+`. Suggested approach: follow-up cycle when upstream lands the fix, OR allowlist with shorter sunset if exposure surface analysis confirms dev-time-only impact.
3. **Proceed with `/plan-confidence theo-memory-standalone-p0-fixes-cycle-2`** — this audit's verdict (PASS for plan scope) does NOT cap plan-confidence below SHIPPABLE.

## Honesty discipline (Inquebrável Rule 3)

- **What this audit CAN claim:** cycle-2's plan-declared deps are clean; cycle-2 introduces ZERO new vulnerabilities; ZERO new outdated MAJOR pins.
- **What this audit CANNOT claim:** "no vulnerabilities in the project" — the manifest carries 1 CRITICAL + multiple HIGH transitive CVEs in the `@xenova/transformers → ... → protobufjs` chain. These are pre-existing, declared honestly across the project's CVE follow-up trail (source plan v1.2 amendment + cycle-1 plan v1.2 amendment), and explicitly outside cycle-2's scope.
- **What this audit DID NOT cover:** `osv-scanner` cross-check (binary not installed); Python/Rust/Go ecosystems (no manifest files); transitive depth audit beyond `npm audit`'s GitHub Advisory data.
