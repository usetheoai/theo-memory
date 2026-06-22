# Implement Validation — embedder-registry (Item 24)

**Date:** 2026-06-22
**Plan:** `.claude/knowledge-base/plans/embedder-registry-plan.md`
**Verdict:** PASS
**Commit:** `5631418` feat(embedders): embedder registry + 3 fetch-based providers (Item 24)

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (contract) | PASS — 0 type errors |
| `pnpm -C packages/core build` / `npm run build` (tsconfig.build, exactOptionalPropertyTypes) | PASS |
| Contract suite (`vitest --config vitest.contract.config.ts`) | PASS — 1144 passed, 2 skipped (incl. 12 new embedder adapter + 5 registry unit tests) |
| GOAL integration (`tests/integration/embedder-registry.test.ts`) vs real `ankane/pgvector:v0.5.1`, run under the canonical `vitest.integration.config.ts` | PASS — 2/2 (registry-built embedder round-trips remember+recall; unknown-key → EmbedderError). Requires the 4 embedder-subpath src aliases added to `vitest.integration.config.ts` (review fix F-xval-1). |
| Subpath isolation + 4 new subpath smokes (`subpath-isolation.test.ts`, `full-public-surface.test.ts`) | PASS (serial) — registry static graph excludes openai/local SDK adapters |
| `/code-quality embedder-registry` | PASS (score_cap 100; 0 hard/soft caps; languages_audited=[typescript]) |

## Wiring triad (per task)

- **Caller:** `createEmbedder(spec)` is the public factory; consumed by the GOAL integration test composing it into `createLocalMemory({ embedder })` → remember/recall.
- **Integration test:** `tests/integration/embedder-registry.test.ts` (real pgvector) + `subpath-isolation.test.ts` bundle-isolation walk.
- **Runtime observability:** fail-loud typed errors — `EmbedderError` (unknown key, lists valid providers) + `EmbedderUnavailableError` (absent SDK, install hint). No silent fallback.

## Acceptance criteria (plan)

- [x] `createEmbedder` resolves all 6 providers; unknown key → `EmbedderError`; missing SDK → `EmbedderUnavailableError`.
- [x] `@usetheo/memory/embedders/registry` static-import graph excludes `openai`/`@xenova` (bundle-isolation test).
- [x] 4 new subpaths smoke-import.
- [x] 3 fetch-based adapters (Ollama/Voyage/Google) — ZERO new dependency (Node-global `fetch`).
- [x] GOAL: registry-built embedder round-trips remember+recall vs real pgvector + unknown-key EmbedderError.

## Pre-existing failures (NOT introduced by this cycle — disclosed per Inquebrável Rule 3)

Proven pre-existing by stashing ALL Item-24 changes (`git stash -u`), rebuilding, and re-running — the failures persist on clean HEAD:

- `tests/integration/pgvector-store.test.ts` — 2 tests (`rejects empty description` / `rejects empty derivedFrom` with `InvalidSkillError`) fail with a dual-module-identity mismatch (the thrown error IS an `InvalidSkillError` but from a different module copy than the test imported). Out of Item-24 scope; recorded as a separate followup.
- 5 `.claude/knowledge-base/references/mem0/**` files — the read-only reference clone's OWN tests, picked up by the vitest glob; fail because the clone's deps (e.g. `axios`) are not installed. Read-only study material; not our code.

The integration suite must be run with `--no-file-parallelism` — several integration tests spawn `npm run build`/`npm pack` which `rmSync('dist')` and race the dist-resolving tests under default parallelism (known flake; `integration-suite-stabilization`).
