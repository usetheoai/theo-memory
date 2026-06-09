# Deps Audit: themory-mcp-bearer-by-env-faang

**Date:** 2026-06-08
**Mode:** plan-bound:themory-mcp-bearer-by-env-faang
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary

- Ecosystems detected: npm
- Plan declares: ZERO new direct deps, ZERO removed deps, ZERO upgraded versions
- Surface touched: 2 source files (`src/agent-tools/run-mcp-server.ts` + `src/agent-tools/__tests__/run-mcp-server.test.ts`) + 1 NEW test file + README + CHANGELOG
- Vulnerabilities found: N/A — no new dep surface to audit
- Outdated: N/A — no version changes
- Allowlist hits: N/A
- Auditor coverage: light — no audit tools invoked because the plan introduces zero dependency-surface changes

## Rationale for skip

Per `.claude/rules/deps-audit-golden-rule.md § Trigger conditions` (modes 1+2), the audit's job is to validate `## Dependencies` section of the plan. Looking at the plan v1.1 of `themory-mcp-bearer-by-env-faang`:

- Plan `## Files to edit` lists ONLY:
  - `src/agent-tools/run-mcp-server.ts` (modify ~30 LoC)
  - `src/agent-tools/__tests__/run-mcp-server.test.ts` (extend with matrix tests)
  - `tests/integration/agent-tools/env-driven-transport-selection.test.ts` (NEW test file)
  - `README.md` (doc)
  - `CHANGELOG.md` (Inquebrável Rule 6)

- Plan ADRs (D1-D5) propose ZERO new libraries:
  - `ApiKeyAuthVerifier` — already shipped Item 20
  - `process.env` reads — Node.js stdlib (no dep)
  - `process.stderr.write` — Node.js stdlib (no dep)
  - `vi.stubEnv` (tests) — already a `vitest` API; vitest already in devDeps

- Plan Failure scenarios depend on `pg` (already in dependencies), `ankane/pgvector:v0.5.1` (already in `.dev-stack`); zero new infra.

## Conclusion

This is a **refactor-only cycle within composition root**: extends an existing function (`resolveTransport`) by ~5 LoC, introduces a sibling function (`resolveAuthMode`) by ~10 LoC, adds a `@internal` test wrapper (`resolveMcpModes`) by ~5 LoC, plus stderr disclosure + tests + docs. Nothing crosses the deps boundary.

Audit verdict: **PASS** — no surface to audit, ready to proceed to `/plan-confidence`.

If during `/implement` any new dep is discovered necessary (unlikely given the scope), re-run `/deps-audit {slug}` BEFORE merging.
