# Implement Validation — extract-cli-to-packages

**Date:** 2026-06-15
**Branch:** develop
**Plan goal:** Move `src/agent-tools/` to `packages/cli/src/`, delete root `src/`, measured by `pnpm test && pnpm typecheck && pnpm lint` zero errors, `themory --help` functional post-build, `ls src/` → "No such file or directory".

## Context

The `extract-cli-to-packages` file moves + config updates were implemented incrementally across commits `93d8034`..`f000f84` (T1.1 move, T2.1-T2.7 configs, lint/test fixes). This session completed the **validation tail**: the remaining test-import-path migration AND a build-topology fix that the move exposed (the plan goal `themory --help após build` was failing).

## Validation gates (all GREEN)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` (`tsc --noEmit -p tsconfig.contract.json`) | PASS — 0 errors (resolves every `@usetheo/*` import via tsconfig paths) |
| Lint | `pnpm lint` (eslint core+api+cli) | PASS — 0 warnings |
| Contract tests | `pnpm test` (vitest contract) | PASS — 122 files, 930 tests pass, 2 skip, no type errors |
| Build | `pnpm build` | PASS — emits `dist/agent-tools/cli.js` + migrations + alias rewrite (75 specifiers / 47 files) |
| CLI boot (env-free) | `node dist/agent-tools/cli.js --help / --version / mcp --help` | PASS — exit 0, lists 8 subcommands, no optional deps required |
| Plan goal: src deleted | `ls src/` | PASS — "No such file or directory" |
| Code-quality (D2/dead-code) | `/code-quality extract-cli-to-packages` | PASS (after ADR-0016 detector fix) |

## Defects found + fixed during validation

1. **dist `@usetheo/*` alias resolution** — bare specifiers resolved to TypeScript source under plain Node (`ERR_MODULE_NOT_FOUND: packages/mcp/src/server.js`). Fixed: `postbuild:rewrite-aliases` (`scripts/rewrite-dist-aliases.mjs`). Commit `57880fb`.
2. **eager optional-dep load** — CLI router statically imported `LocalTransformerEmbedder` (@xenova) + `OpenAILLM` (openai), so `--help` required optional deps. Fixed: lazy-import at `wireMemoryFromPool`. Commit `57880fb`.
3. **vestigial mcp bin** — `@usetheo/memory-mcp` bin pointed at a never-built per-package dist. Removed (root provides it). Commit `57880fb`.
4. **code-quality D2 false-positive** — workspace packages flagged as fabricated npm packages. Fixed: D2 workspace-awareness, [ADR-0016](../adrs/ADR-0016-code-quality-d2-workspace-awareness.md). Commit `8e93f4a`.

## Wiring triad (build-fix slice)

- **Caller:** `scripts/rewrite-dist-aliases.mjs` invoked by `package.json#build`; lazy import at `wireMemoryFromPool` exercised by every `themory mcp/server/remember/...` runtime path.
- **Integration test:** `tests/integration/p0-audit/cli-dist-boot-envfree.test.ts` (4 assertions GREEN — env-free dist boot + alias-rewrite invariant).
- **Runtime observability:** `rewrite-dist-aliases.mjs` logs `rewrote N specifier(s) across M file(s)` and fail-loud exits on any unresolved `@usetheo/*` specifier.

## Commits in this slice (this session)

- `a827ebb` docs(roadmap): cross-validation backlog
- `57880fb` fix(build): themory CLI boots under node post-build
- `f354a57` refactor(tests): migrate test import paths to @usetheo/* packages
- `8e93f4a` fix(code-quality): D2 recognizes pnpm workspace packages (ADR-0016)

## Verdict

**PASS** — all plan goal criteria met; all validation gates green; defects exposed during validation fixed with regression guards. Ready for `/review`.
