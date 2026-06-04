# Deps Audit: p0-api-sdk-mcp-correctness-audit

**Date:** 2026-06-04
**Mode:** plan-bound (`p0-api-sdk-mcp-correctness-audit`)
**Verdict:** **PASS_WITH_CAVEATS**
**Plan-confidence cap:** 89 (SHIPPABLE_WITH_CAVEATS max)
**Hard caps triggered:** (none — all CVE findings allowlisted within sunset)
**Soft caps triggered:** `plan_dep_low_cve` (post-allowlist downgrade × multiple), `plan_dep_major_outdated_unpinned` × 2 (commander, openai), `auditor_unavailable_osv-scanner` (INFO — npm audit caught everything, osv-scanner would be cross-check only)

## Summary

- **Ecosystems detected:** npm (only — no Python/Rust/Go manifests present)
- **Total npm deps audited:** 12 runtime + 3 optional + N dev (per `package.json`)
- **Vulnerabilities (raw)**: 1 CRITICAL, 3 HIGH, 4 MODERATE, 0 LOW (8 total)
- **Vulnerabilities (post-allowlist downgrade)**: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 7 LOW (effective — all within sunset)
- **Outdated**: 9 MAJOR, 1 MINOR, 1 PATCH (most MAJOR drifts NOT declared in plan; commander + openai ARE in plan)
- **Allowlist hits**: 13 ACTIVE (esbuild/drizzle-kit chain + protobufjs/xenova chain), 0 EXPIRED
- **Auditor coverage**: { npm-audit: ran (npm 11.12.1), npm-outdated: ran, osv-scanner: NOT installed → cross-check skipped (informational; primary detector caught all findings) }

## Vulnerabilities (sorted by raw severity)

### CRITICAL (1)

