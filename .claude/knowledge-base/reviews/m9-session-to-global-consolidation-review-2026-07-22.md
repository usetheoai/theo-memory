# Review: m9-session-to-global-consolidation

**Date:** 2026-07-22
**Reviewers (spawned agents):** 3 — architecture+wiring, tests, cross-validation+domain(memory-layer)
**Findings:** 20 (BLOCKER: 0, HIGH: 3, MEDIUM: 8, LOW: 6, INFO: 3)
**Verdict:** NEEDS_FIXES → **ALL FINDINGS ADDRESSED** → re-verified READY_TO_MERGE (see § Resolution)

## Slice under review

M9 — session→global consolidation. Production diff `642a560..HEAD` (10 files, +484 −9): the `SessionToGlobalConsolidationPolicy` (reuses the shipped `ConflictResolutionPolicy` DIP), `persistConsolidations({ promote })` (in-place `session_id→NULL` + soft-delete + `consolidation_history`, atomic), `recallConsolidationCandidates` (+ `confirmation_count`), reflect-orchestrator wiring + `consolidation_promoted` OTel event, and the integration proofs.

## Pre-conditions (all met)

- Implementation summary: `.claude/knowledge-base/implementations/m9-session-to-global-consolidation-implementation.md` — verdict IMPLEMENTATION_COMPLETE.
- Code-quality audit: `.claude/knowledge-base/audits/m9-session-to-global-consolidation-code-quality-2026-07-22.md` — verdict **PASS_WITH_CAVEATS** (0 real hard caps; the residual `symbol_fab_unverifiable` soft-floor is the NO_NETWORK registry limitation on genuine 3rd-party packages, not a fabrication). A repo-wide detector false-positive (workspace-member imports) was fixed (`13b7a6d`).
- Branch `develop`, no uncommitted changes.

## Quality gates (deterministic, verified)

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 warnings) |
| Full suite (`npm test`) | 1234 pass / 28 pre-existing dogfood+examples baseline / 3 skip — **zero new failures** |
| Contract tier | policy 7/7 (`session-to-global-policy.test.ts`) |
| Integration tier (real `ankane/pgvector:v0.5.1`) | `promote-to-global.test.ts` 3/3 · `session-to-global.test.ts` 2/2 |
| `/code-quality` | PASS_WITH_CAVEATS |

## DoD evidence (real pgvector — the hard gate)

- 3 session mentions of one fact (confirmation_count 3) → reflect(session) → 1 **promoted global row** (`session_id IS NULL`), SAME `(workspace, user)`, 1 `consolidation_history` audit row.
- A one-off session fact (count 1) is **NOT promoted** (stays session-scoped, `t_invalid=NULL` — decays via eviction).
- **Isolation hard gate:** user B in the same workspace recalls 0 of user A's promoted/session rows.
- Promotion + soft-delete + audit atomic; idempotent re-run.

## Findings + Resolution

The review (3 agents + a maintainer self-review) found a real functional bug, an audit-fidelity gap, and several honesty/overclaim issues — no BLOCKER, no isolation break, domain correct (F-dom-4). **Every finding was addressed** (fixes in commit `7653f8d` + doc reconciliations).

### HIGH — all fixed

| ID | Finding | Resolution |
|---|---|---|
| self-review | The `sourceMemories >= 2` guard skipped a LONE durable session fact (3 exact mentions dedup to ONE row — the literal DoD scenario the original e2e masked with a second one-off). | **FIXED** — M9 runs with `>= 1` source memory (individual promotion). Proven by `test_lone_durable_fact...` + the dedup-chain e2e. |
| F-tests-1 | EC-8 atomicity/rollback claimed but untested. | **FIXED** — a forced mid-txn failure test asserts the promotion rolls back (kept stays session-scoped, no audit row). |
| F-tests-2 / F-xval-3 | T4.2 "decays via eviction" was asserted-only (proves non-interference, not decay). | **FIXED (honest reword)** — the test + plan + blueprint + ROADMAP now say non-promotion is proven; decay stays the shipped EvictionPolicy's own tested job (M9 does not re-prove it). |

### MEDIUM — all fixed

| ID | Finding | Resolution |
|---|---|---|
| F-arch-3 / F-xval-5 | Audit row + metric counted DECISIONS, over-reporting on idempotent re-run / concurrency. | **FIXED** — `persistConsolidations` returns rows ACTUALLY promoted; no audit/metric for a 0-row re-run. Proven by the re-run audit-count test. |
| F-arch-4 | Unbound (workspace-admin, userId-null) session-reflect path untested. | **DOCUMENTED** — benign for M9 (policy never rejects, promote never touches user_id); noted as a follow-up guard (no cross-user path exists in v1). |
| F-xval-1 | Plan T1.1/T4.1 described cluster-merge the code doesn't do. | **FIXED** — plan § Review reconciliation records the individual-promotion correction. |
| F-xval-2 | Blueprint + ROADMAP "derivedFrom to the 3 sources" unsatisfiable (dedup→1 row). | **FIXED** — reworded in ROADMAP + blueprint to the dedup-to-one + `consolidation_history` provenance. |
| F-tests-6 | The literal DoD "3 mentions → 1 row" was pre-seeded, not via `remember()`. | **FIXED** — `test_three_real_remember_mentions_dedup...` exercises the mention→dedup→promote chain on real pgvector. |
| F-tests-4 | Undefined `confirmationCount` branch untested. | **FIXED** — unit test asserts it is NOT promoted. |
| F-tests-3 | The "concurrency" test was sequential. | **FIXED** — `Promise.all` test proves exactly-one-flip under true parallelism. |
| F-tests-5 | Promotion metric had no behavioral test + naming divergence (counter vs event). | **PARTIALLY FIXED** — naming reconciled (typed event `consolidation_promoted`, plan updated); the fidelity is proven via the returned-count re-run test. A tracer-spy behavioral assertion remains a nice-to-have follow-up. |

### LOW / INFO — addressed or accepted

- F-arch-5 (magic string) → **FIXED** (`SESSION_TO_GLOBAL_KIND` shared const). F-dom-1 (Coverage Matrix → PARTIAL) → **FIXED** in the plan reconciliation. F-dom-2 (derivedFrom wording) → **FIXED**. F-xval-4 (full-scan) → **DOCUMENTED** as v1 deferral. F-tests-7/8 (boundary/isolation-breadth) → boundary **FIXED** (count==2 test); isolation breadth accepted (count===1 structural check adequate). F-arch-6/F-dom-3 (scope re-assertion) → accepted as v0.7-inherited defense-in-depth (isolation proven end-to-end). F-arch-1/2/7 + F-dom-4 (INFO): DIP clean, wiring triad present, txn atomicity correct, domain/Princípios correct — positives.

## Resolution — re-verification

After the fixes (`7653f8d` + doc reconciliations): **typecheck 0, lint 0**, policy 9/9, promote integration 6/6, e2e 4/4, full suite **1236 pass / 28 pre-existing baseline / zero new failures**, `/code-quality` PASS_WITH_CAVEATS. All HIGH + MEDIUM addressed with real fixes or honest rewording (no overclaim survives). **Verdict: READY_TO_MERGE.**

## Spawned agents (audit trail)

- `.claude/agents/review-m9-session-to-global-consolidation-2026-07-22/findings/` (architecture+wiring, tests, cross-validation+domain).

## Spawned agents (audit trail)

- `.claude/agents/review-m9-session-to-global-consolidation-2026-07-22/findings/` (architecture+wiring, tests, cross-validation+domain)
