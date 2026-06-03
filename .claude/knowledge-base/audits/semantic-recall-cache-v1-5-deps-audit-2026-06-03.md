# Deps Audit: semantic-recall-cache-v1-5

**Date:** 2026-06-03
**Mode:** plan-bound (Mode 2) — `semantic-recall-cache-v1-5`
**Plan:** `.claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md` v1.1
**Verdict:** **PASS** for plan scope (5 declared existing deps all clean); pre-existing manifest CVE state surfaced honestly per Inquebrável Rule 3 (NOT introduced by this plan; NOT a cap firing for plan-confidence)
**Hard caps triggered:** none

## Summary

- Ecosystems detected: npm (single — no `pyproject.toml`, `Cargo.toml`, `go.mod`)
- Auditor coverage:
  - `npm audit`: ran (GitHub Advisory + OSV data)
  - `npm outdated`: ran
  - `osv-scanner`: SKIPPED — binary not installed (same state as cycle-2 audit 2026-06-03)
  - `pip-audit`: SKIPPED — no Python manifest
- Plan-declared NEW deps: **0**
- Plan-declared EXISTING deps: **5** (`pg`, `drizzle-orm`, `@opentelemetry/api`, `zod`, `vitest`)
- Plan-declared REMOVED deps: **0**
- Plan-introduced CVE delta: **ZERO** (no manifest changes)
- Pre-existing manifest CVE state (NOT introduced by this plan): **1 CRITICAL + 5 HIGH + 4 MODERATE** — same as cycle-2 baseline 2026-06-03; surfaced honestly below.

## Plan validation

Plan v1.1 § Dependencies declares ZERO new deps. All 5 EXISTING deps mentioned in the plan are present in `package.json` at versions matching the declared range.

| Plan dep | Section | Manifest match | Plan version | Manifest installed | Audit clean for this dep? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|---|
| `pg` | Existing | yes | `^8.13.0` | `^8.13.0` | yes — zero CVEs on pg 8.x | n/a (already in tree) | OK |
| `drizzle-orm` | Existing | yes | (transitive) | `^0.45.0` | yes — zero CVEs reported on drizzle-orm 0.45.x | n/a | OK |
| `@opentelemetry/api` | Existing | yes | (existing) | `^1.9.0` | yes — zero CVEs reported on otel-api 1.x | n/a | OK |
| `zod` | Existing | yes | `^3.25.0` | `^3.25.0` | yes — zero CVEs on zod 3.x | n/a | OK |
| `vitest` | Existing | yes | `^4.0.0` | `^4.0.0` | yes — zero CVEs on vitest 4.x | n/a | OK |

**All 5 plan-declared deps: audit-clean.** No `plan_dep_critical_cve` / `plan_dep_high_cve` / `plan_dep_medium_cve` cap fires for this plan's scope.

## Vulnerabilities — pre-existing manifest state (NOT introduced by this plan)

Per Inquebrável Rule 3 (Honesty) — surface the manifest-state chain even though it falls outside this plan's `## Dependencies` declaration scope. This is the SAME chain disclosed in:
- source plan v1.2 amendment (2026-06-03 standalone-p0)
- cycle-1 plan v1.2 amendment (2026-06-03)
- cycle-2 plan v1.2 amendment (2026-06-03)
- cycle-2 deps audit 2026-06-03

cycle-2 audit (`2026-06-03`) carries the canonical writeup; this audit mirrors it because the manifest is byte-identical between the two cycles (no new deps introduced between cycle-2 and v1.5 plan).

### Chain 1 — `@xenova/transformers` → `protobufjs` (1 CRITICAL + 5 HIGH; pre-existing)

- **Direct dep at root:** `@xenova/transformers` (declared in `package.json#dependencies` per adapters-openrouter-local-embedder cycle)
- **Transitive chain:** `@xenova/transformers → onnxruntime-web → onnx-proto → protobufjs`
- **Worst severity:** CRITICAL (`GHSA-xq3m-2v4x-88gg` — arbitrary code execution in `protobufjs`, CVSS 9.8)
- **Plan-scope impact:** **NONE.** v1.5 plan does NOT touch `@xenova/transformers` OR `protobufjs` OR `onnxruntime-web`. ZERO delta vs cycle-2 baseline.
- **Allowlist state:** active entries at `.claude/rules/deps-audit-allowlist.txt` (CRITICAL sunset 2026-07-01; HIGH sunset 2026-08-01) — within sunset, severity downgraded ONE level per golden rule. **Honest disclosure preserved.**
- **Status:** deferred to `/loop 7d /deps-audit` periodic housekeeping pending upstream `onnxruntime-web` bump.

