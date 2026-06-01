# Deps Audit: adapters-stub-embedder-llm-cycle-1-fixes

**Date:** 2026-06-01
**Mode:** plan-bound:adapters-stub-embedder-llm-cycle-1-fixes
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** (none — `plan_dependencies_section_missing` does NOT fire because plan introduces/uses/removes no deps per golden rule scope wording)
**Soft caps:** 1 (4 pre-existing allowlisted MODERATE; carry-forward from source cycle audit `2026-06-01`; sunset 2026-08-23 unchanged)

## Summary

- **Ecosystems detected:** npm (root repo only — plan touches NO `package.json` deps)
- **Plan dep delta:** ZERO. The plan modifies: `tsconfig.build.json` (config), `CHANGELOG.md` (doc), `.claude/knowledge-base/implementations/*.md` (audit), `.claude/knowledge-base/reviews/*.md` (audit), `src/embedders/stub.ts` (cosmetic + JSDoc), `src/embedders/index.ts` (JSDoc), `src/llms/stub.ts` (1 strip-prefix line + JSDoc), `src/llms/index.ts` (JSDoc), `src/embedders/__tests__/*` (tests), `src/llms/__tests__/*` (tests), `tests/integration/publish-readiness.test.ts` (test). NONE of these are manifests; `package.json` is NOT in the file list.
- **Vulnerabilities found:** 0 CRITICAL, 0 HIGH, 4 MODERATE (pre-existing + allowlisted active; identical set to source cycle audit), 0 LOW
- **Outdated:** 6 dev-only packages with bumps available (4 MAJOR + 1 MINOR + 1 PATCH); plan introduces NO new deps so MAJOR bumps are out of scope
- **Allowlist hits:** 4 ACTIVE (esbuild chain via drizzle-kit, sunset 2026-08-23); 0 EXPIRED
- **Auditor coverage:** `{ npm-audit: ran (exit 0), npm-outdated: ran (exit 0), osv-scanner: SKIPPED (binary not installed — npm-audit authoritative for npm), pip-audit: N/A (no Python), cargo-audit: N/A (no Rust), govulncheck: N/A (no Go) }`

## Vulnerabilities (sorted by severity)

### GHSA-67mh-4wv8-2f99 — MODERATE (npm: esbuild <=0.24.2)

- **Path:** root → `drizzle-kit ^0.31.0` (devDep) → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`
- **Direct?** No — transitive via `drizzle-kit` (devDep only)
- **CVSS:** 5.3 (`AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N`); CWE-346 (Origin Validation Error)
- **Title:** "esbuild enables any website to send any requests to the development server and read the response"
- **Allowlist status:** **ACTIVE** (sunset 2026-08-23) per `.claude/rules/deps-audit-allowlist.txt:37`
- **Pre-existing?** YES — present since v0.1 (`b98fc80`) at first `drizzle-kit` install. NOT introduced by this plan.
- **Severity post-allowlist:** downgraded to LOW per golden rule § Allowlisted findings.
- **Risk envelope for this plan:** ZERO. Plan does not modify drizzle-kit, esbuild, or any related dep. CVE surface is byte-identical to source cycle.
- **Fix path:** drizzle-kit upstream must migrate to `tsx` (deprecated `@esbuild-kit` chain merged upstream into tsx). Track via https://github.com/drizzle-team/drizzle-orm/issues. Re-audit at sunset.

### + 3 sibling MODERATE findings (same root cause)

| Package | Status | Allowlist line | Severity post-allowlist |
|---|---|---|---|
| `@esbuild-kit/core-utils` (deprecated) | transitive of drizzle-kit | line 38 | LOW |
| `@esbuild-kit/esm-loader` (deprecated) | transitive of drizzle-kit | line 39 | LOW |
| `drizzle-kit ^0.31.0` (devDep direct) | surface manifestation | line 40 | LOW |

All allowlisted with sunset **2026-08-23** (same audit-trail). Same risk envelope: ZERO impact on this plan.

## Outdated (non-vulnerable — out of scope for this plan)

| Package | Current | Wanted | Latest | Semver delta | Status |
|---|---|---|---|---|---|
| `@types/node` | 20.19.41 | 20.19.41 | 25.9.1 | MAJOR (×5) | Pinned to Node 20 engine; bump deferred to v0.5+ Node 22 upgrade |
| `eslint` | 9.39.4 | 9.39.4 | 10.4.1 | MAJOR | Out of scope for this fix-up cycle |
| `typescript` | 5.9.3 | 5.9.3 | 6.0.3 | MAJOR | Out of scope for this fix-up cycle |
| `typescript-eslint` | 8.59.4 | 8.60.0 | 8.60.0 | PATCH | Could bump; cosmetic |
| `vitest` | 4.1.7 | 4.1.8 | 4.1.8 | PATCH | Could bump; cosmetic |
| `zod` | 3.25.76 | 3.25.76 | 4.4.3 | MAJOR | Direct dep; zod v4 has breaking changes. Out of scope for fix-up cycle. |

**Diff suggestions:** NONE applied — plan is read-only on `package.json`. Each MAJOR bump is its own deliberation tracked by Renovate (or future strategic review).

## Plan validation (Mode 2)

The plan's `## Dependencies` section was inspected.

