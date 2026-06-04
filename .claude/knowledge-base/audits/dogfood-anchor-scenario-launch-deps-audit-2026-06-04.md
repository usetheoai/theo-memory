# Deps Audit: dogfood-anchor-scenario-launch

**Date:** 2026-06-04
**Mode:** plan-bound (slug=`dogfood-anchor-scenario-launch`, plan v1.1)
**Plan path:** `.claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md`
**Verdict:** **PASS**
**Hard caps triggered:** []
**Soft caps surfaced:** `auditor_unavailable_osv-scanner` (advisory only — npm audit IS the authoritative npm-ecosystem tool per skill SoT; osv-scanner is "optional but recommended" cross-check; does NOT cap verdict because plan is npm-only single-ecosystem)

## Summary

- **Ecosystems detected:** npm only (no `pyproject.toml`, `Cargo.toml`, `go.mod` at repo root — pip-audit, cargo, govulncheck N/A for this plan)
- **Plan-declared deps audited:** 3/3 Existing + 0 NEW + 0 Removed + 1 internal cross-package (`@usetheo/memory` local — this repo itself)
- **Vulnerabilities found (npm audit):** 1 CRITICAL · 3 HIGH · 4 MODERATE · 0 LOW
- **Outdated (relevant to plan):** none blocking (vitest 4.1.7 → 4.1.8 within caret; resolves on next install)
- **Allowlist hits:** 8 active (0 expired) — every vuln finding maps to a pre-existing allowlist entry from prior cycles (`adapters-openrouter-local-embedder` + `v0-1-local-runtime` + `examples-chat-with-memory-v0-4b-expansion`) with sunset dates 2026-07-01 / 2026-08-01 / 2026-08-23 — all in active window relative to today
- **Plan-declared deps with vulnerabilities:** **ZERO** — all 8 findings are in transitive chains rooted at NON-plan-declared deps (`@xenova/transformers` via `adapters-openrouter-local-embedder` envelope + `drizzle-kit` devDep chain). This plan introduces neither.
- **Auditor coverage:** `npm audit`: ran (authoritative for npm); `osv-scanner`: SKIPPED (binary not installed at `/home/paulo/.local/bin`); `pip-audit` / `cargo audit` / `govulncheck`: N/A (no matching ecosystem at repo root)

## Plan validation (Mode 2)

The plan's `## Dependencies` section declares 3 Existing deps + 0 NEW + 0 Removed per Inquebrável Rule 11 (YAGNI) ceiling — bridge is implemented as a thin script over the EXISTING MCP surface (`@usetheo/memory/agent-tools`). Cross-reference:

| Plan dep | Section | package.json match | Installed (lockfile) | npm audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|
| `@usetheo/memory` (this repo, local) | Existing | n/a (this IS the repo; v0.0.0-rc.2) | n/a | n/a (internal cross-package import) | n/a (Existing) | OK |
| `pg` | Existing | yes (`^8.13.0` in `dependencies`) | yes | yes (no vuln) | n/a (Existing) | OK |
| `vitest` | Existing | yes (`^4.0.0` in `devDependencies`) | yes (4.1.7 — semver-compatible) | yes (no vuln) | n/a (Existing) | OK (MINOR drift 4.1.7 → 4.1.8 within caret; non-blocking) |

**Note**: The bridge (T1.1) also implicitly uses `@opentelemetry/api ^1.9.0` via the existing `emitEvent` infra inherited from `@usetheo/memory`. NOT declared explicitly in the plan's `## Dependencies` because the plan inherits the full envelope of the parent package; the bridge does not introduce a NEW import path. Acceptable per the principles-alignment-hardening precedent.

**Section completeness check:**
- [x] `## Dependencies` section present
- [x] `### Existing` subsection populated with table (3 rows)
- [x] `### New` subsection present and honestly populated with "None — Inquebrável Rule 11 (YAGNI). Bridge is implemented as a thin script over the existing MCP surface."
- [x] `### Removed` subsection present and populated with "None."
- [x] Version pins use exact semver caret notation; no `*` or `latest` wildcards
- [x] **NO `plan_new_dep_no_rule9_evaluation`** fires — there are no NEW deps to evaluate; the honest "None — YAGNI" + rationale satisfies the gate
- [x] Plan's `### Accepted Risks (inherited from v1.5.0 envelope)` subsection EXPLICITLY documents the 8 active allowlist CVEs — verdict surfaces them for cross-reference (NOT a NEW disclosure required by this audit; this is inheritance)

## Vulnerabilities (sorted by severity; all in pre-existing allowlist)

