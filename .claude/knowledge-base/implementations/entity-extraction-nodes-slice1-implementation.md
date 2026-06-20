# Implementation contract — entity-extraction-nodes-slice1

Plan: `.claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md` (SHIPPABLE 96.8)
Branch: `develop`
Working contract for the TDD halt-loop. One task per iteration: RED → GREEN → REFACTOR → WIRING → COMMIT.

## Locked decisions (from plan ADRs + CLAUDE.md Amendment 2026-06-20)
- Entities via `compromise` (lazy `require` + regex fallback), NOT spaCy. OPTIONAL dep.
- 2 Postgres tables: extend `entities` (+ `normalized_key`, `type`, scope cols) + new `memory_entities`. NO graph DB.
- Dedup identity: UNIQUE `(workspace_id, scope_signature, type, normalized_key)` (EC-1).
- Phase 7 `entityBoost`-gated + FAIL-SOFT (entity failure never fails remember()).
- Endpoint response shape UNCHANGED (gateway/dashboard untouched).
- Relations/edges = Slice 2 (out of scope here).

## Task list (ordered)

| # | Task | Phase | Status | Files |
|---|---|---|---|---|
| T1.1 | EntityExtractor DIP | 1 | pending | `packages/core/src/domain/dip/entity-extractor.ts` (NEW) |
| T1.2 | CompromiseEntityExtractor (compromise + regex fallback, 8 tests incl. EC-2 drop guard) | 1 | pending | `packages/core/src/infrastructure/extraction/compromise-entity-extractor.ts` (NEW); `package.json` (compromise optional) |
| T2.1 | schema extend + migration 0017 (UNIQUE incl. type; memory_entities CASCADE; EC-5 dim parity) | 2 | pending | `schema.ts`; `migrations/0017_entity_nodes.sql` (NEW); `schema.test.ts` |
| T3.1 | wire Phase 7 (gated, fail-soft, EC-2/3/4) + `entity_linking_failed` event | 3 | pending | `pipeline.ts`; events union; `extraction-pipeline.test.ts` |
| T4.1 | entitiesHandler reads real table (shape unchanged, workspace isolation) | 4 | pending | `entities.ts`; `__tests__/entities.test.ts` |
| T5.1 | integration: real-pgvector extract→list round-trip (THE GOAL TEST) | 5 | pending | `tests/integration/entities/extract.test.ts` (NEW) |

## Per-task TDD + wiring + DoD
See the plan's Phase sections for each task's RED tests, Acceptance Criteria, Concurrency tests, Failure scenarios, and DoD. The plan is the contract; this file tracks status.

## Wiring triad targets
- `EntityExtractor` / `CompromiseEntityExtractor` — caller: the pipeline Phase 7 (T3.1). Integration test: T5.1. Metric: `entity_linking_failed` OTel event (fail-soft path) + entity-persist count.
- `entitiesHandler` upgrade — caller: existing route registration (unchanged). Integration: T4.1 + T5.1.

## Global DoD (from plan)
- npm test + typecheck + lint exit 0; THE GOAL TEST green vs real pgvector; migration additive + journal synced; compromise OPTIONAL (bundle isolation); CHANGELOG Added entry; no-paper-names clean; gateway/dashboard UNCHANGED.
