# Review: extract-cli-to-packages

**Date:** 2026-06-15
**Reviewers (spawned agents):** 6 — architecture, wiring, cross-validation, tests, domain-cli-tooling, domain-database
**Diff base:** `93d8034..HEAD` (extract-cli plan commit → tip)
**Findings:** 25 total (BLOCKER: 1, HIGH/MAJOR: 2, MEDIUM: 2, LOW: 5, INFO: 15)
**Verdict:** NEEDS_FIXES

## Summary

The **build-fix slice produced this session is sound** — architecture, wiring, cross-validation, and database reviewers returned clean (INFO/PASS). The plan's headline goal (`themory --help` functional post-build, env-free) is empirically met; `src/` deleted; typecheck/lint/contract-tests/build all green; the alias-rewrite + lazy-optional-dep fixes are correctly wired with a regression guard; the D2 detector fix (ADR-0016) is a correct root-cause fix that does not weaken real fabrication detection.

The review surfaced **pre-existing workspace-reorg debt** (from the earlier `standardize-project-structure` commits, not this session's build-fix) that blocks merge:

## BLOCKER findings (must fix before merge)

### F-tests-1: `publish-readiness.test.ts` 5/7 failing — publishable package lacks `files`; test targets root

- **Severity:** BLOCKER · **Found by:** tests
- **File:** `tests/integration/publish-readiness.test.ts:30,41,123`
- **Evidence:** `npx vitest run tests/integration/publish-readiness.test.ts -c vitest.integration.config.ts` → 5 failed / 2 passed. Root `package.json` is `private:true` with NO `files`/`exports` (correct for a workspace root), but the test still reads ROOT package.json. The publishable package `@usetheo/memory` (`packages/core/package.json`) has `exports` (11 subpaths) but **no `files` allow-list**. Also `npm pack --dry-run --json` run at REPO_ROOT prints a non-JSON postbuild log line, breaking `JSON.parse`.
- **Root cause:** the `standardize-project-structure` reorg moved the publishable surface to `packages/core` but did NOT (a) migrate the `files` allow-list onto `packages/core/package.json`, nor (b) retarget this test to the publishable package. This was NOT introduced by this session's build-fix slice; it surfaced because the validation tail ran only the contract vitest config (excludes `tests/integration/**`).
- **Recommended action:** Decide + apply the publishable-package topology: add a `files` allow-list to `packages/core/package.json` (ship src + migrations, exclude tests), retarget the test to `packages/core` (and adjust tarball-path assertions to package-relative), make the npm-pack JSON parse robust to stdout log noise.

## HIGH / MAJOR findings

### F-tests-2: publish files allow-list test WEAKENED during migration
- **Severity:** HIGH · **File:** `tests/integration/publish-readiness.test.ts:41`
- Exact `toContain` assertions were replaced with loose `.some(f => f.includes(...))`; the `!*.test-d.ts` exclusion is now unasserted and a regression that packs test files would no longer be caught. Restore exact-match assertions against the new layout's negation patterns.

### F-dom-cli-1: `@usetheo/memory/agent-tools` is a phantom subpath
- **Severity:** MAJOR (→ HIGH) · **File:** `packages/core/package.json` (exports) + 11 importers in `packages/mcp/src/`
- The subpath resolves ONLY via three project-specific shims (vitest alias, tsconfig paths, dist alias-rewrite), NOT via standard Node `exports`: `packages/core/package.json#exports` has no `./agent-tools`, and `packages/mcp` does not depend on `@usetheo/memory-cli` (where agent-tools now lives). **NOT a runtime blocker** (the built dist works via rewrite-dist-aliases; integration suite green) but fragile for publication. Fix: migrate the 11 MCP imports to `@usetheo/memory-cli` + add `"@usetheo/memory-cli": "workspace:*"` to `packages/mcp/package.json`, OR add an `./agent-tools` export to core. Also a `cli ↔ mcp` package cycle exists (pre-existing).

## MEDIUM findings

- **F-wiring-6 / F-arch-4 area:** stale `vi.mock()` targets in `packages/cli/src/__tests__/agent-tools-memory.test.ts` (relative paths that no longer exist post-move + lazy-import) — the 4 mocks are inert; the test passes but is no longer hermetic. Update mock module IDs to the bare subpath specifiers.
- **F-tests-3:** the env-free dist-boot guard `describe.skipIf(!DIST_EXISTS)` silently skips when dist absent — gate it behind a build-then-integration CI job or fail-loud when `CI=true`.
- **architecture.md § 3 line 56** claims "packages/cli depends on packages/core only" — now inaccurate (cli also depends on mcp + api). Correct the line.

## LOW / INFO

- LOW: stale `src/agent-tools/` JSDoc coordinates in moved files; stale `drizzle.config.ts` JSDoc; `scopes-list-temporal-fidelity` dim 384→1536 fixture change mislabeled path-only; shared global-setup swallows migration errors; allowlist `@modelcontextprotocol/sdk/*` glob breadth.
- INFO (15): the build-fix is architecturally sound (single construction site preserved, DIP holds, fail-loud alias rewrite); locked CLI verbs/flags + `themory-mcp` alias preserved env-free; D2 detector fix correct + regression-guarded; migrations ship to dist correctly (EC-4); the new symbol-fab regression test is exemplary; bulk test migration is clean (no `.only`/silent `.skip`).

## Quality gates summary

- `pnpm typecheck`: PASS · `pnpm lint`: PASS (0 warnings) · `pnpm test` (contract): PASS (930)
- `pnpm build` + env-free `themory --help`: PASS · `ls src/`: not found · migrations in dist: PASS (EC-4)
- `/code-quality`: PASS (after ADR-0016)
- **`tests/integration/publish-readiness.test.ts`: FAIL (5/7)** ← the BLOCKER
- Full integration suite vs real pgvector: NOT fully re-run this session (no DB); the contract suite was green.

## Handoff decision

**NEEDS_FIXES** — 1 BLOCKER (publish-readiness, pre-existing reorg debt). The build-fix slice itself is merge-ready; the blocker belongs to the broader workspace-reorg publish topology. Per cycle-review, BLOCKER → no READY_TO_MERGE. Surfacing to human: the publishable-package `files` topology is a decision requiring owner input (what `@usetheo/memory` ships).

## Spawned agents (audit trail)

- `.claude/agents/review-extract-cli-to-packages-2026-06-15/{architecture,wiring,cross-validation,tests,domain-cli-tooling,domain-database}.md`
