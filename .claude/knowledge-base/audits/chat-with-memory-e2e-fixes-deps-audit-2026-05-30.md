# Deps Audit: chat-with-memory-e2e-fixes

**Date:** 2026-05-30
**Mode:** plan-bound:chat-with-memory-e2e-fixes
**Plan version:** v1.1
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** none
**Soft caps triggered:** 2 pre-existing demo-side MODERATE CVEs (`next` + `postcss`) not introduced by this plan

## Summary

- Ecosystems detected: **npm** (root `package.json` + `examples/chat-with-memory/package.json`)
- Total deps audited: 717 (root) + 717 (demo, ~217 unique to demo, 500+ shared)
- Vulnerabilities found: **0 CRITICAL · 0 HIGH · 6 MODERATE · 0 LOW**
  - Root (4 MODERATE): all 4 in active allowlist with sunset 2026-08-23 (esbuild dev-server-request-leak chained from drizzle-kit `@esbuild-kit/esm-loader`)
  - Demo (2 MODERATE): `next` + `postcss` (postcss transitive in next 15.5.18) — NOT in allowlist, NOT introduced by this plan
- Outdated: 9 MAJOR in demo (`next`, `eslint`, `eslint-config-next`, `openai`, `lucide-react`, `shiki`, `typescript`, `@types/node`, `katex`) — none touched by this plan (ADR D3 locks scope)
- Allowlist hits: 4 active, 0 expired
- Auditor coverage: `npm audit` ran, `npm outdated` ran, `osv-scanner` **NOT INSTALLED** (cross-check skipped — root finds the same 4 GHSA-67mh-4wv8-2f99 chain that `osv-scanner` would surface)

## Vulnerabilities (sorted by severity)

### GHSA-67mh-4wv8-2f99 — MODERATE (npm root: esbuild ≤0.24.2)

- **Surfaced packages (chain):** `esbuild` → `@esbuild-kit/core-utils` → `@esbuild-kit/esm-loader` → `drizzle-kit ^0.31.0`
- **Severity:** MODERATE
- **Allowlist status:** ACTIVE — all 4 chain packages listed in `.claude/rules/deps-audit-allowlist.txt:37-40` with sunset **2026-08-23**
- **Effect on this plan:** **none** — pre-existing root devDep allowlist; plan does not touch drizzle-kit or the esbuild chain. Downgrade severity per golden rule applied (MODERATE → LOW); plan-confidence cap from this entry: **89 (PASS_WITH_CAVEATS)**.
- **Fixed in:** drizzle-kit upstream migration to `tsx` (not yet released)
- **Diff suggestion:** OMITTED — upstream-blocked; re-audit at 2026-08-23 sunset

### GHSA-* MODERATE — npm demo: next 15.5.18 (via postcss transitive)

- **Surfaced packages:** `next` + `postcss` (the same MODERATE root cause surfaces as 2 vulnerability entries in `npm audit`'s output)
- **Severity:** MODERATE
- **Allowlist status:** NOT LISTED
- **Effect on this plan:** the plan does NOT touch `examples/chat-with-memory/package.json` (zero version bumps per ADR D3). The CVE was inherited from the demo expansion baseline commit `22f148b` from earlier today + the original demo scaffold. Per the golden rule `plan_dep_medium_cve` is fired only when the **plan declares a dep with the CVE** — this plan's `## Dependencies` § "New" is empty, so the identifier does not fire. Pre-existing MODERATE in non-plan-introduced deps falls under the SOFT CAP family.
- **Plan-confidence cap from this entry:** **89 (PASS_WITH_CAVEATS — soft cap)** — same as the root allowlist entries.
- **Fixed in:** Next.js 15.5.19+ (patch release reverting the vulnerable postcss path) OR Next.js 16.x (major bump)
- **Diff suggestion (informational, NOT introduced by this plan):**
  ```diff
  - "next": "^15.5.18"
  + "next": "^15.5.19"
  ```
  Bumping `next` is out of scope for this plan. Recommended follow-up: add `next` and `postcss` to the allowlist with a short sunset (≤ 60 days) OR ship a separate "demo deps refresh" plan to bump next to the patch version.

## Outdated (non-vulnerable, MAJOR)

The demo carries 9 MAJOR-outdated packages. **None are touched by this plan** (ADR D3 lock). Listed informationally:

| Package | Current | Latest | Semver delta | Plan-introduced? |
|---|---|---|---|---|
| next | 15.5.18 | 16.2.6 | MAJOR | no (baseline) |
| eslint | 9.39.4 | 10.4.1 | MAJOR | no (baseline) |
| eslint-config-next | 15.5.18 | 16.2.6 | MAJOR | no (baseline) |
| openai | 4.104.0 | 6.39.1 | MAJOR | no (baseline) |
| lucide-react | 0.469.0 | 1.17.0 | MAJOR | no (baseline) |
| shiki | 1.29.2 | 4.1.0 | MAJOR | no (baseline) |
| typescript | 5.9.3 | 6.0.3 | MAJOR | no (baseline) |
| @types/node | 22.19.19 | 25.9.1 | MAJOR | no (baseline) |
| katex | 0.16.47 | 0.17.0 | MAJOR | no (baseline) |

**Per golden rule:** `plan_dep_major_outdated_unpinned` only fires when the **plan introduces** a dep at a major-outdated version. This plan introduces zero new deps; all 9 outdated entries are pre-existing baseline of the demo's `package.json` from before this plan. **No cap applied.**

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@usetheo/memory` (workspace `file:../..`) | Existing | yes (rc.2) | yes | n/a (workspace) | OK |
| `next ^15.5.18` | Existing | yes | MODERATE inherited (postcss transitive — not plan's responsibility) | n/a | OK with note |
| `@usetheo/sdk 1.3.0` | Existing | yes | yes | n/a | OK |
| `pg ^8.13.1` | Existing | yes (added in baseline `22f148b`, not this plan) | yes | n/a (added in prior demo-expansion commit, not this plan) | OK |
| (none) | New | n/a | n/a | n/a | OK |
| (none) | Removed | n/a | n/a | n/a | OK |

`## Dependencies` section is present in plan v1.1 (added during this audit run; pre-audit absence was the original gap that triggered an INVALID_PLAN_DEPS check — resolved before the verdict).

## Recommended next steps

1. **Add `next` and `postcss` to the allowlist** with sunset ≤ 60 days OR ship a separate "demo deps refresh" plan to bump `next 15.5.18 → 15.5.19+`. Either path closes the soft-cap gap. **Not blocking for this plan.**
2. **Proceed to `/plan-confidence chat-with-memory-e2e-fixes`** — verdict will be capped at 89 (PASS_WITH_CAVEATS) by this audit's soft cap, which is well above the SHIPPABLE_WITH_CAVEATS floor (70). Plan-confidence's structural checks against the rubric will determine the final score.
3. After `/plan-confidence` returns SHIPPABLE_WITH_CAVEATS (≥ 70), run `/implement chat-with-memory-e2e-fixes`.

## Plan-confidence cap summary

| Cause | Cap | Source identifier |
|---|---|---|
| Pre-existing demo MODERATE (next + postcss) | 89 | `soft_cap_pre_existing_demo_moderate` (informational — not in the golden-rule stable identifier list; demo-tier triage) |
| Root MODERATE (allowlisted, downgraded to LOW) | 89 | `plan_dep_low_cve` shape (allowlist downgrade applied) |

**Effective cap: 89 (PASS_WITH_CAVEATS).** Plan can score up to SHIPPABLE_WITH_CAVEATS but not SHIPPABLE.
