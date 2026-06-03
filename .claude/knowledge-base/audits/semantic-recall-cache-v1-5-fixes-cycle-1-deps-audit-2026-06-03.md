# Deps Audit: semantic-recall-cache-v1-5-fixes-cycle-1

**Date:** 2026-06-03
**Mode:** plan-bound (`semantic-recall-cache-v1-5-fixes-cycle-1`)
**Verdict:** **PASS_WITH_CAVEATS**
**Plan-confidence cap:** 89
**Hard caps triggered:** none

## Summary

- **Ecosystems detected:** npm (only; project is single-ecosystem TS/Node)
- **Auditor coverage:** `{ npm-audit: ran, npm-outdated: ran, osv-scanner: SKIPPED — binary not installed }`
- **Vulnerabilities found:** 1 CRITICAL, 3 HIGH, 4 MODERATE, 0 LOW = **8 total**
- **All 8 CVEs:** active allowlist entries with sunsets in range (earliest 2026-07-01) — DOWNGRADED by one severity per `deps-audit-golden-rule.md § Allowlist mechanism`
- **Outdated:** 9 major, 1 minor, 1 patch (pre-existing repo-wide; NOT introduced by this plan)
- **Plan-declared deps:** zero (Inquebrável Rule 11 YAGNI — Existing table reuses `pg` / `drizzle-orm` / `vitest` / OTel; New = None; Removed = None)

## Vulnerabilities (sorted by severity — all allowlisted)

| Severity | Package | Advisory | Chain root | Allowlist sunset |
|---|---|---|---|---|
| CRITICAL | `protobufjs` | GHSA-xq3m-2v4x-88gg | `@xenova/transformers ^2.17.0 → onnxruntime-web@1.14.0 → onnx-proto → protobufjs` | **2026-07-01** (28 days) |
| HIGH | `protobufjs` | GHSA-66ff-xgx4-vchm | same chain | 2026-08-01 (59 days) |
| HIGH | `protobufjs` | GHSA-75px-5xx7-5xc7 | same chain | 2026-08-01 |
| HIGH | `protobufjs` | GHSA-jvwf-75h9-cwgg | same chain | 2026-08-01 |
| HIGH | `protobufjs` | GHSA-685m-2w69-288q | same chain | 2026-08-01 |
| HIGH (umbrella) | `@xenova/transformers ^2.17.0` | GHSA-xq3m-2v4x-88gg | optionalDependency for `LocalTransformerEmbedder` | 2026-07-01 |
| HIGH (umbrella) | `onnxruntime-web` | GHSA-xq3m-2v4x-88gg | same chain | 2026-07-01 |
| HIGH (umbrella) | `onnx-proto` | GHSA-xq3m-2v4x-88gg | same chain | 2026-07-01 |
| MODERATE | `esbuild <=0.24.2` | GHSA-67mh-4wv8-2f99 | `drizzle-kit ^0.31.0 → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild` | 2026-08-23 (81 days) |
| MODERATE | `@esbuild-kit/core-utils` | GHSA-67mh-4wv8-2f99 | same chain | 2026-08-23 |
| MODERATE | `@esbuild-kit/esm-loader` | GHSA-67mh-4wv8-2f99 | same chain | 2026-08-23 |
| MODERATE | `drizzle-kit ^0.31.0` | GHSA-67mh-4wv8-2f99 | devDep (CLI-only; no dev-server invocation) | 2026-08-23 |

**After allowlist downgrade (active entries):**
- CRITICAL protobufjs → effective MEDIUM
- 4 HIGH protobufjs + 3 umbrella HIGHs → effective LOW
- 4 MODERATEs → effective LOW or below
- **Worst effective severity: MEDIUM (1 finding)** — but on a transitive/optionalDependency NOT touched by this plan

## Outdated (non-vulnerable, NOT touched by this plan)

