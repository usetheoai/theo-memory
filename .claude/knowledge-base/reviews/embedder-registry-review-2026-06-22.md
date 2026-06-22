# Review: embedder-registry (Roadmap Item 24)

**Date:** 2026-06-22
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-observability
**Findings:** 1 HIGH, 3 MEDIUM, 2 LOW, remainder INFO (0 BLOCKER)
**Verdict:** READY_TO_MERGE (all HIGH + MEDIUM + LOW closed inline)

## Summary

The embedder registry (Item 24) adds `createEmbedder(spec)` — a string-keyed factory resolving an `Embedder` from a provider key via LAZY dynamic import — plus 3 fetch-based adapters (Ollama, Voyage, Google Gemini) with ZERO new dependency. Architecture (18 INFO, 0 defects), domain-memory-layer (13 INFO, 0 defects), and tests (19 PASS + 1 minor) agents found the implementation sound: DIP-clean (2-method Embedder contract per ADR-0008), bundle-isolated (registry static graph excludes the openai/@xenova SDK adapters), fail-loud typed errors, order-preserving defensive-copy vectors, empty-batch short-circuit. Cross-validation surfaced one load-bearing HIGH (test config alias miss) and observability one MEDIUM (deferred-auth). All actionable findings were fixed inline before merge.

## HIGH findings (fixed inline)

### F-xval-1: GOAL test not runnable from the committed tree (vitest.integration.config.ts alias miss)
- Severity: HIGH — Found by: cross-validation
- File: `vitest.integration.config.ts`
- Plan ref: T4.1 (listed `vitest.integration.config.ts` as a file-to-edit)
- Detail: the integration config aliases every `@usetheo/memory/*` subpath to `src` for test runs, but the 4 new embedder subpaths (`registry`/`ollama`/`voyage`/`google`) were missing → under the canonical `vitest.integration.config.ts` the GOAL test failed to collect (`Cannot find package`). The earlier "GOAL 2/2" run resolved via built `dist` under the default config, masking the gap.
- Fix: added the 4 src aliases (mirroring `stub`/`openai`/`local`). VERIFIED: GOAL now passes 2/2 under `--config vitest.integration.config.ts` against real `ankane/pgvector:v0.5.1`. Validate report updated to disclose the dependency (closes F-xval-3 overclaim).

## MEDIUM findings (fixed inline)

### F-obs-1: Voyage/Google did not fail-fast on a missing API key
- Severity: MEDIUM — Found by: domain-observability
- File: `voyage.ts`, `google.ts`
- Fix: both constructors now throw a typed `EmbedderError` with an actionable message when no key is provided via option or env (Inquebrável Rule 8 — fail early/loud/clear) instead of deferring to an opaque HTTP 401. `apiKey` field narrowed `string | undefined` → `string`. Regression tests added (`vi.stubEnv` empty key → throws).

### F-wire-1: EMBEDDER_REGISTRY exported without documented intent
- Severity: MEDIUM — Found by: wiring
- File: `registry.ts`
- Fix: added JSDoc clarifying the read-only map is exported for provider-key enumeration; `createEmbedder` is the intended construction entry point. (Kept exported by design — harmless `Readonly` enumeration surface.)

### (tests minor) SDK happy-path not unit-tested
- Severity: MEDIUM→INFO (accepted) — Found by: tests
- Rationale: openai/local adapters shipped in v0.1 and are exercised by their own suites; the registry only adds the lazy-load + error translation, which IS tested (missing-SDK → EmbedderUnavailableError). Accepted pre-release.

## LOW findings (fixed inline)

### F-xval-2: GoogleEmbedder routes single embeds through :batchEmbedContents
- File: `google.ts` — Fix: added a JSDoc/inline note documenting the deliberate single-via-batch simplification (functionally identical, one code path).

### F-obs-2: isModuleNotFound regex fallback permissive
- File: `registry.ts` — Fix: added a comment documenting the primary (error-code) vs secondary (message) detection layers.

## Edge-case coverage

- Empty-batch short-circuit (no fetch) — covered (ollama/voyage/google).
- Non-2xx HTTP → EmbedderError — covered (500/401/403).
- Malformed response (missing field / count mismatch) → EmbedderError — covered.
- Order preservation across batch — covered.
- Unknown provider key → EmbedderError (valid-keys list) — covered.
- Missing SDK → EmbedderUnavailableError (install hint) — covered.
- Missing API key → fail-fast EmbedderError — covered (new).
- Bundle isolation (registry ⊅ openai/local SDK adapters) — covered (static-import walk).

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 EmbedderUnavailableError | fully |
| T2.1 Ollama | fully |
| T2.2 Voyage | fully |
| T2.3 Google | fully (single-via-batch divergence documented) |
| T3.1 registry + subpaths + isolation | fully |
| T4.1 GOAL integration | fully (after F-xval-1 fix) |

- ADR D3 zero-dep CONFIRMED — `dependencies`/`optionalDependencies` unchanged.
- 6 `EmbedderProvider` keys == registry keys exactly.

## Quality gates summary

- Contract suite: PASS — 1146 passed, 2 skipped (incl. 14 embedder adapter + 5 registry + EmbedderUnavailableError + 2 fail-fast tests).
- `tsc --noEmit` (contract) + `tsc -p tsconfig.build.json` (exactOptionalPropertyTypes): PASS.
- GOAL integration vs real pgvector under canonical integration config: PASS 2/2.
- Touched integration files (embedder-registry + subpath-isolation + full-public-surface) under integration config: PASS 67/68 (1 skip).
- `/code-quality embedder-registry`: PASS (score_cap 100; 0 hard/soft caps).
- npm pack ships dist `embedders/{ollama,voyage,google,registry}.{js,d.ts}`.

## Pre-existing failures (NOT introduced; disclosed per Inquebrável Rule 3)

Proven pre-existing via `git stash -u` + rebuild + re-run (failures persist on clean HEAD):
- `tests/integration/pgvector-store.test.ts` — 2 tests (`InvalidSkillError` dual-module-identity). Out of Item-24 scope; recorded as a separate followup.
- 5 `.claude/knowledge-base/references/mem0/**` files — the read-only reference clone's OWN tests (deps like `axios` not installed). Not our code.

Note: the integration suite must run with `--no-file-parallelism` (build-spawning tests race `dist/` under default parallelism — known `integration-suite-stabilization` flake).

## Spawned agents (audit trail)

- `.claude/agents/review-embedder-registry-2026-06-22/architecture.md`
- `.claude/agents/review-embedder-registry-2026-06-22/tests.md`
- `.claude/agents/review-embedder-registry-2026-06-22/wiring.md`
- `.claude/agents/review-embedder-registry-2026-06-22/cross-validation.md`
- `.claude/agents/review-embedder-registry-2026-06-22/domain-memory-layer.md`
- `.claude/agents/review-embedder-registry-2026-06-22/domain-observability.md`

## Handoff decision

READY_TO_MERGE — 0 BLOCKER; 1 HIGH + 3 MEDIUM + 2 LOW all closed inline and re-verified. Proceed to `/release` (minor bump → v0.17.0).
