# Edge Case Review — extract-cli-to-packages

Date: 2026-06-12
Tasks analyzed: 8 (T1.1, T2.1-T2.7)
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: tsc rootDir auto-computation will change dist output paths for ALL packages
- **Affected task:** T2.3
- **Family:** Build / Integration
- **Scenario:** Currently `tsconfig.build.json` includes `["packages/core/src/**", "src/agent-tools/**"]`. tsc computes the common ancestor as the repo root (`.`), and strips it, producing `dist/agent-tools/` and `dist/core/`. If we change to `["packages/core/src/**", "packages/cli/src/**"]`, the common ancestor becomes `packages/`, and tsc emits `dist/core/src/...` and `dist/cli/src/...` — breaking EVERY existing dist path (`dist/core/` → `dist/core/src/`, etc.). This affects `package.json#exports`, bin paths, Dockerfile ENTRYPOINT, `postbuild:copy-migrations`, and every runtime `import.meta.url`-based path resolution in the codebase.
- **Impact:** TOTAL BUILD BREAK. Every import from `@usetheo/memory` fails at runtime. Dockerfile ENTRYPOINT 404s. CLI `themory` command crashes.
- **Suggested fix:** Add explicit `"rootDir": "."` to `tsconfig.build.json` compilerOptions. This locks the rootDir regardless of include path changes, preserving the current dist structure. After adding rootDir, the output will be `dist/packages/core/src/...` and `dist/packages/cli/src/...` — which is ALSO wrong (adds `packages/` prefix). The real fix: use a `postbuild:move` script OR set rootDir to the computed path that produces the current output. Investigate what implicit mechanism currently strips `packages/core/src/` down to `core/` and `src/agent-tools/` down to `agent-tools/` — this is load-bearing and must be understood before changing include paths.

### EC-2: `src/agent-tools/auth/` subdirectory not accounted for in git mv
- **Affected task:** T1.1
- **Family:** State / Completeness
- **Scenario:** The baseline lists 18 .ts files in `src/agent-tools/` but `src/agent-tools/auth/with-bearer-auth.ts` (164 LoC) lives in a subdirectory. `git mv src/agent-tools packages/cli/src` moves the entire tree recursively, so this is likely fine — but the plan's file inventory (baseline § 1) does NOT mention the `auth/` subdirectory. If any config or import references `src/agent-tools/auth/` specifically, it will break.
- **Impact:** If `with-bearer-auth.ts` has importers that use the path `@usetheo/memory/agent-tools` barrel, it's fine (barrel resolves). But if any importer uses a deep path like `../../agent-tools/auth/with-bearer-auth.js`, it breaks.
- **Suggested fix:** Add `src/agent-tools/auth/with-bearer-auth.ts` to the baseline file table. Grep for `agent-tools/auth` to verify no deep imports exist: `grep -rn 'agent-tools/auth' packages/ src/ --include='*.ts'`.

## SHOULD TEST

### EC-3: GitHub Actions docker-publish.yml may reference src/ paths
- **Affected task:** T2.6
- **Suggested test:** `grep -n 'src/' .github/workflows/docker-publish.yml` — verify no hardcoded `src/agent-tools` reference. The workflow builds from Dockerfile (which the plan updates), but if there's a separate COPY or context filter, it may fail silently (Docker build succeeds but the image lacks CLI files).

### EC-4: `postbuild:copy-migrations` script hardcodes `packages/core/src/infrastructure/db/migrations` path
- **Affected task:** T2.3
- **Suggested test:** Verify the migrations copy script in `package.json` still works after build changes. The script currently copies from `packages/core/src/infrastructure/db/migrations` to `dist/infrastructure/db/migrations` — this path is unaffected by the CLI move, but if the tsconfig rootDir change (EC-1) shifts dist structure, the destination path may need updating too.

## DOCUMENT

### EC-5: Plan's D1 Consequences contradict D2
- **Accepted risk:** D1 Consequences says "Build output muda de `dist/agent-tools/` para `dist/cli/`" but D2 explicitly decides to PRESERVE `dist/agent-tools/`. This is an internal inconsistency in the plan text. The D2 decision is the correct one (backward-compat). D1 Consequences line should be corrected to align with D2 when absorbing edge cases.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 (EC-2) | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 2 | 1 (EC-1) | 1 (EC-4) | 0 |
| T2.4 | 0 | 0 | 0 | 0 |
| T2.5 | 0 | 0 | 0 | 0 |
| T2.6 | 1 | 0 | 1 (EC-3) | 0 |
| T2.7 | 0 | 0 | 0 | 0 |
| ADRs | 1 | 0 | 0 | 1 (EC-5) |

**Verdict:** PLAN NEEDS ADJUSTMENT — EC-1 (tsc rootDir) is a potential TOTAL BUILD BREAK that requires investigation before implementation. EC-2 (auth subdir) requires baseline correction.