### CVE — CRITICAL · protobufjs `<=7.5.7` (transitive via @xenova/transformers chain)
- **GHSA:** `GHSA-xq3m-2v4x-88gg` — Arbitrary code execution in protobufjs via generated `toObject` code
- **Fixed in:** `protobufjs >= 7.5.8` (upstream depends on `@xenova/transformers` v3 line)
- **Path:** root → `@xenova/transformers ^2.17.0` → `onnxruntime-web@1.14.0` → `onnx-proto` → `protobufjs`
- **Allowlist status:** ACTIVE (entry at `deps-audit-allowlist.txt:52`; sunset `2026-07-01`; 27 days remaining)
- **Severity downgrade per allowlist:** CRITICAL → MEDIUM
- **Plan reference:** NOT a plan-declared dep. Inherited from `adapters-openrouter-local-embedder` cycle (2026-06-01). Plan's `### Accepted Risks` cell explicitly inherits this envelope.

### CVE — HIGH · protobufjs `<=7.5.7` (3 advisories, same transitive chain)
- **GHSAs (3):** `GHSA-66ff-xgx4-vchm` + `GHSA-75px-5xx7-5xc7` + `GHSA-jvwf-75h9-cwgg` (code injection + code generation prototype pollution variants)
- **Fixed in:** `protobufjs >= 7.5.8`
- **Allowlist status:** ACTIVE (entries at `deps-audit-allowlist.txt:53-56`; sunset `2026-08-01`; 58 days)
- **Severity downgrade per allowlist:** HIGH → LOW
- **Plan reference:** NOT plan-declared.

### CVE — HIGH/MODERATE · @xenova/transformers / onnxruntime-web / onnx-proto chain
- **Surface manifestations of the same protobufjs chain**
- **Allowlist status:** ACTIVE (entries at `deps-audit-allowlist.txt:58-60`; sunset `2026-07-01`; 27 days)
- **Plan reference:** NOT plan-declared.

### CVE — MODERATE · esbuild `<=0.24.2` AND @esbuild-kit/* AND drizzle-kit `^0.31.0`
- **GHSA:** `GHSA-67mh-4wv8-2f99` — esbuild dev-server-request-leak (CWE-200)
- **Allowlist status:** ACTIVE (entries at `deps-audit-allowlist.txt:37-40`; sunset `2026-08-23`; 80 days)
- **Severity downgrade per allowlist:** MODERATE → LOW
- **Plan reference:** `drizzle-kit` is the migration CLI used at T0.1 (`drizzle-kit generate` for snapshot creation) in the prior `principles-alignment-hardening` cycle — NOT this dogfood cycle. dogfood-anchor-scenario-launch does NOT touch migrations.

## Outdated (non-vulnerable, plan-relevant)

### npm: vitest 4.1.7 (installed) → 4.1.8 (latest) — MINOR
- **Type:** devDependency
- **Plan declaration:** `vitest ^4.0.0` (range covers 4.1.8 — no manifest change needed)
- **Diff suggestion:** OMITTED — within semver caret; `npm install` (or `npm update vitest`) picks up 4.1.8 automatically.

## Plan validation (additional cross-check)

| Hard cap stable identifier | Triggered? | Evidence |
|---|---|---|
| `plan_dep_critical_cve` | NO | None of the 3 plan-declared deps (`@usetheo/memory`, `pg`, `vitest`) have CRITICAL CVEs. CRITICAL `protobufjs` is transitive via `@xenova/transformers`, which is NOT plan-declared in THIS plan. |
| `plan_dep_high_cve` | NO | Same reasoning — no HIGH CVE on plan-declared deps. |
| `plan_dep_medium_cve` | NO | No MEDIUM CVE on plan-declared deps. |
| `plan_dependencies_section_missing` | NO | Section present in plan v1.1. |
| `plan_dep_version_unspecified` | NO | All 3 Existing deps have semver caret pins (or "this repo" for internal). |
| `plan_new_dep_no_rule9_evaluation` | NO | Zero NEW deps; honest "None — YAGNI" with rationale. |
| `plan_dep_not_on_registry` | NO | `pg` + `vitest` already in `package-lock.json`; registry existence verified by lockfile. `@usetheo/memory` is the repo itself. |
| `auditor_unavailable_osv-scanner` | ADVISORY ONLY | osv-scanner binary not installed; does NOT cap because npm audit IS the authoritative npm-ecosystem tool per skill SoT. |

## Cycle-specific dependency observations

This plan introduces ZERO npm dependencies but DOES introduce 2 NEW operational/runtime dependencies that are NOT typical npm package deps:

