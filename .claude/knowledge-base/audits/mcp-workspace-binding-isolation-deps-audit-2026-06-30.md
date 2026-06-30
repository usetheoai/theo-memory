# Deps Audit: mcp-workspace-binding-isolation

**Date:** 2026-06-30
**Mode:** plan-bound:mcp-workspace-binding-isolation
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** [] (none — the plan introduces no insecure declared dep)

## Summary
- Ecosystems detected: npm (pnpm workspace) — no Cargo/go/pyproject at root.
- Plan-declared NEW deps: **0** (the fix reuses already-shipped primitives — ADR D1 / blueprint Corner 2).
- Plan-declared Existing-reused deps: `@usetheo/memory`, `@usetheo/memory-api`, `@usetheo/memory-agent-core`, `pg`, `@modelcontextprotocol/sdk`, `vitest` — all already declared in `packages/mcp`; no version change.
- Vulnerabilities introduced by THIS plan: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW.**
- Pre-existing transitive finding (NOT introduced/touched by this plan): protobufjs@6.11.6 (see Caveat).
- Auditor coverage: `npm audit` = UNAVAILABLE (ENOLOCK — pnpm workspace, no `package-lock.json`); `osv-scanner` = ran on `pnpm-lock.yaml` (authoritative cross-ecosystem layer here).

## Vulnerabilities (sorted by severity)

### GHSA-xq3m-2v4x-88gg — CRITICAL (9.8) (npm: protobufjs@6.11.6) — PRE-EXISTING, NOT in plan scope
- Plus HIGH/MEDIUM: GHSA-jvwf-75h9-cwgg (7.5), GHSA-wcpc-wj8m-hjx6 (7.5), GHSA-f38q-mgvj-vph7 / -fx83-v9x8-x52w / -jggg-4jg4-v7c6 / -q6x5-8v7m-xcrf (5.3).
- **Root:** transitive `@protobufjs/*` — NOT declared by, nor rooted at, any dep this plan touches. The 4 edited packages (`packages/mcp`, `core`, `api`, `agent-core`) have **no protobuf/grpc dependency** (verified: `grep protobuf|grpc|google-gax` in their `package.json` → none). protobufjs enters via an unrelated workspace branch (OTel/telemetry-class tooling).
- **Relation to this plan:** NONE. The MCP workspace-isolation fix imports no protobuf code path; it adds no dependency. This is pre-existing workspace debt, not a regression of this plan.
- **Recommendation (separate from this plan):** bump the transitive `protobufjs` to a patched line via the workspace root (`pnpm up protobufjs` / override) in a dedicated dep-hygiene change. Out of scope for the #82 security fix (Rule 9 / KISS — do not scope-creep a security fix into a workspace-wide dep bump).

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@usetheo/memory` | Existing | yes (workspace) | yes | n/a (reuse) | OK |
| `@usetheo/memory-api` | Existing | yes (workspace) | yes | n/a (reuse) | OK |
| `@usetheo/memory-agent-core` | Existing | yes (workspace) | yes | n/a (reuse) | OK |
| `pg` | Existing | yes | yes (no CVE) | n/a (reuse) | OK |
| `@modelcontextprotocol/sdk` | Existing | yes | yes (no CVE) | n/a (reuse) | OK |
| `vitest` | Existing | yes | yes | n/a (reuse) | OK |
| (NEW) | — | — | — | — | none declared (0 new deps) |

## Why PASS_WITH_CAVEATS (not PASS, not FAIL_INSECURE)

- **Not FAIL_INSECURE:** the protobufjs CRITICAL is NOT a declared dep of the plan, and is not rooted at any dep the plan touches. The golden-rule hard cap (#3) is on CRITICAL/HIGH CVE in a *declared* dep — none here. The plan introduces zero insecure deps.
- **Not plain PASS:** honesty (Rule 3) + golden-rule anti-pattern #3 (never silently ignore a CRITICAL) require surfacing the pre-existing transitive finding. The caveat is logged so it is not lost — but it does NOT gate this plan.

## Recommended next steps

1. Proceed to `/plan-confidence` — this plan's dependency surface is clean (0 new deps, 0 introduced CVEs).
2. Separately, open a workspace dep-hygiene change to bump transitive `protobufjs` (pre-existing CRITICAL, unrelated to #82).
