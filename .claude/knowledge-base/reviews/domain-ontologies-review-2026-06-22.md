# Review: domain-ontologies

**Date:** 2026-06-22
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-database
**Findings:** 31 total (BLOCKER: 0, HIGH: 2, MEDIUM: 7, LOW: 7, INFO: 15)
**Verdict:** READY_TO_MERGE

The domain-ontologies feature (Roadmap Item 15) passed all 6 specialist reviews with **zero BLOCKER**. Both HIGH findings + the key MEDIUMs were **closed inline** (commit `63284d3`). The 2 HIGH converged on one root cause (the entity-type-persist change leaking into the default no-ontology path); it is fully resolved by gating.

## HIGH findings (both closed inline)

### F-dom-db-1 — entity-type persist changed default-path dedup semantics → CLOSED
- Found by: domain-database (HIGH); corroborated by architecture (F-arch-1), cross-validation (F-xval-1), domain-memory-layer (F-dom-1).
- The first implementation changed `entity-linking.ts` to persist the LLM's `e.type` (instead of the hardcoded `'PROPER'`) so domain types reach `entities.type`. But the entity dedup UNIQUE identity (`entities_scope_type_key_uq`) includes `type` — so on the DEFAULT (no-ontology) path, the LLM's non-deterministic coarse types (PERSON/ORG/OTHER) would fragment the same entity into multiple rows (inflating the Entities tab, fragmenting `memory_count`, splitting graph nodes) — a regression to the shipped entity-graph feature.
- **Fix (ADR D5):** gate the type-carry on an active ontology (`deps.ontology !== undefined`). With NO ontology, keep the shipped `'PROPER'` placeholder → the default-path dedup identity is byte-unchanged. Only the opt-in ontology path carries the (constrained + coerced) domain type. NO migration; NO change to shipped entity dedup. Relation-endpoint auto-created nodes take `OTHER` under an ontology, `'PROPER'` otherwise. Verified: default-path entity integration tests green with `'PROPER'`; ontology GOAL test persists `Diagnosis`/`OTHER`.

### F-tests-1 — fail-soft path untested → CLOSED
- Found by: tests.
- ADR D2 promises the ontology layer never fails `remember()`, but no test exercised the try/catch.
- **Fix:** added a pipeline fail-soft test — a broken tracer that throws on the `ontology_type_coerced` event causes the coercion to throw; the test asserts `runExtractionPipeline` still RESOLVES + persists the fact (the ontology try/catch swallows the throw). Plus a coercion-event-emitted test + a no-ontology-no-event test.

## MEDIUM findings

- **F-tests-2 (GOAL under-delivery) → CLOSED:** the integration GOAL now asserts all its AC truths — in-vocab persists, out-of-vocab coerces to OTHER, `ontology_type_coerced` span emitted (real tracer), AND a default-path-persists-PROPER case.
- **F-dom-2 (linkEdges endpoint hardcode) → CLOSED:** relation-endpoint auto-created nodes now take `OTHER` under an ontology (consistent with the coercion model), `'PROPER'` otherwise.
- **F-arch-1 / F-dom-1 / F-xval-1 (default-path behavior change) → CLOSED:** resolved by the F-dom-db-1 gating — the default path is now byte-unchanged including persistence; no CHANGELOG `Changed` entry needed.
- **F-arch-2 (resolveOntology per remember) → ACCEPTED:** `scoped-memory` re-resolves the ontology per `remember()`. For a built-in key this is a property lookup; for a custom object it re-runs the 4 cheap `validateOntology` checks (already validated at the factory, so it never throws). Negligible cost; pure. Optimizing to resolve-once requires storing the resolved value on shared config — deferred as not worth the indirection.

## LOW / INFO findings (advisory — accepted)

- **GOAL integration test omits the integration-path span assertion** (F-wire-3) — now ADDED (the GOAL asserts the span). 
- **SYSTEM_PROMPT still lists the generic `PERSON|ORG|...` enum** (domain-memory LOW) — the ontology directive is PREPENDED (higher priority) + post-parse coercion is the enforcement safety net; the residual generic enum slightly weakens steering but cannot defeat the coercion. ACCEPTED.
- **F-arch-3 (vacuous try/catch)** — the ontology try/catch is NOT vacuous: `applyOntologyToEntities` calls `emitEvent` which can throw via a misbehaving tracer (now exercised by the F-tests-1 fail-soft test). ACCEPTED (defense-in-depth, now tested).
- **F-xval-3 (plan said "zod validator", impl uses plain `validateOntology`)** — KISS; same typed-error contract; zero deps. ACCEPTED.
- Built-in vocabularies curated; `validateOntology` enforces `OTHER` in every ontology so the coercion safety net cannot be configured away (positive).

## Cross-validation summary

- Plan tasks: 5 (T1.1, T2.1, T2.2, T3.1, T4.1) — Fully implemented: **5** · Partial: 0 · Missing: 0 · Diverged: 0 (the T4.1 entity-type-persist behavior is now documented + scoped via ADR D5).
- ADR compliance: **5/5** (D1 flat Ontology no-OWL · D2 prompt-inject + post-parse coerce + observable + keep-relations · D3 no poly-store / no migration · D4 opt-in slot default-unchanged · D5 entity-type persist gated on ontology).
- Coverage Matrix: all rows mapped + implemented.
- No fabricated citations; plan frozen before implementation.

## Quality gates summary

- `npm test` (contract): **1126 passed | 2 skipped**, 0 failed, 0 type errors
- `npx vitest --config vitest.integration.config.ts` (full): 0 failed (incl. the ontology GOAL + the default-path entity tests + p0-audit export-surface)
- `npm run typecheck`: 0 errors · `npm run lint`: 0 warnings
- `/code-quality domain-ontologies`: **PASS 100** (0 hard caps, 0 soft caps, no symbol_fabrication, no dead_public_export)
- Wiring triad: CALLER (createLocalMemory → factory resolveOntology → MemoryConfig.ontology → scoped-memory → pipeline prompt-inject + applyOntologyToEntities → entity-linking persist) + INTEGRATION TEST (real pgvector, domain type persists) + METRIC (`ontology_type_coerced` in MEMORY_EVENTS, real span asserted) — all honest PASS.
- Persistence: NO migration (D3); reuses `entities.type` + `entity_edges.relation` text columns. Deps: ZERO new dependencies (reuses `zod`).
- No paper names in `src/**` (the bare `mem0` prose was removed; `@see references/` path coordinates retained per the rule).

## Spawned agents (audit trail)

- `.claude/agents/review-domain-ontologies-2026-06-22/{architecture,tests,wiring,cross-validation,domain-memory-layer,domain-database}.md`
- Findings: `.claude/agents/review-domain-ontologies-2026-06-22/findings/*.yml`

## Handoff decision

**READY_TO_MERGE** — 0 BLOCKER, both HIGH closed inline (`63284d3`, ADR D5 + fail-soft test), key MEDIUMs closed, LOW/INFO accepted with rationale. Next: `/release` (cut `develop` → `main` semver tag).