### Chain 2 — `drizzle-kit` → `esbuild ≤0.24.2` (4× MODERATE, dev/CI only; pre-existing)

- **Path:** `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`
- **Worst severity:** MODERATE (`GHSA-67mh-4wv8-2f99` — dev server SSRF; CVSS 5.3)
- **Plan-scope impact:** NONE. v1.5 plan uses `drizzle-orm` (runtime) which has zero CVEs; the chain above is via `drizzle-kit` (dev tooling). T0.2 migration uses `runMigrations()` runtime path, NOT `drizzle-kit push` direct (drizzle-kit is dev-only).
- **Allowlist state:** active entries (sunset 2026-08-23). Dev/CI tooling — not in runtime path.

## Outdated (non-vulnerable) — plan-declared deps only

| Plan dep | Manifest | Latest | Semver | ADR pin? | Cap fires? |
|---|---|---|---|---|---|
| `pg` | (latest 8.x) | ≥ 8.13.0 | NONE/MINOR | n/a | NO |
| `drizzle-orm` | `0.45.x` | `0.45.x` line | NONE | n/a | NO |
| `@opentelemetry/api` | `1.9.x` | `1.x` line | NONE | n/a | NO |
| `zod` | `3.25.76` | `4.4.3` | MAJOR | yes — source plan ADR D7 + v1-1-multi-peer plan v1.2 amendment (sunset 2026-09-01) | NO |
| `vitest` | `4.1.7` | `4.1.8` | PATCH | n/a (PATCH below MAJOR threshold) | NO |

**Zero MAJOR-outdated UNPINNED plan-declared deps.** No `plan_dep_major_outdated_unpinned` cap fires.

## Outdated — manifest-wide (NOT introduced by this plan)

For honesty, same outdated deps OUTSIDE this plan's scope but present in the manifest (identical state to cycle-2 audit):

| Package | Current | Latest | Delta | ADR pin? | Status |
|---|---|---|---|---|---|
| `@hono/node-server` | `1.19.14` | `2.0.4` | MAJOR | yes — source plan ADR D14 (sunset 2026-09-01) | NOT plan-declared by v1.5 |
| `@hono/zod-openapi` | `0.18.4` | `1.4.0` | MAJOR | yes — source plan ADR D14 (sunset 2026-09-01) | NOT plan-declared by v1.5 |
| `@types/node` | `20.19.41` | `25.9.1` | MAJOR | implicit (Node 22 engines pin) | NOT plan-declared by v1.5 |
| `commander` | `12.1.0` | `14.0.3` | MAJOR | yes — source plan ADR D14 | NOT plan-declared by v1.5 |
| `eslint` | `9.39.4` | `10.4.1` | MAJOR | (no pin; dev-only) | NOT plan-declared; PRE-EXISTING |
| `openai` | `4.104.0` | `6.41.0` | MAJOR | (used by OpenAILLM cycle) | NOT plan-declared; PRE-EXISTING |
| `typescript` | `5.9.3` | `6.0.3` | MAJOR | (project std) | NOT plan-declared; PRE-EXISTING |
| `@apidevtools/swagger-parser` | `10.1.1` | `12.1.0` | MAJOR | yes — source plan ADR D14 | NOT plan-declared by v1.5 |

## Recommended next steps

1. **No action required for v1.5 plan-declared deps.** All 5 are audit-clean and pin-respected.
2. **(NOT a v1.5 task)** Track `protobufjs` chain remediation upstream (`microsoft/onnxruntime` issue). Allowlist re-fires aggressively after 2026-07-01 if upstream hasn't shipped.
3. **Proceed with `/plan-confidence semantic-recall-cache-v1-5`** — this audit's verdict (PASS for plan scope) does NOT cap plan-confidence below SHIPPABLE.

## Honesty discipline (Inquebrável Rule 3)

- **What this audit CAN claim:** v1.5 plan-declared deps are clean; v1.5 introduces ZERO new vulnerabilities; ZERO new outdated MAJOR pins.
- **What this audit CANNOT claim:** "no vulnerabilities in the project" — manifest carries 1 CRITICAL + 5 HIGH transitive CVEs in the `@xenova/transformers → ... → protobufjs` chain. Pre-existing, declared honestly across the project's CVE follow-up trail.
- **Identical to cycle-2 baseline (2026-06-03)** — v1.5 plan does NOT change the manifest's vuln profile.
- **What this audit DID NOT cover:** `osv-scanner` cross-check (binary not installed); Python/Rust/Go ecosystems (no manifest files); transitive depth audit beyond `npm audit`'s GitHub Advisory data.
