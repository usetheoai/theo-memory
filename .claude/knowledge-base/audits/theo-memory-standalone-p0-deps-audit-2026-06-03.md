# Deps Audit: theo-memory-standalone-p0

**Date:** 2026-06-03
**Mode:** plan-bound (`/deps-audit theo-memory-standalone-p0`)
**Plan:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md` v1.1
**Verdict:** **PASS_WITH_CAVEATS** (plan-confidence cap 89 SHIPPABLE_WITH_CAVEATS)
**Hard caps triggered:** none
**Soft caps triggered:** `plan_dep_major_outdated_unpinned` × 4

## Summary

- Ecosystems detected: **npm** (single — no Python/Rust/Go in repo)
- Total deps audited:
  - Existing plan-declared: **4** (manifest cross-checked — all match)
  - NEW plan-declared: **6** (npm registry cross-checked — all present)
  - Existing manifest deps NOT touched by plan: ~22 direct (untouched)
- Vulnerabilities in current manifest (BEFORE plan): **16 total**
  - 9 CRITICAL (all protobufjs chain via @xenova/transformers optional dep — pre-existing, NOT introduced by plan)
  - 3 HIGH (same chain)
  - 4 MODERATE (esbuild via drizzle-kit dev-only + postcss via next in examples/)
- Vulnerabilities in plan-declared deps: **0** at declared versions
- Outdated plan deps (MAJOR): **4** (see soft caps below)
- Allowlist hits: 12 active (sunset 2026-07-01 → 2026-08-29); **4 pre-existing protobufjs advisories NOT in allowlist** (gap surfaced honestly — see § Pre-existing manifest state)
- Auditor coverage:
  - `npm audit`: ✅ ran (GitHub Advisory data — authoritative for npm)
  - `osv-scanner`: ⚠️ NOT installed (cross-check across OSV.dev DB unavailable; not capping per anti-pattern reading — npm audit is authoritative for the ecosystem)
  - `pip-audit` / `govulncheck` / `cargo audit`: n/a (no Python/Rust/Go manifests)

## Plan validation

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Outdated | Verdict |
|---|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk@^1.29.0` | Existing | yes (^1.29.0) | yes | n/a | no | OK |
| `pg@^8.13.0` | Existing | yes (^8.13.0) | yes | n/a | no | OK |
| `drizzle-orm@^0.45.0` | Existing | yes (^0.45.0) | yes | n/a | no | OK |
| `zod@^3.25.0` | Existing | yes (^3.25.0) | yes | n/a | **MAJOR** (4.4.3 available) | OK — pinned via plan v1.1 ADR D7 (inherited from v1-1-multi-peer plan v1.2) |
| `hono@^4.6.0` (NEW) | New | n/a (to add) | yes (no CVE on 4.6.x) | yes (Express/Fastify/Hono eval) | no (4.12.x latest within ^4) | OK |
| `@hono/node-server@^1.13.0` (NEW) | New | n/a (to add) | yes (no CVE on 1.13.x) | partial (justified as "official Node adapter" but no v1-vs-v2 eval) | **MAJOR** (2.0.4 available) | ⚠️ SOFT CAP `plan_dep_major_outdated_unpinned` |
| `@hono/zod-openapi@^0.18.0` (NEW) | New | n/a (to add) | yes (no CVE on 0.18.x) | partial (justified vs `@asteasolutions/zod-to-openapi` but no 0.18-vs-1.x eval) | **MAJOR** (1.4.0 available — semver pre-1 → 1.x bump) | ⚠️ SOFT CAP `plan_dep_major_outdated_unpinned` |
| `commander@^12.1.0` (NEW) | New | n/a (to add) | yes (no CVE on 12.x) | partial (justified vs citty/yargs but no v12-vs-v15 eval) | **MAJOR** (15.0.0 available) | ⚠️ SOFT CAP `plan_dep_major_outdated_unpinned` |
| `strip-ansi@^7.1.0` (NEW) | New | n/a (to add — dev) | yes (no CVE on 7.x) | yes (chalk vs hand-roll vs strip-ansi eval) | no (7.2.0 within ^7) | OK |
| `@apidevtools/swagger-parser@^10.1.1` (NEW) | New | n/a (to add — dev) | yes (no CVE on 10.x) | partial (justified vs ajv/hand-roll but no v10-vs-v12 eval) | **MAJOR** (12.1.0 available) | ⚠️ SOFT CAP `plan_dep_major_outdated_unpinned` |

