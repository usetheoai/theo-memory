# Deps Audit: first-class-episodes

**Date:** 2026-06-22
**Mode:** plan-bound:first-class-episodes
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm workspace — packages/core, packages/api, packages/mcp, packages/cli, packages/agent-core)
- Plan-declared NEW dependencies: 0
- Plan-declared dependency changes: 0 (the episode read surface reuses `pg` + `drizzle-orm` + `hono` + `zod`, all already shipped)
- Vulnerabilities introduced by this plan: 0 (no new dep → no new CVE surface)
- Auditor coverage: plan `## Dependencies` cross-reference (deterministic); no new package to scan against the registry.

## Plan validation (Mode 2)

The plan's `## Dependencies` section declares `(none — no new dependency)` with an explicit Rule 9 rationale (reuse `pg`/drizzle/Hono/zod already shipped; blueprint Q5 confirmed Letta's message-list tier pulls no new runtime dep — `message_manager.py:1-6` is stdlib + sqlalchemy). Verified against the manifests:

| Reused dep | Declared | In manifest | Verdict |
|---|---|---|---|
| `pg` (raw SQL `listEpisodes`) | existing | `packages/core` `pg@^8.13.0` | OK |
| `drizzle-orm` (schema) | existing | `packages/core` `drizzle-orm@^0.45.0` | OK |
| `hono` + `@hono/zod-openapi` (REST handler) | existing | `packages/api` `hono@^4.7.18`, `@hono/zod-openapi@^0.19.6` | OK |
| `zod` (query schema) | existing | `packages/core`/`packages/api` `zod@^3.25.x` | OK |

No NEW row in `## Dependencies` → `plan_new_dep_no_rule9_evaluation` does NOT fire. No unspecified version → `plan_dep_version_unspecified` does NOT fire. Section present → `plan_dependencies_section_missing` does NOT fire.

## Vulnerabilities
None introduced — this plan adds zero dependencies. (Pre-existing repo CVE posture is unchanged by M2 and out of scope for a plan-bound audit that introduces no dep surface.)

## Outdated
N/A — no new dep.

## Recommended next steps
1. No manifest changes required.
2. Proceed with `/plan-confidence first-class-episodes`.