9 MAJOR-outdated packages (`@apidevtools/swagger-parser`, `@hono/node-server`, `@hono/zod-openapi`, `@types/node`, `commander`, `eslint`, `openai`, `typescript`, `zod`) + 1 minor + 1 patch. **All pre-existing repo-wide debt — none introduced or required by this fix-up plan.** Diff suggestions OMITTED for MAJORs per skill SKILL.md anti-pattern #7 (review breaking changes first).

## Plan validation (Mode 2)

The plan's `## Dependencies` section declares:
- **Existing:** zero rows requiring validation (cell content: `(zero new deps required) — this cycle reuses the existing test surface, OTel API, pg, drizzle-orm, vitest`)
- **New:** None — Inquebrável Rule 11 (YAGNI) explicit
- **Removed:** None

No declared deps to cross-reference against manifest/registry/CVE database. The fix-up cycle's structural scope (tests + docs + 1 canary block extension to `applyDimChange` + JSDoc edits) does not require any new or upgraded packages.

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| (none declared) | — | n/a | n/a | n/a | **N/A** |

## Verdict reasoning

- **No hard caps triggered.** The plan does NOT introduce a new dep with unallowlisted CRITICAL/HIGH (`plan_dep_critical_cve` / `plan_dep_high_cve` do not fire). The plan does NOT declare a dep without a version pin (`plan_dep_version_unspecified` does not fire). The plan has a `## Dependencies` section structurally (`plan_dependencies_section_missing` does not fire). No NEW row exists to validate Rule 9 against (`plan_new_dep_no_rule9_evaluation` does not fire — vacuously).
- **Soft caveat: pre-existing allowlist backlog.** 8 active CVEs (all allowlisted with sunsets in range) form the inherited risk envelope from prior cycles (v0.1, examples-chat-with-memory-v0-4b-expansion, adapters-openrouter-local-embedder). The CRITICAL protobufjs entry has the tightest sunset (28 days from today — 2026-07-01). This caveat is REPO-WIDE pre-existing-debt and matches the v1.5.0 cycle's verdict — not a regression introduced by THIS plan.
- **Soft caveat: 9 outdated MAJORs untouched.** Same envelope; not introduced; not required for this cycle's scope.

**Per `deps-audit-golden-rule.md`:** none of the 5 INVALID_PLAN_DEPS triggers fires. The PASS_WITH_CAVEATS verdict (cap 89) reflects the inherited backlog without penalizing the plan itself.

## Recommended next steps

1. **No manifest changes required for this cycle.** The plan ships zero new/upgraded deps by design.
2. **Track the 2026-07-01 protobufjs CRITICAL sunset.** When the sunset window closes (28 days), `@xenova/transformers` v3 must have landed (upstream tracking at `https://github.com/xenova/transformers.js/issues`) OR a dep-replacement plan (e.g., `fastembed-js` Rule 9 re-evaluation) must be authored. This is a separate concern from THIS plan.
3. **Proceed to `/plan-confidence` re-run.** With this PASS_WITH_CAVEATS verdict the plan-confidence cap of 89 is honored; the prior structural score of 91.2 (SHIPPABLE) drops to 89 (SHIPPABLE_WITH_CAVEATS) when this audit's caveat is composed in. Both bands unblock `/implement`.

## References

- Golden rule: `.claude/rules/deps-audit-golden-rule.md`
- Allowlist: `.claude/rules/deps-audit-allowlist.txt` (entries cited: esbuild chain 2026-08-23 + protobufjs chain 2026-07-01/2026-08-01)
- Source plan v1.5.0 audit: `.claude/knowledge-base/audits/semantic-recall-cache-v1-5-deps-audit-2026-06-03.md` (same envelope; verdict was also PASS_WITH_CAVEATS — no regression)
- Prior cycles' allowlist additions:
  - v0.1 cycle (drizzle-kit esbuild chain): `.claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § ADR D1.10`
  - examples-chat-with-memory-v0-4b-expansion (next/postcss chain — NOT in this audit because the demo is gated by its own integration tests): plan v1.1
  - adapters-openrouter-local-embedder (protobufjs chain): plan v1.1 + `/implement` iter 4 halt report
