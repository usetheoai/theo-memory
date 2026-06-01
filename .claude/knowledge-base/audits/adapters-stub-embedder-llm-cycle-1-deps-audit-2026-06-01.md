# Deps Audit: adapters-stub-embedder-llm-cycle-1

**Date:** 2026-06-01
**Mode:** plan-bound:adapters-stub-embedder-llm-cycle-1
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary

- Ecosystems detected: npm (root repo only — plan does not touch `examples/chat-with-memory/package.json`)
- Total deps audited: root manifest direct + transitive (npm-audit report shows 4 MODERATE)
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, 4 MODERATE (all pre-existing + allowlisted), 0 LOW
- Outdated: not enumerated (plan introduces no new deps; out of scope)
- Allowlist hits: 4 active (esbuild chain via drizzle-kit, sunset 2026-08-23); 0 expired
- Auditor coverage: `{ npm-audit: ran, npm-outdated: SKIPPED (plan introduces no deps), osv-scanner: SKIPPED (binary not installed — npm-audit authoritative for npm) }`

## Vulnerabilities (sorted by severity)

### GHSA-67mh-4wv8-2f99 — MODERATE (npm: esbuild <=0.24.2)

- **Path:** root → drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild
- **Direct?** No — transitive via `drizzle-kit ^0.31.0` (devDep)
- **Allowlist status:** ACTIVE (sunset 2026-08-23) — `.claude/rules/deps-audit-allowlist.txt` lines 37-40
- **Pre-existing?** YES — present since v0.1 (`b98fc80`) at first drizzle-kit install. NOT introduced by this plan.
- **Severity post-allowlist:** downgraded to LOW per golden rule § Allowlisted findings.
- **Risk envelope for this plan:** zero. Plan does not modify drizzle-kit, esbuild, or any related dep. The CVE surface is unchanged.

### + 3 sibling MODERATE findings (same root cause)

- `@esbuild-kit/core-utils` (deprecated)
- `@esbuild-kit/esm-loader` (deprecated)
- `drizzle-kit ^0.31.0` (surface manifestation)

All allowlisted with sunset 2026-08-23 (same audit-trail). Same risk envelope: zero impact on this plan.

## Outdated (non-vulnerable)

Not enumerated — the plan declares no NEW deps. Existing root deps remain unchanged.

## Plan validation (Mode 2)

The plan's `## Dependencies` section was inspected. Sections present:

| Section | Content | Status |
|---|---|---|
| Existing — use as-is | `(none — uses Node built-ins only)` row only; Rule 9 rationale: `node:crypto` built-in + Lehmer LCG textbook code | OK |
| New — to be introduced | `(none)` row only; Rule 9 rationale: `Zero new deps — by design. Future adapter cycles will introduce optionalDependencies per the roadmap` | OK |
| Removed | `(none)` row only | OK |

**Validation results:**

| Check | Status |
|---|---|
| `## Dependencies` section present (`plan_dependencies_section_missing`) | PASS — section present |
| All declared deps have explicit version (`plan_dep_version_unspecified`) | PASS — no deps declared so check is vacuously satisfied |
| NEW deps have Rule 9 evaluation (`plan_new_dep_no_rule9_evaluation`) | PASS — vacuously satisfied; the `(none)` placeholder row carries the Rule 9 statement why no new deps |
| All declared deps exist on registry (`plan_dep_not_on_registry`) | PASS — vacuously satisfied |
| No CRITICAL/HIGH CVE on declared deps | PASS — no deps declared |
| No MEDIUM CVE on declared deps | PASS — no deps declared |
| No outdated MAJOR without pin rationale | PASS — no deps declared |

## Plan-wide vulnerability impact analysis

The plan introduces:
- `src/embedders/stub.ts` + `src/embedders/index.ts` + `src/embedders/__tests__/stub.test.ts` + `src/embedders/__tests__/exports.test.ts`
- `src/llms/stub.ts` + `src/llms/index.ts` + `src/llms/__tests__/stub.test.ts` + `src/llms/__tests__/exports.test.ts`
- 4 new `package.json#exports` entries
- 2 config widening edits (`vitest.contract.config.ts`, `tsconfig.contract.json`)
- 1 demo file edit (`examples/chat-with-memory/lib/memory.ts`) + 1 README edit

Imports analysis:
- `node:crypto` — Node built-in; not subject to npm CVE surface
- `../core/dip/embedder.js`, `../core/dip/llm.js`, `../core/constants.js`, `../core/message.js` — internal modules; no external dep introduced
- Demo's `lib/memory.ts` adds imports from `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub` — internal subpaths within the same package

**Zero new external surface introduced.** The 4 pre-existing MODERATE findings remain bounded to drizzle-kit chain; this plan does not extend that surface.

## Recommended next steps

1. **Plan is dep-audit-clean.** No diffs to apply. No allowlist additions needed.
2. **Proceed with `/plan-confidence`** — verdict PASS does not cap the score band.
3. **No follow-up required** between this audit and `/implement` execution.

## Audit trail notes

- `osv-scanner` not installed on this machine (continuing the per-cycle disclosure pattern). npm-audit cross-checks were limited to npm-audit's GitHub Advisory dataset.
- Pre-existing allowlist entries remain active through 2026-08-23. Reminder: drizzle-kit upstream migration to `tsx` (which would eliminate the @esbuild-kit chain) should be tracked; if it lands before sunset, the allowlist entries can be removed early.
- Plan's "Zero new deps — by design" is the correct Rule 9 evaluation for a cycle that uses ONLY Node built-ins; the rule is satisfied vacuously but explicitly. This is the lowest-friction way to honor the dep audit's `plan_new_dep_no_rule9_evaluation` check.
