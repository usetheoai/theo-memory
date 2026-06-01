# Deps Audit: examples-chat-with-memory-v0-4b-expansion

**Date:** 2026-05-31
**Mode:** plan-bound:examples-chat-with-memory-v0-4b-expansion
**Verdict:** FAIL_MEDIUM
**Hard caps triggered:** `plan_dep_medium_cve` (caps plan-confidence at 70)

## Summary

- Ecosystems detected: npm (main repo + `examples/chat-with-memory/`)
- Total deps audited: 781 (demo: 420 prod + 325 dev + 86 optional) + main repo separately
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, **2 MEDIUM (demo)** + 4 MEDIUM (main repo, all allowlisted)
- Outdated: not enumerated (plan introduces no new deps)
- Allowlist hits: 4 active (main repo esbuild/drizzle-kit chain, sunset 2026-08-23); 0 expired
- Auditor coverage: `{ npm-audit: ran (demo + main), npm-outdated: SKIPPED (plan introduces no new deps), osv-scanner: SKIPPED (binary not installed; npm-audit is authoritative for npm) }`

## Vulnerabilities (sorted by severity)

### GHSA-qx2v-qp2m-jg93 — MODERATE (npm: postcss <8.5.10)

- **Title:** PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output
- **CWE:** CWE-79 (XSS)
- **CVSS:** 6.1 (AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N)
- **Fixed in:** postcss@8.5.10 (transitive — bundled inside next)
- **Path:** examples/chat-with-memory/ → next@15.5.18 → postcss (<8.5.10)
- **Direct?** No — transitive via `next ^15.5.18`
- **Allowlist status:** not-listed
- **Pre-existing?** YES — CVE pre-existed at PR #24 merge. The current plan introduces NEITHER `next` NOR `postcss`. Both deps were already in `examples/chat-with-memory/package.json` from earlier cycles.
- **Practical risk in this context:** The XSS is in PostCSS's CSS-stringify output path; consumed at build-time and dev-server-time by Next.js. The demo's API routes (the surface this plan modifies) do NOT touch PostCSS output. The risk applies to the demo's dev-time/build-time tooling, not the runtime API surface.
- **Diff suggestion:** OMITTED — fix requires `next` MAJOR bump (next@9.3.3 per `fixAvailable.isSemVerMajor: true`), which contradicts the plan's "demo is unchanged" framing AND would force a Next.js downgrade (npm-audit's suggestion is wrong — real fix is next@>=15.6.x once postcss transitive lands). Recommend human evaluation, not auto-apply.

### MEDIUM (npm: next ^15.5.18 — meta-finding)

- **Source:** npm-audit reports `next` as MEDIUM via the transitive `postcss` finding above. No NEW vulnerability in next itself; the severity is inherited.
- **Effect:** Same path as the postcss row. Counted once for verdict purposes.

## Outdated (non-vulnerable)

Not enumerated — the plan declares no NEW deps. Existing deps used as-is.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| @usetheo/memory | Existing | yes (`file:../..`) | yes | n/a (workspace dep) | OK |
| @usetheo/ui | Existing | plan `^0.12.0` vs manifest `0.12.0` (exact); range superset, COMPATIBLE | yes | n/a | OK |
| pg | Existing | plan `^8.13.0` vs manifest `^8.13.1`; manifest is subset of plan range, COMPATIBLE | yes | n/a | OK |
| next | Existing | **plan `^14.x` vs manifest `^15.5.18` — DRIFT** (plan version is wrong, must be bumped to `^15.5.18`) | NO — MODERATE CVE GHSA-qx2v-qp2m-jg93 via postcss transitive | n/a | DRIFT + FAIL_MEDIUM |

### Drift to fix in the plan (independent of CVE decision)

The plan's `## Dependencies` § Existing table claims `next ^14.x` but the demo's actual `package.json` declares `next ^15.5.18`. This is a stale-fact issue in the plan (the demo was bumped to Next 15 in an earlier cycle). Required edit: change `^14.x` to `^15.5.18`. One-line fix.

## Recommended next steps

You have THREE viable paths. Each presented honestly with trade-offs.

### Path A — Allowlist the postcss CVE with sunset ≤ 90 days, fix plan drift, proceed

1. Edit `.claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md` § Dependencies → change `next ^14.x` → `next ^15.5.18`.
2. Add to `.claude/rules/deps-audit-allowlist.txt`:
   ```
   npm|postcss|<8.5.10|GHSA-qx2v-qp2m-jg93|MODERATE XSS in PostCSS CSS-stringify path; transitive via next ^15.5.18 in examples/chat-with-memory/. Demo API surface does NOT consume PostCSS output; risk confined to dev/build tooling. Real fix requires upstream next to bundle postcss>=8.5.10 (tracked at https://github.com/vercel/next.js/issues). Re-audit at sunset.|2026-08-29
   ```
3. Re-run `/deps-audit examples-chat-with-memory-v0-4b-expansion` → expect PASS_WITH_CAVEATS (allowlist downgrades MODERATE → LOW per golden rule § Allowlisted findings).
4. Proceed to `/plan-confidence` (will cap at 89 SHIPPABLE_WITH_CAVEATS not 70).

### Path B — Accept FAIL_MEDIUM verdict explicitly + ADR in plan + proceed

1. Fix plan drift (same as Path A step 1).
2. Add an ADR D6 to the plan: "Accepted MODERATE postcss CVE GHSA-qx2v-qp2m-jg93 as pre-existing demo-tooling risk; no plan-introduced exposure; tracked at $URL; revisit at next demo dep bump."
3. Skip the allowlist entry (the audit verdict stays FAIL_MEDIUM; plan-confidence caps at 70).
4. Proceed knowing plan-confidence will return SHIPPABLE_WITH_CAVEATS (band 70-89).

### Path C — Bump `next` to a fixed version + verify + proceed

1. Fix plan drift (same as Path A step 1).
2. Bump `examples/chat-with-memory/package.json` → `next: "^15.6.0"` (first version that may transitively pull postcss>=8.5.10; needs verification via `npm ls postcss`).
3. Re-run `npm install` + `npm audit` to confirm postcss transitive is on >=8.5.10.
4. Re-run `/deps-audit examples-chat-with-memory-v0-4b-expansion` → expect PASS.
5. Risk: a Next.js minor bump may surface other behavior changes that affect the demo's E2E (Chrome MCP). Adds a verification step before `/test-chat-with-memory` at T4.1.

### Recommendation

Path A is the SAFEST and FASTEST. The CVE is genuinely low-impact in this context (build-tooling, not API surface), allowlisting with 90-day sunset preserves auditability, and we avoid an unplanned Next.js bump that would itself need validation.

## Audit trail notes

- `osv-scanner` not installed on this machine; npm-audit cross-checks were limited to npm-audit's GitHub Advisory dataset. Per Inquebrável Rule 9, this is documented honestly rather than masked.
- Main repo's 4 MODERATE findings (esbuild chain via drizzle-kit) are all allowlisted with sunset 2026-08-23; verdict for the main repo is PASS_WITH_CAVEATS (no plan-confidence contribution from main).
- The plan's `## Dependencies` table contained a stale fact (`next ^14.x` vs reality `^15.5.18`). This is a documentation drift, NOT a Rule 9 violation; the dep WAS declared, just at the wrong version range.
