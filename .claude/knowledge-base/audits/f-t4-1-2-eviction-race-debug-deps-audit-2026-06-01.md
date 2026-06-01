# Deps Audit: f-t4-1-2-eviction-race-debug

**Date:** 2026-06-01
**Mode:** plan-bound:f-t4-1-2-eviction-race-debug
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** (none — `plan_dependencies_section_missing` does NOT fire; plan touches no manifests)
**Soft caps:** 1 (`soft_floor_pre_existing_allowlisted_moderate` — 4 pre-existing MODERATE allowlisted carry forward from PR #25 cycle)

## Summary

- **Plan dep delta: ZERO** — debug cycle modifies `src/local/eviction/*` (likely) + `examples/chat-with-memory/lib/memory.ts` (hotfix lift) + `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (new test). NONE of these touch `package.json`.
- **Vulnerabilities found:** 0 CRITICAL, 0 HIGH, 4 MODERATE (pre-existing + allowlisted, sunset 2026-08-23), 0 LOW
- **Outdated:** unchanged from last audit (6 dev-only out-of-scope)
- **Allowlist hits:** 4 ACTIVE; 0 EXPIRED
- **Auditor coverage:** `npm-audit` ran (same posture as adapters fix-up cycle); osv-scanner SKIPPED (binary not installed)

## Plan validation (Mode 2)

| Validation | Result |
|---|---|
| `## Dependencies` section present? | NO — plan introduces zero deps (architecture.md compliance scope cites: "Honors Inquebrável Rule 9 — no new npm dep") |
| Plan touches `package.json`? | NO (verified via plan's "Files to edit" + ADR D6) |
| Golden rule §1 trigger? | NO — wording "Every plan that introduces, uses, or removes a dependency MUST declare it explicitly" does not match |
| Rule 9 compliance | N/A (no new code surfaces that could reinvent libs; bug fix only) |

## Verdict

PASS_WITH_CAVEATS — proceed to `/plan-confidence` with cap 89 floor (inherited from source-cycle MODERATE allowlist posture; not a new risk).