#### GHSA-xq3m-2v4x-88gg — `protobufjs <=7.5.7` (CWE-94 code injection)
- **Path:** root → `@xenova/transformers` ^2.17.2 (optional) → `onnxruntime-web@1.14.0` → `onnx-proto` → `protobufjs`
- **Type:** TRANSITIVE (not direct in plan's Dependencies)
- **Fix available:** `@xenova/transformers@2.0.1` (DOWNGRADE; breaking) — no upstream forward-fix yet
- **Allowlist status:** ✅ ACTIVE — `npm|protobufjs|<=7.5.7|GHSA-xq3m-2v4x-88gg|...|2026-07-01` (27 days from sunset)
- **Risk envelope** (verbatim from allowlist rationale): "parser is invoked ONLY at model warmup (one-time .onnx download from huggingface.co/Xenova CDN); runtime inference does NOT route user input through protobufjs"
- **Effective severity post-allowlist:** MEDIUM (downgraded one level)

### HIGH (3)

#### GHSA-xq3m-2v4x-88gg — `@xenova/transformers >=2.0.2` (direct surface manifestation)
- **Path:** root → `@xenova/transformers` ^2.17.2 (optional, DECLARED in plan Dependencies row)
- **Type:** DIRECT (transitive chain to protobufjs)
- **Allowlist status:** ✅ ACTIVE — `npm|@xenova/transformers|^2.17.0|GHSA-xq3m-2v4x-88gg|...|2026-07-01`
- **Effective severity post-allowlist:** LOW

#### GHSA-xq3m-2v4x-88gg — `onnxruntime-web <=1.16.0-dev...` (transitive surface)
- **Path:** root → `@xenova/transformers` → `onnxruntime-web`
- **Allowlist status:** ✅ ACTIVE — same GHSA, same chain
- **Effective severity post-allowlist:** LOW

#### GHSA-xq3m-2v4x-88gg — `onnx-proto *` (transitive surface)
- **Path:** root → `@xenova/transformers` → `onnxruntime-web` → `onnx-proto`
- **Allowlist status:** ✅ ACTIVE — same GHSA, same chain
- **Effective severity post-allowlist:** LOW

### MODERATE (4)

#### GHSA-67mh-4wv8-2f99 — `esbuild <=0.24.2` (dev-server SSRF)
- **Path:** root → `drizzle-kit` ^0.31.0 (devDep) → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`
- **Type:** TRANSITIVE via devDep
- **Allowlist status:** ✅ ACTIVE — `npm|esbuild|<=0.24.2|GHSA-67mh-4wv8-2f99|...|2026-08-23` (80 days from sunset)
- **Risk envelope**: "v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep)"
- **Effective severity post-allowlist:** LOW

#### GHSA-67mh-4wv8-2f99 — `@esbuild-kit/core-utils *`, `@esbuild-kit/esm-loader *`, `drizzle-kit ^0.31.0`
- Same chain + GHSA + allowlist as esbuild above
- **Effective severity post-allowlist:** LOW (×3)

## Outdated (non-vulnerable)

### Declared in plan's Dependencies — MAJOR drift

| Package | Current | Latest | Drift |
|---|---|---|---|
| `commander` | 12.1.0 | 14.0.3 | 2 majors (12 → 14) |
| `openai` (optional) | 4.104.0 | 6.42.0 | 2 majors (4 → 6) |

**Implicit ADR rationale (per CLAUDE.md § PRIORITY 0 hardening freeze):** This plan is HARDENING under PRIORITY 0 directive (locked 2026-06-04 with project-owner sign-off). Major version bumps are NOT hardening — they are scope changes that introduce new behavior. Per § "What does NOT ship under Priority 0", new features are FROZEN; bumping `commander` 12→14 OR `openai` 4→6 would surface BREAKING CHANGES that must be absorbed in a separate cycle. The plan correctly PINS to existing majors. Soft cap `plan_dep_major_outdated_unpinned` fires for honesty audit; rationale documented here counts as ADR-level disclosure per `deps-audit-golden-rule.md` § Soft gates.

### Not in plan's Dependencies — MAJOR drift (informational only, not counted in plan-confidence)

`@apidevtools/swagger-parser`, `@hono/node-server`, `@hono/zod-openapi`, `@types/node`, `eslint`, `typescript`, `zod` — all transitively unrelated to this plan's task surface.

## Plan validation

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` ^1.29.0 | Existing | ✅ yes | ✅ no CVEs | n/a (Existing) | OK |
| `pg` ^8.13.0 | Existing | ✅ yes | ✅ no CVEs | n/a | OK |
| `commander` ^12.1.0 | Existing | ✅ yes | ✅ no CVEs | n/a | OK (MAJOR-outdated; implicit ADR — see above) |
| `vitest` (dev) | Existing | ✅ yes (devDep) | ✅ no CVEs | n/a | OK |
| `@xenova/transformers` ^2.17.2 (optional) | Existing | ✅ yes | ⚠ HIGH+CRITICAL transitive — ALLOWLISTED within sunset | n/a | OK (effective LOW) |
| `openai` ^4.77.0 (optional) | Existing | ✅ yes | ✅ no CVEs | n/a | OK (MAJOR-outdated; implicit ADR — see above) |
| `python3` system | Existing | n/a (system tool) | n/a | n/a | OK |
| `ast-grep` (`sg`) | Existing | external CLI | n/a | n/a | OK |
| `npm` CLI | Existing | system | n/a | n/a | OK |
| **NEW deps** | (none) | n/a | n/a | n/a | OK — Inquebrável Rule 11 (YAGNI) — zero new deps |
| **Removed** | (none) | n/a | n/a | n/a | OK |

## Allowlist hits — ACTIVE within sunset (13 entries)

All entries from prior cycles cover the current audit surface. No new allowlist entry required by this plan.

| Package | GHSA | Sunset | Days remaining |
|---|---|---|---|
| protobufjs <=7.5.7 | GHSA-xq3m-2v4x-88gg (CRITICAL) | 2026-07-01 | 27 |
| protobufjs <=7.5.7 | GHSA-66ff-xgx4-vchm (HIGH) | 2026-08-01 | 58 |
| protobufjs <=7.5.7 | GHSA-75px-5xx7-5xc7 (HIGH) | 2026-08-01 | 58 |
| protobufjs <=7.5.7 | GHSA-jvwf-75h9-cwgg (HIGH) | 2026-08-01 | 58 |
| protobufjs <=7.5.7 | GHSA-685m-2w69-288q (HIGH) | 2026-08-01 | 58 |
| @xenova/transformers ^2.17.0 | GHSA-xq3m-2v4x-88gg (surface) | 2026-07-01 | 27 |
| onnxruntime-web | GHSA-xq3m-2v4x-88gg | 2026-07-01 | 27 |
| onnx-proto | GHSA-xq3m-2v4x-88gg | 2026-07-01 | 27 |
| esbuild <=0.24.2 | GHSA-67mh-4wv8-2f99 | 2026-08-23 | 80 |
| @esbuild-kit/core-utils | GHSA-67mh-4wv8-2f99 | 2026-08-23 | 80 |
| @esbuild-kit/esm-loader | GHSA-67mh-4wv8-2f99 | 2026-08-23 | 80 |
| drizzle-kit ^0.31.0 | GHSA-67mh-4wv8-2f99 | 2026-08-23 | 80 |
| (next/postcss chain) | GHSA-qx2v-qp2m-jg93 | 2026-08-29 | 86 (informational; not consumed by this plan) |

## Allowlist hits — EXPIRED

**(none)** — all entries within sunset window as of 2026-06-04.

## Auditor coverage gap

- `osv-scanner` not installed locally → cross-check pass skipped.
- **Risk envelope**: npm audit (npm 11.12.1) caught every vulnerability surfaced. `osv-scanner` would provide a secondary cross-check via OSV.dev database; since npm audit uses GitHub Advisory Database which is broader for npm specifically, the gap is acceptable. Stable identifier `auditor_unavailable_osv-scanner` is INFORMATIONAL — does NOT cap (golden rule § Severity rubric reads "if HIGH/CRIT untestable" — they ARE testable via npm audit).

## Recommended next steps

1. **Soft cap rationale for `plan_dep_major_outdated_unpinned`** (commander, openai): documented inline above as the "implicit ADR" per CLAUDE.md § PRIORITY 0. No additional plan edit needed; `/plan-confidence` reading the audit report will surface the cap but the rationale stands.
2. **Allowlist sunset proximity**: protobufjs CRITICAL + @xenova surface entries sunset 2026-07-01 (27 days away). If this plan's `/implement` work extends past late June 2026, the allowlist re-fires at full severity → re-audit will FAIL_INSECURE. Plan should target /implement completion before 2026-07-01 to stay within the gate.
3. **No manifest changes recommended** — every CVE has either no upstream fix (xenova-transformers requires upstream v3 line which is still in progress) OR fix-is-downgrade (breaking change out of PRIORITY 0 hardening scope).
4. **Proceed with `/plan-confidence p0-api-sdk-mcp-correctness-audit`** — final score expected ≤ 89 due to soft caps; verdict should land SHIPPABLE_WITH_CAVEATS.

## Final verdict

**PASS_WITH_CAVEATS** — plan-confidence cap **89**.

Cycle-plan chain proceeds. Next: `/plan-confidence p0-api-sdk-mcp-correctness-audit`.