## Soft caps detail

### 4× `plan_dep_major_outdated_unpinned` (each caps plan-confidence at 89)

| Dep | Plan version | Latest available | Delta | Why it fires |
|---|---|---|---|---|
| `@hono/node-server` | ^1.13.0 | 2.0.4 | v1 → v2 | Plan v1.1 ADR D1 mentions "canonical adapter; aligned with `hono` major version" but does NOT explicitly defer v2 with rationale + sunset. |
| `@hono/zod-openapi` | ^0.18.0 | 1.4.0 | pre-1 → 1.x | Plan v1.1 ADR D1 specifies version aligned with hono ^4.6 per EC-18 but ^0.18 is a SEMVER PRE-RELEASE (0.x — no semver-stability guarantee per `architecture.md`). 1.4.0 is the stable major. |
| `commander` | ^12.1.0 | 15.0.0 | v12 → v15 | Plan v1.1 ADR D4 cites "100M+ weekly downloads" but doesn't pin rationale vs v15. v15 released 2024 with documented breaking changes (action handler signature). |
| `@apidevtools/swagger-parser` | ^10.1.1 | 12.1.0 | v10 → v12 | Plan v1.1 § Dependencies cites "canonical OpenAPI parser" but doesn't pin rationale vs v12. v11 + v12 introduced ESM-only + dep updates. |

**Cumulative effect:** 4 soft caps each cap at 89. Per `plan-confidence-golden-rule.md`, multiple soft caps don't compound — the worst applies. Plan-confidence will cap at **89 SHIPPABLE_WITH_CAVEATS** unless the plan absorbs explicit ADR pinning rationale (mirror of zod ^3.25.0 D7) OR bumps to latest.

## Recommended next steps

Three resolution paths (user decides per § Workflow):

### Path A — Bump all 4 deps to latest in plan v1.1 → v1.2

Trade-off: API changes between majors require validation. Specifically:
- `@hono/node-server 1.x → 2.x`: API mostly stable per upstream changelog; `serve()` signature unchanged for our usage. **LOW risk.**
- `@hono/zod-openapi 0.18 → 1.4`: stable major release; `createRoute` API renamed/reorganized per upstream changelog. **MEDIUM risk** — touches every handler.
- `commander 12 → 15`: action handler now async-first; some method renames. **MEDIUM risk** — touches CLI scaffold.
- `@apidevtools/swagger-parser 10 → 12`: ESM-only in 11+; v12 changed dep tree. **LOW risk** — used only in tests.

Effort: ~30-60 min of API migration + RED test re-verification.

### Path B — Keep current pins + add ADR D14 (mirror zod ^3.25.0 D7)

Add new ADR pinning rationale + sunset date for each:
- `@hono/node-server ^1.13.0` — defer v2 to next cycle; sunset 90 days
- `@hono/zod-openapi ^0.18.0` — defer 1.x; sunset 90 days
- `commander ^12.1.0` — defer 15.x; sunset 90 days
- `@apidevtools/swagger-parser ^10.1.1` — defer v12; sunset 90 days

Effort: ~5 min ADR amendment. **Caps stay at 89 SHIPPABLE_WITH_CAVEATS — acceptable per cycle-plan Soft gates.**

### Path C — Mixed: bump 2, justify 2

