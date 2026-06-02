# Review: v0-7-distillation-pipeline (re-run #3, post fix-up cycle #2)

**Date:** 2026-06-02
**Trigger:** `/review v0-7-distillation-pipeline` (third pass)
**Plan:** `.claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md` (v1.2)
**Branch:** `develop` (project convention — work commits directly on `develop`)
**Diff base:** `main`; relevant commits `9d16db4..f68727d` (v0.7 trunk) + earlier `77f3be4..bab7a02` (DIP + impls)
**Last fix-up:** commit `f68727d` "fix(v0-7-distill): /review re-run fix-up #2 — close 2 MAJOR + key MINORs"
**Reviewers (spawned agents):** 7 (4 baseline + 3 domain)

## Verdict

**READY_TO_MERGE_WITH_CAVEATS** — 0 BLOCKER / 0 CRITICAL / 0 MAJOR / **2 actionable MINOR** (paper-name violations, doc-only) + 2 deferred-acceptable MINOR + ~26 INFO.

Two doc-only paper-name rule violations (`no-paper-names-in-code.md`) were introduced by fix-up cycle #1 commits (`17425af`, `ffa92d1`) on 2026-06-02, AFTER the rule was promoted to first-class status (2026-05-30). Strictly per the rule § Pre-existing references opportunistic-cleanup clause, these qualify as MINOR not BLOCKER, but they are *new* additions (not pre-existing rot) and warrant a 2-line cleanup before PR `develop → main`.

If the user accepts the 2 MINORs as deferred per the same opportunistic-cleanup clause, the verdict promotes to **READY_TO_MERGE clean**.

## Aggregate findings

| Agent | Verdict | BLOCKER | CRITICAL | MAJOR | MINOR | INFO |
|---|---|---|---|---|---|---|
| architecture | READY_TO_MERGE | 0 | 0 | 0 | 3 (2 paper-names + 1 type-cast precedent) | 13 |
| tests | READY_TO_MERGE | 0 | 0 | 0 | 0 | (clean) |
| wiring | READY_TO_MERGE | 0 | 0 | 0 | 1 (deferred F-wire-rerun-1) | 1 (deferred F-wire-rerun-2) |
| cross-validation | PASS_CLEAN | 0 | 0 | 0 | 0 | (clean) |
| domain-memory-layer | READY_TO_MERGE_CLEAN | 0 | 0 | 0 | 0 (2 deferred not re-raised) | (clean) |
| domain-pgvector-schema | READY_TO_MERGE | 0 | 0 | 0 | 0 | 5 |
| domain-db-migrations | READY_TO_MERGE_CLEAN | 0 | 0 | 0 | 0 | 7 |
| **TOTAL (dedup)** | **READY_TO_MERGE_WITH_CAVEATS** | **0** | **0** | **0** | **4** | **~26** |

Of the 4 MINOR: **2 actionable** (new paper-name violations in v0.7 fix-up commits) + **2 deferred-acceptable** (consistent precedent / pre-declared deferral per plan v1.2).

## Closures confirmed from fix-up #2 (commit `f68727d`)

All 6 closures from the prior /review re-run (`v0-7-distillation-pipeline-review-2026-06-02-rerun.md`) verified landed:

| ID | Severity | Closure | Verifier agent |
|---|---|---|---|
| **F-xval-rerun-3** | MAJOR | ADR D7 added to plan v1.2 (lines 191-213) with full atomicity rationale + 4-step SQL recovery runbook + 3 rejected alternatives (XA / two-phase commit / compensating undo) + v0.7.2 OTel-counter follow-up tag. Implementation at `src/local/index.ts:384-413` matches documented partial-commit window exactly. | cross-validation |
| **F-xval-rerun-4** | MAJOR | ADR D1 v1.2 amendment block added at plan line 84 with explicit "technically inaccurate" flag + locus correction (`src/local/index.ts:373-417` runtime layer vs originally-declared `src/core/reflection/execute.ts` logic layer) + v0.7.2/v0.8 refactor deferral tag. | cross-validation |
| **F-xval-rerun-5** | MINOR | Plan v1.2 header math line 3 corrected to `11 MAJOR (9 deferred-with-rationale + 2 closed) / 12 MINOR (1 closed)` — inventory verified. | cross-validation |
| **F-Mi12** | MINOR | `package.json:79` declares `db:repair-v0-7-partial-state` npm script; target script `scripts/db-repair-v0-7-partial-state.mjs` exists (5052 bytes) and covers 5 partial-state cases (one beyond the 4 documented). | domain-db-migrations |
| **F-wire-3** | MINOR | `src/local/index.ts:374-379` comment fixed — stale `// line 317` now reads `line 354 ("EC-5: empty-source short-circuit")` matching actual location. | wiring |
| **F-tests-rerun-1/2** | MINOR | `tests/integration/distillation/skill-isolation.test.ts:149` renamed second test (removed misleading "subsequent reflect()"); lines 178-187 replace `void` discards with 2 real `t_invalid` assertions (older rejected + newer kept per LWW). 4 real assertions total. | tests |

