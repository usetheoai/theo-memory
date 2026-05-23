# SEPA Initial Brief Response — v0-1-local-runtime

Generated 2026-05-23 (initial brief). Agent ID: `aaed38c487866ac35` (continuable via SendMessage during halt-loop).

## Acceptance
- Read all 3371 lines of the brief end-to-end.
- Confirmed understanding of: 23 tasks across 9 phases, 10 plan ADRs D1.0-D1.9, 9 contract ADRs ADR-0001-0009, 18 absorbed edge cases, deps-audit verdict PASS_WITH_CAVEATS (89), plan-confidence SHIPPABLE (96.4), HNSW dim cap 1536 per D1.7, prompt-injection escape per EC-4, embedder dim probe per EC-5.

## Immediate findings (read-through audit — BEFORE iteration 1)

- **[MAJOR]** T8.1 OTel span assertion ambiguity. The plan splits "8 write phase spans" + "9 search step spans" into 2 separate test assertions. Global DoD says "17 spans observed non-zero". The wiring-triad pillar (c) "metric > 0" can be gamed by a single phase firing 17 times unless the test asserts 17 UNIQUE span names (Set semantics). **Action at T8.1 pre-RED:** decide assertion shape — recommend collecting all span names into a Set and asserting size ≥ 17 with explicit enum of expected names.

- **[MINOR]** drizzle-kit 0.28 CLI may have removed `push:pg` / `generate:pg` subcommands (used by T0.1 scripts). Modern syntax is `drizzle-kit push --dialect=postgresql`. **Action at T0.1 GREEN:** run `npx drizzle-kit --help` first to confirm exact subcommand shape. If broken, fix in T0.1 (not T2.2).

- **[MINOR]** ADR D1.4 declares MemoryEvent enum with 12 values (initial design), but EC-10 absorption adds `extraction_failed` → T4.2 RED test asserts "has_13_values". The narrative section of D1.4 still says 12; verify JSDoc count matches at T4.2 pre-COMMIT.

- **[MINOR]** T0.4 acceptance lacks a test that lint script REMAINS narrow (only `src/core/**/*.ts`) until T2.1 widens it. **Action at T0.4 pre-COMMIT:** grep `package.json` scripts.lint, assert NOT yet widened.

- **[INFO]** Phase count nomenclature: brief preamble says "8 phases" (referring to Mem0 write pipeline), plan body says "Phase 0-8" (= 9 plan phases). Plan v1.2 D1.0 explicitly says "8 named Mem0 pipeline phases (numbered 0 through 8 with 4-5 merged as dedup+payload) inside T4.3" — clean. But T4.3 test `test_pipeline_emits_8_completed_events` needs to reconcile: if phases 0+1 are merged in actual events, that's 7 + entity-link + save-messages = 9 names. Lock the mapping at T4.3 pre-RED.

- **[INFO]** T4.1 reads Mem0 prompt content from `referencia/mem0/mem0-ts/src/oss/src/prompts/` — surface the exact filename at T4.1 pre-RED to prevent drift from blueprint Recommendation 5.

- **[INFO]** T7.1 dimension probe uses literal string `'__themem_probe__'`. Verify it's reserved (never user-supplied) and that embedder stubs return deterministic 1536-dim for ANY input.

- **[INFO]** Plan v1.2 §Dependency Graph ASCII has alignment drift (two `│` columns not aligned). Cosmetic only.

## Cross-references verified

- ADR D1.7 ↔ T2.1 (MAX_EMBEDDING_DIM = 1536): **OK**
- EC-4 absorption ↔ T4.1 (escapeMarkdownHeaders): **OK**
- EC-5 absorption ↔ T7.1 (dimension probe): **OK**
- EC-3 absorption ↔ T3.1 (TRUNCATE pattern): **OK**
- ADR D1.8 (zod pin) ↔ Dependencies table: **OK**
- ADR D1.9 (drizzle-orm pin) ↔ Dependencies table: **OK**

## Pre-implementation recommendations (HALT-OR-PROCEED)

1. **Before T0.1 GREEN**: `npx --package=drizzle-kit@0.28.0 drizzle-kit --help` to confirm subcommand shape. Fix scripts if `push:pg` is removed.
2. **Before T0.3 GREEN**: verify `docker compose` (V2) available, not `docker-compose` (V1).
3. **Before T2.1 GREEN**: confirm `src/core/constants.ts` does NOT exist (verified absent at brief time).
4. **At T4.3 pre-RED**: lock the phase-to-span mapping table to resolve 8-vs-9 ambiguity.
5. **At T8.1 pre-RED**: decide Set-semantics assertion for 17 unique span names.

**Verdict: PROCEED with halt-loop iteration 1 (T0.1).** No CRITICAL blockers found; the 5 actionable recommendations are tactical guidance for the per-iteration SEPA calls, not pre-implementation HALTs.
