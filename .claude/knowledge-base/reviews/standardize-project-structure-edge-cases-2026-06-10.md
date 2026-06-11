# Edge Case Review — standardize-project-structure

Date: 2026-06-10
Tasks analyzed: 15
Edge cases found: 12 (MUST FIX: 5, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX

### EC-1: Migration path resolution breaks after move to packages/core/
- **Affected task:** T3.5
- **Family:** State / Resource
- **Scenario:** `src/local/index.ts:1513` uses `dirname(fileURLToPath(import.meta.url))` to resolve `migrations/` relative to itself. After moving to `packages/core/src/infrastructure/db/`, the relative path `./migrations` still works IF the migrations directory moves with it. But `postbuild:copy-migrations` in `package.json` hardcodes `src/local/migrations` -> `dist/local/migrations`. After the move, this script copies from a path that no longer exists.
- **Impact:** `runMigrations()` fails at runtime — SQL files not found in `dist/`. This is the EXACT same bug as F-T7.1-3 that was fixed before.
- **Suggested fix:** Update `postbuild:copy-migrations` to use the new path `packages/core/src/infrastructure/db/migrations` -> `packages/core/dist/infrastructure/db/migrations`. Add to T3.5 tasks.

### EC-2: Dockerfile hardcodes npm commands and src/ paths
- **Affected task:** T3.1, T3.5
- **Family:** Resource / State
- **Scenario:** The Dockerfile (multi-stage, distroless Node 22) uses `npm ci`, `npm run build`, and `COPY src/ dist/` patterns. After migrating to pnpm workspace, `npm ci` fails (no package-lock.json), and the `COPY` source paths change to `packages/core/src/`.
- **Impact:** Docker image cannot be built. CI workflow `docker-publish.yml` fails.
- **Suggested fix:** Add "Update Dockerfile to use `pnpm install --frozen-lockfile` and adjust COPY paths to `packages/*/`" as a sub-task of T3.1. Update `.github/workflows/docker-publish.yml` to install pnpm.

### EC-3: package.json `files` field references src/local/ paths that will move
- **Affected task:** T3.5
- **Family:** Resource
- **Scenario:** `package.json#files` lists `src/local/migrations/**`, `dist/**/*.sql`, `dist/local/migrations/meta/**`. After T3.5, these paths no longer exist. `npm pack --dry-run` (or `pnpm pack`) will NOT include migration SQL files.
- **Impact:** Published package missing migration files — `runMigrations()` fails for any consumer installing from npm.
- **Suggested fix:** After T3.5, update the `files` field in `packages/core/package.json` to reference new paths. Add an acceptance criterion: `pnpm pack --dry-run` includes `*.sql` files.

### EC-4: CLI and MCP share code in src/agent-tools/ — splitting requires dependency analysis
- **Affected task:** T3.3, T3.4
- **Family:** State / Boundary
- **Scenario:** The plan assumes CLI and MCP can be cleanly split from `src/agent-tools/`. But `src/agent-tools/` has 54 files — CLI (Commander) and MCP (tools + server) share utilities, scope-binding logic (`AsyncLocalStorage`), and possibly test fixtures. A naive split leaves shared code orphaned or duplicated.
- **Impact:** Build breaks in packages/cli/ or packages/mcp/ due to missing shared utilities. Or DRY violation by copying shared code.
- **Suggested fix:** Before T3.3, add a sub-task: "map shared vs CLI-only vs MCP-only files in `src/agent-tools/`". Shared utilities stay in `packages/core/` and are imported by both cli and mcp via `workspace:*`.

### EC-5: theo-memory tests reference relative paths like `../../../core/errors.js`
- **Affected task:** T3.5, T3.6
- **Family:** State
- **Scenario:** Test files use deep relative imports like `import { MemoryNotFound } from '../../../core/errors.js'` (found in `src/agent-tools/tools/__tests__/handlers.test.ts`). After moving files to `packages/core/src/domain/` AND co-locating tests, these relative paths break because the directory depth changes.
- **Impact:** Hundreds of import errors after the move. The plan mentions "script automatizado com sed" but does not account for the depth change when tests move from `__tests__/` subdirs to co-located.
- **Suggested fix:** The sed/codemod script MUST handle two transformations simultaneously: (1) path changes from directory rename AND (2) path shortening from `__tests__/` co-location. Run T3.5 and T3.6 as a single atomic task, or run T3.5 first with `__tests__/` preserved, validate, THEN T3.6.

## SHOULD TEST

### EC-6: pnpm workspace protocol resolution after rename
- **Affected task:** T1.1
- **Scenario:** `packages/api/package.json` depends on `@usetheo/rag` via `workspace:*`. After `git mv packages/rag packages/core`, pnpm should still resolve by `name` field. But if pnpm has a stale cache or `node_modules/.pnpm-lock.yaml` is stale, resolution may fail.
- **Suggested test:** After T1.1 step 1, run `pnpm install` and verify `ls packages/api/node_modules/@usetheo/rag` symlinks to `../../core`. Add as explicit step.

### EC-7: ESLint flat config cascade may not work with pnpm workspace symlinks
- **Affected task:** T1.4
- **Scenario:** ESLint flat config resolves relative to the config file location. When `eslint.config.ts` is at root and files are in `packages/core/src/`, the `files` glob must account for the workspace layout. pnpm symlinks can confuse ESLint's file resolution.
- **Suggested test:** After T1.4, run `pnpm lint --debug 2>&1 | head -20` to verify ESLint discovers files through the symlink boundary. Add explicit include pattern `["packages/*/src/**/*.ts"]`.

### EC-8: drizzle.config.ts references src/local/schema.ts — breaks after move
- **Affected task:** T3.5
- **Scenario:** `drizzle.config.ts` at the repo root references the schema file path. After T3.5 moves the schema to `packages/core/src/infrastructure/db/schema.ts`, the drizzle config breaks.
- **Suggested test:** After T3.5, run `pnpm db:generate` and verify Drizzle still finds the schema. Update `drizzle.config.ts` schema path in T3.5 tasks.

### EC-9: Vitest config include patterns break after monorepo split
- **Affected task:** T3.2, T3.5
- **Scenario:** `vitest.contract.config.ts` includes `src/{core,local,theokit,...}/**/__tests__/**/*.test.ts`. After T3.2 extracts server/ and T3.5 reorganizes core, these patterns match nothing. The vitest config must move to each package AND update includes.
- **Suggested test:** After each extraction task, verify `pnpm test --reporter=verbose 2>&1 | grep "Tests"` shows the expected count (not 0 tests found).

## DOCUMENT

### EC-10: `.claude/` directory contains hardcoded paths to src/
- **Affected task:** T3.5
- **Family:** Resource
- **Accepted risk:** `.claude/rules/architecture.md` section 3 references `src/core/`, `src/local/`, etc. `.claude/knowledge-base/plans/` contain file paths. These are documentation — not runtime code. They will be stale after the migration but do not cause functional breakage. The plan already includes T5.1 to update `rules/architecture.md`. Historical plan files in `knowledge-base/plans/completed/` are frozen records and SHOULD NOT be updated (per audit-trail-rotation.md). Accept the staleness.

### EC-11: Git history fragmentation across the split
- **Affected task:** T3.2, T3.3, T3.4, T3.5
- **Accepted risk:** `git log --follow` works for `git mv` within the same commit, but splits across multiple commits (server extracted in T3.2, then reorganized in T3.5) may lose the follow chain. The plan acknowledges this in Drawbacks & Risks. Accept it — `git blame` on the final state will show the migration commit, and `git log --all -- <old-path>` still works for archaeology.

### EC-12: `apply-trigger-migrations.mjs` script references `src/local/migrations/*.sql`
- **Affected task:** T3.5
- **Accepted risk:** `scripts/apply-trigger-migrations.mjs` (per `architecture.md § 10.3`) scans `src/local/migrations/*.sql` for CREATE TRIGGER patterns. After T3.5, this path breaks. This is a dev-only script (not production). Document in T3.5 tasks that the script must be updated, but classify as low-severity since it only affects `npm run db:push` developer workflow, not production `runMigrations()`.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | 0 | 1 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 0 | 0 | 0 | 0 |
| T1.4 | 1 | 0 | 1 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 1 | 0 | 0 |
| T3.2 | 1 | 0 | 1 | 1 |
| T3.3 | 1 | 1 | 0 | 0 |
| T3.4 | 0 | 0 | 0 | 0 |
| T3.5 | 6 | 3 | 1 | 2 |
| T3.6 | 1 | 0 | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| T5.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 5 MUST FIX items que, se ignorados, causam build/runtime breaks. Todos tem fix simples (1-2 linhas de mudanca no plano por item).