Total of fix-up #2: 4 files / 48 insertions / 7 deletions / zero production runtime code changed (plan docs + package.json npm script + 2 doc-only code comments + skill-isolation test refinements).

## Closures confirmed from earlier fix-up #1 (commits `9d16db4` + `ffa92d1` + `17425af`)

The 3 CRITICAL closures from re-run #1 remain verified by every applicable agent in re-run #3:

| ID | Severity | Closure | Verifier agent |
|---|---|---|---|
| **F-C1** | CRITICAL | `LastWriteWinsConflictPolicy.maxRejectionRatio` default 0.95; clamped `[0,1]`; abstain returns `[]`; gated by `consolidationResults.length > 0` check at `src/local/index.ts:403` → ZERO partial state possible. 5 dedicated abstention tests in `last-write-wins.test.ts:61-115`. | architecture, wiring, domain-memory-layer |
| **F-C2** | CRITICAL | `kind = 'extracted'` filter at `pgvector-store.ts:571` correctly excludes `'derived'` and `'skill'`. Verified exhaustive against schema CHECK constraint `memories_kind_derived_from_check` (`schema.ts:147-149`) enforcing kind ∈ {extracted, derived, skill}. Regression test `skill-isolation.test.ts` covers both skill-row and derived-row isolation. | domain-memory-layer, domain-pgvector-schema, wiring |
| **F-C3** | CRITICAL | `consolidationHistory` declared in `src/local/schema.ts:239-254` with 6 columns + ON DELETE SET NULL FK + 2 indexes, matching `meta/0007_snapshot.json` exactly. Drift-protected bidirectionally by `schema-snapshot-parity.test.ts` via `Symbol.for('drizzle:Name')` runtime tag. | domain-pgvector-schema, domain-db-migrations |

## Actionable MINOR (2)

### F-arch-rerun2-6: Paper-name "Mem0" in JSDoc

- **Severity:** MINOR
- **Found by:** architecture
- **File:** `src/core/conflict-resolution/last-write-wins.ts:48`
- **Rule violated:** `.claude/rules/no-paper-names-in-code.md` (promoted to first-class 2026-05-30)
- **Introduced by:** commit `17425af` (F-C1 closure, 2026-06-02 — AFTER rule promotion)
- **Evidence:**
  ```ts
  // The shipped `recallConsolidationCandidates` returns the ENTIRE active
  // scope as one bag — no cosine clustering at ≥ 0.95 (which plan T2.1's
  // Mem0 entity-link precedent declared). Combined with LWW ...
  ```
- **Recommended action:** rephrase to describe the SHAPE not the source. Suggested: "no cosine clustering at ≥ 0.95 (which plan T2.1's entity-link clustering precedent declared)". The citation to plan T2.1 is preserved (filesystem coordinate — allowed by the rule).

### F-arch-rerun2-7: Paper-name "v0.6 Voyager" in inline comment

- **Severity:** MINOR
- **Found by:** architecture
- **File:** `src/local/pgvector-store.ts:559-561`
- **Rule violated:** `.claude/rules/no-paper-names-in-code.md`
- **Introduced by:** commit `ffa92d1` (F-C2 closure, 2026-06-02 — AFTER rule promotion)
- **Evidence:**
  ```ts
  // /review v0-7 F-C2: filter `kind = 'extracted'` to preserve the
  // episodic→semantic boundary. Without this guard, v0.6 Voyager skill
  // rows (kind='skill') AND already-consolidated rows (kind='derived')
  ```
- **Recommended action:** rephrase. Suggested: "v0.6 procedural skill rows (kind='skill') AND already-consolidated rows (kind='derived')". The kind constant is allowed (it is the code identifier, not a paper name).

## Deferred-acceptable MINOR (2, NOT actionable)

| ID | Why deferred |
|---|---|
| **F-arch-rerun2-8** (`as unknown as VectorStoreWithConsolidation` cast in `src/local/index.ts:385`) | Consistent with v0.4a precedent (`VectorStoreWithDerivedInsert`); future refactor opportunity, not v0.7 regression. |
| **F-wire-rerun-1** (F-C1 abstain-path integration test depth + missing OTel counter increment on abstention) | Pre-declared deferred per plan v1.2 lines 365/373/381-382/473/479/486/550; bundled with F-wire-1/F-wire-2 v1.0 benchmark cycle follow-up. |

## Cross-validation summary