| Validation | Result |
|---|---|
| `## Dependencies` section present? | **NO** — the section does not exist in `adapters-stub-embedder-llm-cycle-1-fixes-plan.md` |
| Plan introduces/uses/removes any dep? | **NO** — verified by `grep -nE "package\.json[^/]|new dep|dependencies|optionalDependencies" plan`: no `package.json` modification declared anywhere; all 10 tasks edit configs/audit-trail/source-JSDoc/tests; zero `npm install` invoked |
| Golden rule §1 `plan_dependencies_section_missing` triggered? | **NO** — the rule wording is "Every plan that introduces, uses, or removes a dependency MUST declare it explicitly". This plan does NONE of these. The section is permitted to be absent. |
| Inquebrável Rule 9 (Não Reinvente) compliance? | **N/A** — no new code surface that could reinvent anything; pure fix-up of existing surfaces |

**Validation result:** OK with soft cap (see § "Recommended next steps" item 2).

## Soft cap rationale

`soft_floor_pre_existing_allowlisted_moderate` — 4 pre-existing MODERATE findings carry forward from source cycle audit. Per golden rule § "Soft gates" the allowlist downgrade applies (CVE-level severity now LOW); composite verdict caps at PASS_WITH_CAVEATS (cap 89) because the source cycle is in the same posture and we're not regressing OR improving the supply-chain hygiene. **This is identical to the source cycle's posture** — same 4 entries, same sunset.

## Recommended next steps

1. **No manifest changes required** — proceed to `/plan-confidence adapters-stub-embedder-llm-cycle-1-fixes` directly.
2. **OPTIONAL — add explicit `## Dependencies` section to the fix-up plan for portfolio consistency.** Even though the golden rule does NOT require it (plan introduces no deps), the source cycle's plan DID include a `(none)` section per the `/edge-case-plan` precedent. Adding `## Dependencies` with rows:
   - Existing: `(none — uses Node built-ins only; surface unchanged from source cycle)`
   - New: `(none — pure fix-up cycle; zero new deps by design)`
   - Removed: `(none)`
   would mirror the source cycle audit shape. **Not blocking;** SOFT recommendation only.
3. **DO NOT bump** the 6 outdated packages as part of THIS plan — each MAJOR bump (zod 3→4, typescript 5→6, eslint 9→10, @types/node 20→25) is its own deliberation. Track separately via Renovate / future strategic review.
4. **Re-audit before sunset 2026-08-23** — verify drizzle-kit upstream migrated to tsx OR extend allowlist with new rationale.

## Comparison vs source cycle audit (2026-06-01)

| Metric | Source cycle | This fix-up cycle | Delta |
|---|---|---|---|
| Verdict | PASS | PASS_WITH_CAVEATS | -1 band (soft floor — see rationale above; actually IDENTICAL posture) |
| Hard caps | 0 | 0 | unchanged |
| Total CVE findings | 4 MODERATE | 4 MODERATE | unchanged (same 4 entries) |
| Allowlist active | 4 (sunset 2026-08-23) | 4 (sunset 2026-08-23) | unchanged |
| Plan introduces deps? | NO (`(none)` section) | NO (section absent — recommendation #2) | shape divergence only |
| Outdated MAJOR | not enumerated | 4 dev-only out-of-scope | informational only |
| `package.json` modified? | YES (added 4 subpath exports — T2.1) | NO | reduced surface |

**Note:** the verdict band difference (PASS vs PASS_WITH_CAVEATS) is purely a presentation choice — the source cycle interpreted its 4 allowlisted findings as not triggering a soft floor (consistent with the `/plan-confidence` SHIPPABLE 96.8 verdict that the source cycle reached); this fix-up audit applies the soft floor more conservatively for honesty. Operationally identical risk.

## What this audit does NOT cover (honest gaps)

- `examples/chat-with-memory/package.json` (demo manifest) — NOT audited because this plan does NOT touch the demo. The chat-with-memory cycles audit it separately.
- `osv-scanner` cross-check — binary not installed in this runtime; `npm-audit` is authoritative per its GitHub Advisory dataset for npm ecosystem. Per golden rule § Anti-pattern #6, the gap is surfaced rather than fabricated. Adds no incremental risk for this plan (zero new deps).
- Supply-chain provenance (SLSA attestations, sigstore) — out of scope for M1 deps-audit.

## Verdict statement

**PASS_WITH_CAVEATS.** Plan introduces zero new dependencies, does not modify `package.json`, and does not change the CVE surface. The 4 pre-existing MODERATE findings (drizzle-kit esbuild chain) remain allowlisted with sunset 2026-08-23 unchanged. `/plan-confidence` will not cap below 89 due to deps; the fix-up cycle is dep-safe to proceed.

Stable identifier of soft cap (audit trail): `soft_floor_pre_existing_allowlisted_moderate` (compositional inheritance from source cycle's allowlist posture; not a new risk).
