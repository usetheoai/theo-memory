# Deps Audit: principles-alignment-hardening

**Date:** 2026-06-04
**Mode:** plan-bound (slug=`principles-alignment-hardening`, plan v1.1)
**Plan path:** `.claude/knowledge-base/plans/principles-alignment-hardening-plan.md`
**Verdict:** **PASS**
**Hard caps triggered:** []
**Soft caps surfaced:** `auditor_unavailable_osv-scanner` (advisory only — npm audit IS the authoritative npm-ecosystem tool per skill SoT; osv-scanner is "optional but recommended" cross-check; does NOT cap verdict because plan is npm-only single-ecosystem)

## Summary

- **Ecosystems detected:** npm only (no `pyproject.toml`, `Cargo.toml`, `go.mod` at repo root — pip-audit, cargo, govulncheck N/A for this plan)
- **Plan-declared deps audited:** 4/4 (all Existing; zero NEW; zero Removed)
- **Vulnerabilities found (npm audit):** 1 CRITICAL · 3 HIGH · 4 MODERATE · 0 LOW
- **Outdated (relevant to plan):** 1 MINOR (vitest 4.1.7 → 4.1.8, non-blocking)
- **Allowlist hits:** 8 active (0 expired) — every vuln finding maps to a pre-existing allowlist entry from prior cycles (`adapters-openrouter-local-embedder` + `v0-1-local-runtime` + `examples-chat-with-memory-v0-4b-expansion`) with sunset dates 2026-07-01 / 2026-08-01 / 2026-08-23 / 2026-08-29 — all in active window relative to today (2026-06-04)
- **Plan-declared deps with vulnerabilities:** **ZERO** — all 8 findings are in transitive chains rooted at NON-plan-declared deps (`drizzle-kit` devDep + `@xenova/transformers` adapter pulled by the openrouter-local-embedder cycle, NOT this plan)
- **Auditor coverage:** `npm audit`: ran (authoritative for npm); `npm outdated`: ran; `osv-scanner`: SKIPPED (binary not installed at `/home/paulo/.local/bin`); `pip-audit` / `cargo audit` / `govulncheck`: N/A (no matching ecosystem at repo root)

## Plan validation (Mode 2)

The plan's `## Dependencies` section declares exactly 4 Existing deps + 0 NEW + 0 Removed, per Inquebrável Rule 11 (YAGNI) ceiling. Cross-reference:

| Plan dep | Section | package.json match | Installed (lockfile) | npm audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|
| `pg` | Existing | yes (`^8.13.0` in `dependencies`) | yes | yes (no vuln) | n/a (Existing) | OK |
| `drizzle-orm` | Existing | yes (`^0.45.0` in `dependencies`) | yes | yes (no vuln on `drizzle-orm` itself; `drizzle-kit` devDep findings are allowlisted) | n/a (Existing) | OK |
| `@opentelemetry/api` | Existing | yes (`^1.9.0` in `dependencies`) | yes | yes (no vuln) | n/a (Existing) | OK |
| `vitest` | Existing | yes (`^4.0.0` in `devDependencies`) | yes (4.1.7 — semver-compatible) | yes (no vuln) | n/a (Existing) | OK (MINOR outdated 4.1.7 → 4.1.8; non-blocking) |

**Section completeness check:**
- [x] `## Dependencies` section present (line 428 of plan)
- [x] `### Existing` subsection populated with table
- [x] `### New` subsection present and honestly populated with "None — Inquebrável Rule 11 (YAGNI). MMR is implemented as a pure ≤ 100 LoC function over existing `number[]` embeddings + cosine similarity. No external diversification library."
- [x] `### Removed` subsection present and populated with "None."
- [x] Version pins use exact semver caret notation; no `*` or `latest` wildcards
- [x] **NO `plan_new_dep_no_rule9_evaluation`** fires — there are no NEW deps to evaluate; the honest "None" + rationale satisfies the gate
- [x] Plan's `### Accepted Risks (inherited from v1.5.0 envelope)` subsection ALREADY documents the 8 active allowlist CVEs — verdict surfaces them for cross-reference (NOT a NEW disclosure required by this audit)

## Vulnerabilities (sorted by severity; all in pre-existing allowlist)

