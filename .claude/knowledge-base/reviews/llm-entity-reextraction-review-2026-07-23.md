# Review: llm-entity-reextraction (+ m13-noise-retirement) — M13

**Date:** 2026-07-23
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-observability, domain-cli-tooling, domain-database
**Diff base:** origin/main..develop
**Findings:** 0 BLOCKER · 5 HIGH (deduped: 2 distinct root causes) · ~14 MEDIUM · ~16 LOW · INFO
**Verdict:** READY_TO_MERGE (all HIGH + load-bearing MEDIUM fixed inline; F-xval-2 carried as an explicit release precondition — the noise-retirement live appendix)

## HIGH findings — all FIXED inline

| id (agents) | Finding | Fix |
|---|---|---|
| F-arch-1 / F-dom-db-1 | supersedeEntity's blind edge-endpoint UPDATE collides with `entity_edges_scope_triple_uq` when NEW already carries the identical triple → whole supersede tx rolls back → reextract batch aborts mid-chunk → resume livelock | Edge repoint now DROPs the colliding old-side row first (image already exists on NEW), then UPDATEs the remainder — mirrors the links path. RED test `test_supersede_survives_duplicate_edge_on_new_side` + chaos `test_supersede_mid_tx_failure_rolls_back_completely`. |
| F-dom-cli-1 | `--dry-run --retire-mechanism --commit` executed the destructive delete (commit silently won over an explicit dry-run — #252 class) | Contradictory `--dry-run` + `--commit` → stderr + exit 2 (fail-closed). Spawn regression test. |
| F-arch-7 / F-dom-obs-1 / F-wire-1 | OTel events (`reextract_chunk_done`, `reextract_noise_retired`) unreachable in production — CLI never wired a tracer; `emitEvent` no-ops on undefined | (see fix commit) tracer resolved at the CLI composition root; events now fire in the deployed artifact |
| F-tests-1 / F-arch-4 / F-dom-cli-7 | Plan-declared lowercase-type normalization not implemented — 'person' coerced to OTHER instead of PERSON | `applyOntologyToEntities` uppercases a case-variant of an allowed type before coercion. RED unit `test_lowercase_semantic_type_normalized_before_validation`. |
| F-arch-2 / F-dom-db-2 / F-wire-2 | retire anchor guard evaluated only in the up-front SELECT — TOCTOU: a concurrent supersede turning a candidate into an anchor pointee gets it deleted (audit pointer nulled) | Guard re-asserted INSIDE the delete via a `targets` CTE — the destructive statement is self-guarding. |

## MEDIUM — fixed inline

- F-arch-6 / F-dom-cli-2 / F-dom-obs-3: split `target_failed_parse` (SyntaxError/ZodError) from `target_failed_llm`; exit-1 predicate sums every `target_failed_*`. Unit `test_parse_failure_is_distinct_typed_skip`.
- F-dom-db-3: reextract detects a silently-failed link (fail-soft linkEntities) BEFORE supersede → `target_failed_link`, no checkpoint (a subsequent --retire never deletes a memory whose graph failed).
- F-dom-db-4: partial index `entities_superseded_by_idx` (migration 0028) serves the anchor-guard NOT EXISTS + FK-enforcement hot paths.
- F-arch-3: dead `EntityLinkingDeps.ontology` member removed (public surface; pre-release breaking, sanctioned).
- F-arch-10: `MECHANISM_SQL` de-duplicated to a single export in batching.ts.

## Deferred (documented, not blocking) — into a follow-up hardening slice

- F-dom-cli-3/F-dom-obs-4: per-chunk stdout progress line + skipped-counters in the event attributes (report-only observability is acceptable now that the tracer is wired).
- F-arch-8/F-dom-db-5: FK `ON DELETE SET NULL` resurrection semantics — documented; RESTRICT is a future migration (both current deleters guard anchors, so latent).
- F-dom-db-7: GC two-statement snapshot race — narrow; retire.ts already demonstrates the single-CTE shape to adopt.
- F-xval-2 (RELEASE PRECONDITION): T4.1 numeric ≤10 targets NOT met by supersede alone; closure is the m13-noise-retirement live `--commit` appendix (this session, post-deploy).
- F-tests-7 (chain A→B→C), F-dom-cli-4 (checkpoint-corruption exit-2 class): follow-up tests.

## Quality gates

- Full contract suite: green (post-fix sweep).
- typecheck: 0 errors · lint: 0 · code-quality: PASS_WITH_CAVEATS.

## Handoff decision

READY_TO_MERGE for the code. The M13 ROADMAP checkbox flip is gated on the live noise-retirement appendix (F-xval-2) landing in the T4.1 report.