1. **MCP server `themory mcp` runtime** — T1.1 bridge spawns this per-invocation (per ADR D1 v1.1 EC-2 absorption). The bridge depends on the published `themory` CLI bin being on PATH OR a known relative path resolvable from the bridge's location. Per the plan, the binary lives at `./dist/agent-tools/cli.js` after `npm run build` (Inquebrável Rule 11 — re-use existing build output, no new toolchain).
   - **Risk**: If `npm run build` is not run before T2.1 smoke, bridge integration tests fail with ENOENT. T1.1 DoD MUST include `npm run build` as pre-step OR test setup MUST detect and build automatically.
   - **Not a deps-audit gate**: this is a build dependency, not a package dependency.

2. **Persistent pgvector container** — T1.2 + T3.1 + T4.* all require `themem_pgvector` container to be `up` continuously for 30 days. Existing `docker-compose.yaml` declares `pgdata` named volume (persistent across `compose down/up`). Per EC-13 absorption already in plan v1.1, the requirement is documented.
   - **Risk**: docker container lifecycle is NOT npm-managed; outside `/deps-audit` scope.
   - **Not a deps-audit gate**: operational dependency; covered by EC-13 documentation.

## Recommended next steps

1. **No manifest changes required** for this plan to proceed. The 3 declared deps are clean of vulnerabilities; outdated `vitest` is within caret.
2. **Allowlist sunset discipline**: the 4 protobufjs/Xenova entries sunset on `2026-07-01` (27 days). The dogfood-anchor-scenario-launch cycle's Phase A (~1-2 weeks) completes well before this date. Phase B (30-day soak) MAY extend past the sunset window — if so, the allowlist re-eval is OUT OF SCOPE for this plan but should be flagged for a follow-up `/deps-audit` cycle at sunset time. Phase B continues to run regardless; only the protobufjs CVE re-fires at full severity if sunset passes without `@xenova/transformers` v3 release.
3. **Optional (advisory)**: install osv-scanner for cross-ecosystem coverage when future plans add Python/Rust/Go deps. Not blocking THIS plan.
4. Proceed to `/plan-confidence dogfood-anchor-scenario-launch`. This audit returns PASS; no plan-confidence cap fires from this skill's verdict.

## Honesty disclosures (Inquebrável Rule 3)

- **osv-scanner cross-check not performed**. Skill SoT classifies it as "optional but recommended"; npm audit IS authoritative for npm. For a single-npm-ecosystem plan, this gap is advisory.
- **Allowlist windows are timed, not perpetual**. The PASS verdict assumes today (2026-06-04) is within each entry's sunset window. Tomorrow's audit re-runs would re-check.
- **Phase B 30-day soak overlaps with protobufjs allowlist sunset (2026-07-01)**. If the cycle runs from 2026-06-04 + (1-2 weeks Phase A) + (30 days Phase B), the cycle's end-date is roughly 2026-07-10 to 2026-07-17, ~10-17 days PAST sunset. The dogfood cycle DOES NOT depend on `@xenova/transformers` (bridge uses MCP stdio against existing `themory` CLI), so the CVE re-firing at sunset does NOT block dogfood Phase B. But it WILL block any other plan that depends on `@xenova/transformers` post-sunset. Flagged for cross-cycle awareness.
- **Transitive CRITICAL is present in the lockfile** (`protobufjs <= 7.5.7`). This audit does NOT hide it. The plan does NOT introduce it; the allowlist absorbs it (per active risk-envelope analysis at `deps-audit-allowlist.txt:48-50`).
- **All 3 plan-declared deps are in `package-lock.json`** at versions satisfying the declared caret ranges. Verified via `node` JSON inspection of `package.json`; `npm audit` ran successfully against the lockfile.

## Related

- Golden rule: [`.claude/rules/deps-audit-golden-rule.md`](../../rules/deps-audit-golden-rule.md)
- Allowlist consulted: [`.claude/rules/deps-audit-allowlist.txt`](../../rules/deps-audit-allowlist.txt) (lines 37-60 active)
- Plan: [`.claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md`](../plans/dogfood-anchor-scenario-launch-plan.md) v1.1 (2026-06-04 EC absorption)
- Edge-case review: [`dogfood-anchor-scenario-launch-edge-cases-2026-06-04.md`](../reviews/dogfood-anchor-scenario-launch-edge-cases-2026-06-04.md)
- Sibling cycle baseline: [`principles-alignment-hardening-deps-audit-2026-06-04.md`](./principles-alignment-hardening-deps-audit-2026-06-04.md) (same envelope; same allowlist)
- Next: `/plan-confidence dogfood-anchor-scenario-launch` — consume this verdict