### CVE — CRITICAL · protobufjs `<=7.5.7` (transitive via @xenova/transformers chain)
- **GHSA:** `GHSA-xq3m-2v4x-88gg` — Arbitrary code execution in protobufjs via generated `toObject` code
- **Fixed in:** `protobufjs >= 7.5.8` (upstream depends on `@xenova/transformers` v3 line — onnxruntime-web ≥ 1.18 expected)
- **Path:** root → `@xenova/transformers ^2.17.0` → `onnxruntime-web@1.14.0` → `onnx-proto` → `protobufjs`
- **Allowlist status:** ACTIVE (entry at `deps-audit-allowlist.txt:52`; sunset `2026-07-01`; 27 days remaining as of today)
- **Severity downgrade per allowlist:** CRITICAL → MEDIUM (one-level downgrade per golden rule)
- **Plan reference:** NOT a plan-declared dep. Inherited from `adapters-openrouter-local-embedder` cycle (2026-06-01). Plan's `### Accepted Risks` cell explicitly inherits this envelope.
- **Diff suggestion:** N/A — plan does not declare protobufjs nor any consumer of it. The allowlist drives upstream resolution timing.

### CVE — HIGH · protobufjs `<=7.5.7` (3 advisories, same transitive chain)
- **GHSAs (3):**
  - `GHSA-66ff-xgx4-vchm` — Code injection through bytes field defaults
  - `GHSA-75px-5xx7-5xc7` — Code generation gadget after prototype pollution
  - `GHSA-jvwf-75h9-cwgg` OR `GHSA-685m-2w69-288q` (npm audit surfaces 3 of 4 originally documented in allowlist)
- **Fixed in:** `protobufjs >= 7.5.8`
- **Path:** identical to CRITICAL entry above
- **Allowlist status:** ACTIVE (entries at `deps-audit-allowlist.txt:53-56`; sunset `2026-08-01`; 58 days remaining)
- **Severity downgrade per allowlist:** HIGH → LOW
- **Plan reference:** NOT plan-declared.

### CVE — HIGH · @xenova/transformers `>=2.0.2` AND onnxruntime-web `<=1.16.0-dev.20230910-24f0893d3c` AND onnx-proto `*`
- **Surface manifestations of the same protobufjs chain**
- **GHSA:** `GHSA-xq3m-2v4x-88gg` (umbrella)
- **Fixed in:** When `@xenova/transformers` v3 ships
- **Allowlist status:** ACTIVE (entries at `deps-audit-allowlist.txt:58-60`; sunset `2026-07-01`; 27 days)
- **Plan reference:** NOT plan-declared.

