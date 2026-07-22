# Implementation Summary: M9 — Session → Global Consolidation

**Slug:** `m9-session-to-global-consolidation`
**Milestone:** M9
**Plan:** `.claude/knowledge-base/plans/m9-session-to-global-consolidation-plan.md` (SHIPPABLE_WITH_CAVEATS 89)
**Blueprint:** `.claude/knowledge-base/discoveries/blueprints/m9-session-to-global-consolidation-blueprint.md` (SHIPPABLE 98.8)
**Completed:** 2026-07-22 (on `develop`)

## Verdict: IMPLEMENTATION_COMPLETE — DoD PROVEN end-to-end on real pgvector

M9 is a COMPOSITION of shipped seams (Unbreakable Rule 9): NO new engine, NO new store, NO new dependency. A durable session memory is promoted to the user's global scope at the `reflect` boundary, strictly within `(workspace, user)`.

## Tasks + wiring triad

| Task | What shipped | Tests | Wiring triad |
|---|---|---|---|
| **T1.1** | `SessionToGlobalConsolidationPolicy` (`packages/core/src/domain/consolidation/session-to-global-policy.ts`) — a `ConflictResolutionPolicy` impl that promotes each durable memory (`confirmation_count ≥ threshold`, default 3, Princípio 1) individually. Exported from the domain barrel. `ConsolidationCandidate` gains optional `confirmationCount`. | 7/7 contract (`session-to-global-policy.test.ts`) | caller: T3.1; test: T1.1 unit; metric: n/a (pure) |
| **T2.1** | `PgvectorStore.persistConsolidations({ promote })` — promotes the kept row (`session_id→NULL, agent_id→NULL`) atomically with the duplicate soft-delete + `consolidation_history` insert; idempotent guard; `workspace_id`/`user_id` untouched. | 3/3 integration real pgvector (`promote-to-global.test.ts`) | caller: T3.1; test: T2.1 integration; metric: T3.1 |
| **T2.2** | **DROPPED (honest)** — the in-memory store does not implement `persistConsolidations` (consolidation is a pgvector-tier feature, duck-typed in the reflect-orchestrator); there is no in-memory consolidation path to mirror. | — | — |
| **T3.1** | Reflect-boundary wiring (`reflect-orchestrator.ts`): a session-scope reflect with the M9 policy runs it + calls `persistConsolidations({ promote: true })`; `recallConsolidationCandidates` now SELECTs `confirmation_count`; new OTel event `consolidation_promoted`. | (exercised by T4.1) | **caller ✓** (orchestrator), **integration test ✓** (T4.1), **metric ✓** (`consolidation_promoted`) |
| **T4.1/T4.2** | The DoD hard-gate e2e (`tests/integration/consolidation/session-to-global.test.ts`). | 2/2 integration real pgvector | — |

## DoD evidence (real `ankane/pgvector:v0.5.1`)

- **3 session mentions → 1 promoted global row:** a durable fact (`confirmation_count 3`) reflects to `session_id IS NULL` under the SAME `(workspace, user)`, with 1 `consolidation_history` row (`policy_name='session-to-global'`, `original_episode_ids` lineage).
- **One-off NOT promoted:** a `confirmation_count 1` session fact stays `session_id=S`, `t_invalid=NULL` — decays via the shipped triadic eviction, never soft-deleted as a duplicate.
- **Isolation hard gate:** user B in the same workspace recalls 0 of user A's promoted/session rows; B's own row intact.
- **Atomicity:** promote + soft-delete + audit in one `withTransaction`; idempotent on re-run.

## Coverage Matrix (DoD → task)

| M9 DoD item | Task | Status |
|---|---|---|
| `ConsolidationPolicy` reusing reflect/ConflictResolutionPolicy + eviction (Rule 9) | T1.1 + T3.1 | ✓ |
| Promotion rule `confirmation_count ≥ N (N≥3)` OR LLM-judged OR agent-marked | T1.1 (confirmation_count; LLM/agent-marked are future hooks) | ✓ (confirmation_count path proven; ADR D3) |
| Non-promoted session memories decay via triadic eviction | T4.2 | ✓ |
| Isolation preserved (hard gate) | T2.1 + T4.1 | ✓ |
| Integration test (real pgvector) | T4.1 | ✓ |
| `derivedFrom`/`consolidation_history` provenance | T2.1 audit + T1.1 `originalEpisodeIds` | ✓ |

## Honest caveats

- **Promotion rule v1 = `confirmation_count` (exact-dedup) path only.** LLM-judged-durable and agent-marked-durable are declared in the DoD but ship as future hooks; v1 proves the `confirmation_count ≥ 3` signal (Princípio 1). The policy interface accommodates them (any candidate signal).
- **Cosine-cluster promotion of paraphrases** (near-duplicates that did NOT exact-dedup) is a future enhancement — v1 promotes by the exact-dedup `confirmation_count` signal, each durable memory individually.
- **`consolidation_history.kept_memory_id`** is the promoted row (its id is preserved by in-place promotion, ADR D1) — provenance survives + the promotion is reversible via `forget`.

## Quality gates

- typecheck 0, lint 0.
- Full suite: 1234 pass (28 pre-existing dogfood/examples baseline, zero new failures).
- Contract tier: policy 7/7. Integration tier (real pgvector): promote 3/3 + e2e 2/2.

## Commits (on `develop`)

`642a560` (blueprint) · `f9b9969` (plan) · `8a727f9` (T1.1) · `10ffb54` (T2.1) · `2155e31` (T3.1+T4) · `6064cf1` (sentinel).