- **Plan tasks:** 9 (T0.1 through T4.1) — all have explicit task-ID commits on `develop`
- **Fully implemented:** 9
- **Partially:** 0
- **Missing:** 0
- **Diverged:** 0 silent (1 documented divergence: ADR D1 wiring locus per amendment block; 1 documented dismissal: ADR D2 cosine-clustering at recall in favor of per-policy guard)
- **ADRs:** 7 (D1-D6 + new D7 from fix-up #2) — all respected by implementation

## Quality gates summary

| Gate | Status | Notes |
|---|---|---|
| `npm test` | **PASS** | 685 tests passed + 2 skipped (87 files) in 10.51s; 0 type errors |
| `npm run typecheck` | **PASS** | `tsc --noEmit -p tsconfig.contract.json` — 0 errors |
| `npm run lint` | **PASS** | 0 warnings |
| Coverage on critical paths | not re-measured | last empirical: 685 contract + integration distillation 7/7 + skill-isolation 2/2 |
| Wiring triad (consolidated by wiring agent) | PASS | All v0.7 symbols pass pillar (a) static caller; all relevant pass (b) integration test; (c) runtime metric N/A or deferred per F-wire-rerun-1 |

## Edge-case coverage report (deterministic script)

- **Plan declared edge cases:** 46 (extracted by `edge_case_coverage.py` keyword scan from Acceptance Criteria + Deep Dive bullets — many false positives)
- **Covered (script):** 5
- **Partial:** 0
- **Missing (per script):** 41

**Honest caveat:** the deterministic edge-case-coverage script is keyword-based and has well-known high false-negative rate (cannot recognize that THE GOAL TEST's precision/recall/accuracy assertions implement the "precision ≥ 0.75 + recall ≥ 0.70 + conflict-resolution accuracy ≥ 0.80" bullet because the test file uses different terminology). The actual edge-case coverage is measured by the agent reviews:

- Tests agent: 11/11 declared edge cases tested (EC-1..EC-8 direct refs; EC-9..EC-11 DOCUMENT-only per plan v1.2 absorption)
- Domain-memory-layer agent: invariants verified preserved across all reviewed surfaces

This script limitation was already noted as INFO in the prior /review re-run and remains INFO — not an actionable finding for v0.7. Improvement to the script is a separate concern.

## Spawned agents (audit trail)

- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/architecture.md`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/tests.md`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/wiring.md`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/cross-validation.md`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/domain-memory-layer.md`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/domain-pgvector-schema.md`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/domain-db-migrations.md`

Findings (per-agent YAML):

- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/findings/architecture.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/findings/tests.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/findings/wiring.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/findings/cross-validation.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/findings/domain-memory-layer.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/findings/domain-pgvector-schema.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun2/findings/domain-db-migrations.yml`

## Handoff decision

**Two paths the user may choose:**

### Path A — Tiny doc-only fix-up #3 (~2 minutes, 2 lines)

Rephrase comment/JSDoc at:
- `src/core/conflict-resolution/last-write-wins.ts:48` (drop "Mem0 entity-link precedent" → "entity-link clustering precedent")
- `src/local/pgvector-store.ts:560` (drop "v0.6 Voyager skill rows" → "v0.6 procedural skill rows")

After: verdict promotes to **READY_TO_MERGE clean** (0 actionable across all severities).

### Path B — Merge as READY_TO_MERGE_WITH_CAVEATS

Accept the 2 paper-name MINORs as opportunistic next-edit cleanup per `no-paper-names-in-code.md § Pre-existing references` extended interpretation. Open PR `develop → main` referencing this report. The 2 paper-name fixes ship in the next /implement that touches those files.

**Recommendation:** Path A is preferred because (a) these are genuinely *new* additions (not pre-existing rot), (b) the cleanup is trivial, (c) `READY_TO_MERGE clean` is the honest verdict for the v0.7 trunk before any benchmark or distillation refactor cycle. Path B is acceptable if the user prefers to ship now and clean opportunistically.

Either path is non-blocking for merge — the verdict is NOT BLOCKER/CRITICAL/MAJOR.

## /dogfood gate reminder (separate concern)

Per `.claude/rules/dogfood-golden-rule.md` and the v0.4b roadmap entry, the anchor scenario "Claude Code auto-memory backed by TheMemory" was last audited 2026-05-31 (commit `6f7ff87`) with verdict `EVIDENCE_INSUFFICIENT` (hard caps `anchor_not_running` + `no_anchor_evidence`). This gate is INDEPENDENT of /review verdict and continues to block any `production-ready` claim until anchor scenario `running` ≥ 30 days with evidence logs. The v0.7 distillation work does NOT advance the /dogfood gate; it advances the technical surface area only.

## Reference

- Prior re-run #2 report: `.claude/knowledge-base/reviews/v0-7-distillation-pipeline-review-2026-06-02-rerun.md`
- Original /review report: `.claude/knowledge-base/reviews/v0-7-distillation-pipeline-review-2026-06-02.md`
- Plan v1.2: `.claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md`
- Cycle SoT: `.claude/rules/cycle-review.md`
- Inquebrável rule cited: `.claude/rules/no-paper-names-in-code.md`