### CVE — MODERATE · esbuild `<=0.24.2` AND @esbuild-kit/core-utils AND @esbuild-kit/esm-loader AND drizzle-kit `^0.31.0`
- **GHSA:** `GHSA-67mh-4wv8-2f99` — esbuild dev-server-request-leak (CWE-200)
- **Fixed in:** drizzle-kit upstream needs to migrate to tsx (no fix available without upstream change)
- **Path:** root (devDep) → `drizzle-kit ^0.31.0` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`
- **Allowlist status:** ACTIVE (entries at `deps-audit-allowlist.txt:37-40`; sunset `2026-08-23`; 80 days)
- **Severity downgrade per allowlist:** MODERATE → LOW
- **Plan reference:** `drizzle-kit` is the migration CLI used at T0.1 (`drizzle-kit generate` for snapshot creation). Used in dev-only context; production bundle does not include esbuild dev-server. Plan ADR D5 schema migration discipline operates via this path. Risk envelope acknowledged via existing allowlist.

## Outdated (non-vulnerable, plan-relevant)

### npm: vitest 4.1.7 (installed) → 4.1.8 (latest) — MINOR
- **Type:** devDependency
- **Plan declaration:** `vitest ^4.0.0` (range covers 4.1.8 — no manifest change needed)
- **Changelog:** https://github.com/vitest-dev/vitest/releases/tag/v4.1.8
- **Diff suggestion:** OMITTED — within semver caret; `npm install` (or `npm update vitest`) picks up 4.1.8 automatically. Plan-confidence does NOT cap on MINOR drift.

## Plan validation (additional cross-check)

| Hard cap stable identifier | Triggered? | Evidence |
|---|---|---|
| `plan_dep_critical_cve` | NO | None of the 4 plan-declared deps (pg, drizzle-orm, @opentelemetry/api, vitest) have CRITICAL CVEs. CRITICAL protobufjs is transitive via `@xenova/transformers`, which is NOT plan-declared. |
| `plan_dep_high_cve` | NO | Same reasoning — no HIGH CVE on plan-declared deps. |
| `plan_dep_medium_cve` | NO | No MEDIUM CVE on plan-declared deps. |
| `plan_dependencies_section_missing` | NO | Section present at plan line 428. |
| `plan_dep_version_unspecified` | NO | All 4 Existing deps have semver caret pins. |
| `plan_new_dep_no_rule9_evaluation` | NO | Zero NEW deps; honest "None — YAGNI" with rationale. |
| `plan_dep_not_on_registry` | NO | All 4 deps already in `package-lock.json`; registry existence verified by lockfile. |
| `auditor_unavailable_osv-scanner` | ADVISORY ONLY | osv-scanner binary not installed; does NOT cap because npm audit IS the authoritative npm-ecosystem tool per skill SoT. Recommend installing osv-scanner for future cross-validation but does NOT block this plan. |

## Recommended next steps

1. **No manifest changes required** for this plan to proceed. The 4 declared deps are clean of vulnerabilities; outdated `vitest` is within caret and resolves on next `npm install`.
2. **Allowlist sunset discipline:** the 4 protobufjs/Xenova entries sunset on `2026-07-01` (27 days). The principles-alignment-hardening cycle MUST complete BEFORE that date, OR the v0.1 allowlist re-eval will need to address whether Xenova v3 has shipped. This is NOT a deps-audit gate on THIS plan; it's a cross-cycle scheduling note.
3. **Optional (advisory):** install osv-scanner for cross-ecosystem coverage when future plans add Python/Rust/Go deps. Command: `cargo install osv-scanner` OR `go install github.com/google/osv-scanner/cmd/osv-scanner@v1` (per upstream docs at `osv.dev`).
4. Proceed to `/plan-confidence principles-alignment-hardening`. This audit returns PASS; no plan-confidence cap fires from this skill's verdict.

## Honesty disclosures (Inquebrável Rule 3)

- **osv-scanner cross-check not performed.** Skill SoT classifies it as "optional but recommended"; npm audit IS authoritative for npm. For a multi-ecosystem plan, this gap WOULD trigger `auditor_unavailable_osv-scanner` cap 70; for this single-npm-ecosystem plan, it is advisory.
- **Allowlist windows are timed, not perpetual.** The PASS verdict assumes today (2026-06-04) is within each entry's sunset window. Tomorrow's audit re-runs would re-check. The CRITICAL protobufjs entry expires `2026-07-01` — 27 days from today.
- **Transitive CRITICAL is present in the lockfile** (`protobufjs <= 7.5.7`). This audit does NOT hide it. The plan does NOT introduce it; the allowlist absorbs it (per active risk-envelope analysis at `deps-audit-allowlist.txt:48-50`).
- **All 4 plan-declared deps are in `package-lock.json`** at versions satisfying the declared caret ranges. Verified via `python3` JSON inspection of `package.json`; the `package-lock.json` lockfile-resolved versions confirm via `npm audit` running successfully against the lockfile.

## Related

- Golden rule: [`.claude/rules/deps-audit-golden-rule.md`](../../rules/deps-audit-golden-rule.md)
- Allowlist consulted: [`.claude/rules/deps-audit-allowlist.txt`](../../rules/deps-audit-allowlist.txt) (lines 37-60 active)
- Plan: [`.claude/knowledge-base/plans/principles-alignment-hardening-plan.md`](../plans/principles-alignment-hardening-plan.md) v1.1 (2026-06-04 absorption)
- Sibling cycle: `/plan-confidence principles-alignment-hardening` — consume this verdict next
- Prior baseline (envelope inherited): [`semantic-recall-cache-v1-5-deps-audit-2026-06-03.md`](./semantic-recall-cache-v1-5-deps-audit-2026-06-03.md) (if present) OR `/deps-audit` re-gate at adapters-openrouter-local-embedder T1.1 (2026-06-01)
