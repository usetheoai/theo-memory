# Review: complete-workspace-publish-topology — dist-shipping consumer-DX fix (commit `e1ed41d`)

**Date:** 2026-06-15
**Reviewers (spawned agents):** 4 (architecture/packaging, tests, cross-validation, wiring/integration) in parallel
**Scope:** `git diff e1ed41d~1 e1ed41d` — consumer-DX fix shipping built `dist/**` so `@usetheo/memory` resolves for Node-SSR consumers (owner decision "Shipar dist JS", supersedes ADR D1-a src-only).
**Findings:** 5 total (BLOCKER: 1, HIGH: 1, MEDIUM: 1, LOW: 2) — **ALL FIXED inline** (commits `e1ed41d` + fix commit).
**Verdict:** READY_TO_MERGE (post-fix)

## BLOCKER findings (fixed)

### F1: dist drizzle migrations excluded from the npm tarball → `runMigrations()` fails for published consumers
- Severity: BLOCKER · Found by: architecture + wiring (2 independent agents)
- File: `packages/core/package.json` `files` array + `packages/core/src/infrastructure/db/migrations-runner.ts:92-93`
- Evidence: the dist `migrations-runner.js` resolves `migrations/` next to itself (`dirname(import.meta.url)/migrations`). `build:core` copies the migrations to `dist/infrastructure/db/migrations/` on disk, BUT the `files` allow-list shipped only `dist/**/*.{js,d.ts,map}` — `npm pack --dry-run --json` shipped 0 dist `.sql` + 0 dist `meta/_journal.json`. A published consumer calling `runMigrations()` (public API) would hit `Can't find meta/_journal.json`. Regression of the previously-closed EC-1 / F-dom-cli-blocker-1. The local live round-trip masked it (the demo symlink reads on-disk dist, not the packed tarball). The commit's CHANGELOG claim was true for local-build but false for the tarball (Inquebrável Rule 3 gap).
- FIX: added `dist/**/*.sql` + `dist/infrastructure/db/migrations/meta/**` to `packages/core/package.json#files`; updated `publish-readiness.test.ts` `toEqual`; added a positive pack-manifest assertion (journal + ≥1 dist `.sql`). VERIFIED: `npm pack --dry-run --json` now ships the journal + 16 dist `.sql`; `publish-readiness` 8/8 green.

## HIGH findings (fixed)

### F2: ADR D1-a not annotated as superseded (Inquebrável Rule 3)
- Severity: HIGH · Found by: cross-validation
- File: `.claude/knowledge-base/plans/completed/complete-workspace-publish-topology-plan.md` ADR D1
- Evidence: code/tests/CHANGELOG say "supersedes ADR D1-a", but the plan's ADR D1 still read "ship src-only" with no supersession marker — a silent contract change at the ADR layer.
- FIX: appended a SUPERSEDED note to ADR D1 (owner decision "Shipar dist JS" → effectively D1-b; links commit `e1ed41d` + CHANGELOG). CHANGELOG entry strengthened.

## MEDIUM findings (fixed)

### F3: publishable package had no `prepack` → could publish stale/absent dist
- Severity: MEDIUM · Found by: architecture + tests
- File: `packages/core/package.json` scripts
- Evidence: `packages/core` had a `build` script but no `prepack`; a publish without a prior root build would ship a stale/empty `dist/` (all exports 404) and `publish-readiness` assertion #7 had a hidden build prerequisite (order/env dependence vs testing.md determinism).
- FIX: added `"prepack": "npm run build"` to `packages/core/package.json`. `npm pack`/publish now regenerates a correct dist (clean → tsc → copy migrations), making F1's fix self-enforcing and removing the hidden prerequisite.

## LOW findings (fixed)

### F4: dead `development?` export-condition field + misleading comment
- Severity: LOW · Found by: architecture + tests + cross-validation
- File: `packages/core/src/domain/index.test.ts`
- Evidence: the meta-test interface carried `development?: string` and a comment claiming a `development` export condition keeps live src — but no such condition exists; live-src is mapped via vitest `resolve.alias`.
- FIX: removed the dead field; corrected the comment to cite the vitest aliases.

### F5: stale "src-only" docblock in `publish-readiness.test.ts`
- Severity: LOW · Found by: tests + cross-validation
- FIX: rewrote the docblock to the dist+src shipping model (8 assertions).

## Quality gates summary
- Contract suite: 930 passed / 2 skipped / 0 failed.
- Integration `publish-readiness`: 8/8 (incl. new dist-migrations-ship guard).
- `npm pack --dry-run`: ships dist journal + 16 dist `.sql` + 116 dist `.js` (647 entries).
- Node-SSR consumer resolution (`examples/chat-with-memory`): `@usetheo/memory` + subpaths resolve via dist; live demo round-trips remember→recall (gpt-4o-mini extraction → 384-dim local embedder → pgvector).
- `typecheck` 0 errors; `/code-quality` PASS (score 100, 0 hard/soft caps).

## Spawned agents (audit trail)
- architecture/packaging (agentId aedd3b2bea9188b58)
- tests (agentId a7a67a30121325902)
- cross-validation (agentId a823388196f248198)
- wiring/integration (agentId a8ab458d612d1b222)

## Handoff decision
READY_TO_MERGE — all 5 findings (1 BLOCKER + 1 HIGH + 1 MEDIUM + 2 LOW) fixed inline and verified. The dist-shipping consumer-DX fix is complete: the published tarball is resolvable by Node-SSR consumers AND ships the dist migrations so `runMigrations()` works post-install.
