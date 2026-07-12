# Deps Audit: auto-categorization-write-pipeline

**Date:** 2026-07-12
**Mode:** plan-bound:auto-categorization-write-pipeline
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm
- Total deps audited: 1 declared (`zod`, existing) + 1 internal DIP (`LLM`, in-repo, not a package)
- New dependencies introduced by this plan: **0**
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
- Outdated: 0 (zod `^3.25.0` is on the current major)
- Allowlist hits: 0
- Auditor coverage: { npm-audit: ran (clean, authoritative for npm), osv-scanner: SKIPPED — binary not installed (cross-check gap, non-blocking) }

## Vulnerabilities (sorted by severity)

(none)

## Outdated (non-vulnerable)

(none — `zod ^3.25.0` matches the plan's `^3` declaration and is current)

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `zod` | Existing | yes (`^3.25.0` in `packages/core/package.json`) | yes (npm audit 0 findings) | n/a (existing) | OK |
| `LLM` DIP (internal) | Existing | n/a (in-repo `packages/core/src/domain/dip/llm.ts`) | n/a (not a package) | n/a | OK |
| (NEW deps) | New | — | — | — | none declared |

## Honest gap disclosure

- `osv-scanner` is NOT installed on this host, so the OSV cross-check for the npm surface did not run. Per the golden rule, an unavailable auditor caps the verdict at 70 ONLY when there is untestable HIGH/CRITICAL exposure. Here the authoritative npm auditor (`npm audit`) ran and reported **zero** vulnerabilities across the prod dependency tree, and the plan introduces **no new dependency** — so there is no untestable exposure. Verdict stays PASS; the osv cross-check gap is noted, not fabricated.

## Recommended next steps

1. No manifest change required (no new dep).
2. Proceed with `/plan-confidence auto-categorization-write-pipeline`.