- **Bump** `@hono/zod-openapi 0.18 → 1.4` (pre-1.0 isn't semver-stable; safer on 1.x)
- **Bump** `@hono/node-server 1.x → 2.x` (aligned with `hono ^4.6` major)
- **Justify-pin** `commander ^12.1.0` (action handler v15 changes don't help us)
- **Justify-pin** `@apidevtools/swagger-parser ^10.1.1` (dev-only test dep; v10 sufficient)

Effort: ~15 min mixed.

## Pre-existing manifest state (NOT introduced by plan — surfaced honestly per Rule 3)

These vulnerabilities exist in `package.json` BEFORE this plan; the plan does NOT declare any of the affected packages. Per `deps-audit-golden-rule.md § Severity rubric`, only CVEs in plan-declared deps trigger plan caps. Pre-existing CVEs are reported but don't gate this plan's verdict.

### Allowlisted (12 entries — within sunset)

- `protobufjs <=7.5.7` (5 advisories: GHSA-xq3m, GHSA-66ff, GHSA-75px, GHSA-jvwf, GHSA-685m) — sunset 2026-07-01 → 2026-08-01 — chain via `@xenova/transformers` ^2.17.0
- `@xenova/transformers` + `onnxruntime-web` + `onnx-proto` — same chain, sunset 2026-07-01
- `esbuild <=0.24.2` + `@esbuild-kit/*` + `drizzle-kit ^0.31.0` — sunset 2026-08-23 (MODERATE dev-server-leak)
- `postcss <8.5.10` + `next ^15.5.18` — sunset 2026-08-29 (MODERATE XSS in examples/)

### **NOT allowlisted (gap — pre-existing protobufjs chain noise — 4 advisories)**

The following protobufjs CRITICAL advisories surface via npm audit but are **NOT yet in `.claude/rules/deps-audit-allowlist.txt`**:

- **GHSA-2pr8-phx7-x9h3** — protobufjs CRITICAL (untracked)
- **GHSA-fx83-v9x8-x52w** — protobufjs CRITICAL (untracked)
- **GHSA-q6x5-8v7m-xcrf** — protobufjs CRITICAL (untracked)
- **GHSA-jggg-4jg4-v7c6** — protobufjs CRITICAL (untracked)

These are **same root cause** as the 5 allowlisted protobufjs entries (chain through `@xenova/transformers ^2.17.0` → `onnxruntime-web@1.14.0` → vulnerable protobufjs). They're newly-disclosed advisories on the same dep chain. **Same risk envelope** as the allowlisted ones (model-warmup-time only; runtime inference does not pipe user input through protobufjs).

**Recommendation (out of scope for this plan, separate housekeeping):** add the 4 missing advisories to the allowlist with same sunset 2026-07-01 + same rationale as existing protobufjs entries. This is a `/loop 7d /deps-audit` periodic discipline — NOT a blocker for `theo-memory-standalone-p0`.

## Auditor coverage gap (honest disclosure per Rule 3)

- **`osv-scanner` not installed** in the dev environment. `npm audit` covers GitHub Advisory Database which is authoritative for npm. OSV.dev cross-check would catch any non-GHA advisories. Per `deps-audit/SKILL.md § Step 2` anti-pattern #6, the warning is about "osv-scanner alone" — we're using npm audit alone instead, which IS authoritative for npm. No soft cap fired.
- **Renovate/Dependabot**: passive infra not configured (out of scope per skill).

## Honest disclosures (Inquebrável Rule 3)

1. **Plan author guessed 4 of 6 NEW dep versions without verifying latest on npm registry** — this audit caught the gap. Future plan-author discipline: `npm view PACKAGE version` BEFORE writing version into plan.
2. **`@hono/zod-openapi ^0.18.0` is a pre-1.0 SEMVER-UNSTABLE major** — per `architecture.md` discipline, pre-1.0 deps should carry explicit ADR justification. Path A/B/C all address this.
3. **`commander ^12.1.0` introduces a behavioral risk** — v13/v14/v15 each documented some action-handler signature changes. Bumping later requires re-validation of all 4 subcommands.
4. **Pre-existing protobufjs advisories gap is NOT a blocker for THIS plan** — but is a real allowlist hygiene gap that should be tracked separately.

## Handoff to /plan-confidence

`/plan-confidence theo-memory-standalone-p0` will:
- Read `## Dependencies` from plan v1.1 → confirms structural shape OK
- Consume THIS audit report → soft cap `plan_dep_major_outdated_unpinned` × 4 → caps at 89 SHIPPABLE_WITH_CAVEATS
- Cross-check Coverage Matrix (85 rows, 100% per v1.1) → no hard cap
- Cross-check ADR alternatives (13 ADRs each with ≥3 alternatives per v1.1) → no hard cap
- Final verdict expected: **SHIPPABLE_WITH_CAVEATS** (band 70-89) unless 4 soft caps + cumulative smell density push lower

**To raise verdict to SHIPPABLE (90+):** absorb Path A (bump) OR Path B (pin ADR D14) OR Path C (mixed) into plan v1.1 → v1.2. Path B is the cheapest (matches zod ^3.25.0 D7 idiom).
