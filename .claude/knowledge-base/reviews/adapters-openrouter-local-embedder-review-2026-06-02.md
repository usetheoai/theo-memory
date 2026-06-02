# Review: adapters-openrouter-local-embedder

**Date:** 2026-06-02
**Reviewers (spawned agents — all parallel, all 7 completed):**
- architecture
- tests
- wiring
- cross-validation
- domain-pgvector-schema
- domain-memory-layer
- domain-db-migrations

**Findings:** 60 total raw → 32 consolidated after dedup
- BLOCKER: 0
- CRITICAL: 1 (consolidated from 2 reports — same root cause)
- MAJOR: 15 (after dedup; raw 23)
- MINOR: 12 (after dedup; raw 22)
- INFO: 4 (after dedup; raw 16)

**Verdict:** **NEEDS_FIXES**

Per cycle-review.md § Hard gates: CRITICAL findings require HALT before merge UNLESS explicitly dismissed with ADR-style rationale. F-C1 (DELETE cascade collateral wipe) is NOT yet dismissed; merge cannot proceed without either (a) explicit ADR-style dismissal documenting that operator has accepted the broader data-loss envelope OR (b) fix shipping the JSDoc/CHANGELOG/README/log honesty alignment + plan ADR D3 amendment.

The cycle's empirical end-to-end Goal-metric test passes (T4.1 5/5 live) and SDK foundations are sound — but the destructive operation's surface area is not honestly disclosed at the boundary the operator sees.

---

## CRITICAL findings (MUST resolve before merge)

### F-C1 — `applyDimChange` DELETE cascades broader data loss than documented

- **Severity:** CRITICAL
- **Found by:** domain-pgvector-schema (F-dom-pgvector-1) + domain-db-migrations (F-dom-db-2) — same root cause from 2 angles
- **File:** `src/local/index.ts:886-887` (the `DELETE FROM memories; DELETE FROM entities;` lines added in T4.1 follow-up)
- **Plan reference:** ADR D3 (plan §117-122) + ADR EC-B accepted risk
- **Cascade graph (empirically verified against migrations/0000_crazy_mimic.sql):**
  - `history.memory_id ON DELETE CASCADE` → **entire `history` audit trail wiped** (not just embeddings)
  - `consolidation_history.kept_memory_id ON DELETE SET NULL` → **v0.7 distillation provenance pointers nullified**
  - `memories.superseded_by` self-FK ON DELETE SET NULL → **v0.6 Voyager supersession chains broken**
- **What documentation says vs. what runs:**
  - ADR D3 plan text: `ALTER COLUMN ... USING NULL` (only embedding column data lost)
  - ADR EC-B disclosure: "All existing memories are lost on dim switch"
  - CHANGELOG entry: "truncates existing embeddings"
  - Runtime stderr log: "truncates existing embeddings + drops/recreates HNSW indexes"
  - Inline JSDoc at index.ts:877-885: explains the substitution but does NOT enumerate the cascade collateral
  - README "Destructive dim change caveat": "existing memories vanish" (no mention of history audit / distillation provenance / Voyager chains)
- **Recommended action — choose one:**
  - **(a) FIX** — update JSDoc + CHANGELOG + README + warning log to enumerate the full cascade graph; bump plan to v1.2 with ADR D3 amended to document the DELETE-cascade reality; OR
  - **(b) DISMISS** — explicit ADR-style entry in the plan v1.2 that the operator accepts the broader data-loss envelope as part of the destructive-dim-change contract (matching ADR EC-B but widened in scope). Either path closes F-C1 honestly per Inquebrável Rule 3.
- **Cycle-implement Stop Condition #4 angle:** the implementation diverged from the plan's locked ADR D3 (`USING NULL` → `DELETE FROM`); per anti-pattern #3, the divergence should have halted and looped back to cycle-plan. Documenting this divergence belongs in the v1.2 ADR amendment.

---

## MAJOR findings (15 — after dedup)

### F-M1 — Missing EC-3 atomic rollback regression test
- **Found by:** tests (F-tests-1) + domain-pgvector-schema (F-dom-pgvector-2) + domain-db-migrations (F-dom-db-1) + cross-validation (F-xval-3) — 4 reviewers
- **File:** `tests/integration/migrations/dim-change.test.ts` (5 tests but none verifies ROLLBACK branch)
- **Plan reference:** plan T0.3 § TDD explicitly enumerates `test_runMigrations_atomic_rollback_on_mid_sequence_failure`; docstring lines 14-15 of the test file promises the coverage
- **Why load-bearing:** the entire BEGIN/COMMIT/ROLLBACK wrapper exists for EC-3 atomic invariant; structural code review is the only signal today
- **Recommended action:** add test that injects a mid-sequence SQL failure (e.g., via a synthetic ALTER constraint violation) and asserts schema preserved at pre-change state + HNSW indexes intact

### F-M2 — Plan ADR D3 stale on `USING NULL` vs shipped `DELETE FROM`
- **Found by:** architecture (F-arch-2) + domain-pgvector-schema (F-dom-pgvector-3) + domain-db-migrations (F-dom-db-2 — also CRITICAL angle) + cross-validation (F-xval-1) + domain-memory-layer (F-dom-3) — 5 reviewers
- **File:** `.claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md` § ADR D3 (lines 117-122) vs `src/local/index.ts:886` shipped code
- **Cycle-implement anti-pattern #3 violation:** "NEVER edit the implementation plan during /implement-execute — if the plan is wrong, halt and loop back". The T4.1 follow-up should have triggered a halt + plan v1.2 + re-invoke; instead, the divergence is captured only in commit messages
- **Recommended action:** bump plan to v1.2 with an explicit "ADR D3 amendment: DELETE-before-ALTER replaces USING NULL because pgvector's vector(N) NOT NULL constraint collides with USING NULL coercion" + update CHANGELOG correspondingly. Resolves F-C1 (b) path too

### F-M3 — `src/local/schema.ts` hardcoded `MAX_EMBEDDING_DIM=1536` drifts from live DB after dim change
- **Found by:** domain-db-migrations (F-dom-db-4)
- **File:** `src/local/schema.ts:50,174` — Drizzle schema declares `vector(1536)` literally
- **Failure mode:** after `runMigrations({ embeddingDim: 384 })`, live DB has `vector(384)` but schema.ts says `vector(1536)`. Next `drizzle-kit push` computes destructive diff and silently reverts the ALTER — not covered by orphan-schema mitigation per architecture.md § 10.2
- **Recommended action:** either parametrize schema.ts at build time, OR document the constraint loudly in the demo's db:push wrapper, OR add a runtime check that fails-loud on schema drift

### F-M4 — Asymmetric backward-compat guard blocks legitimate 384→1536 revert
- **Found by:** domain-db-migrations (F-dom-db-5) + domain-memory-layer (F-dom-1) — 2 reviewers
- **File:** `src/local/index.ts:950,966` — guard `options.embeddingDim !== MAX_EMBEDDING_DIM` short-circuits when user passes `embeddingDim: 1536` explicitly
- **Failure mode:** operator switches local-openrouter (384) → openai (1536); next demo boot calls `runMigrations({ embeddingDim: 1536 })` which is filtered out by the guard. Schema stays at 384; next OpenAIEmbedder insert hits opaque pgvector cast error
- **Recommended action:** remove the guard; the inner `atttypmod` probe in `applyDimChange` already handles idempotency cleanly. Or invert: always call applyDimChange when options.embeddingDim explicitly set, let the probe short-circuit

### F-M5 — `_pipelinePromise` permanently caches REJECTED promise
- **Found by:** wiring (F-wire-1) + domain-memory-layer (F-dom-5) — 2 reviewers
- **File:** `src/embedders/local.ts:55-65` — lazy singleton stores Promise; if first call rejects (transient HF CDN failure), every subsequent `embed()` returns the same rejected promise. No retry until process restart
- **JSDoc claim incorrect:** says OpenAI precedent, but `OpenAIEmbedder` is sync (constructor can't reject) — qualitatively different
- **Recommended action:** wrap promise creation in try/catch; on rejection, reset `_pipelinePromise = null` so next call retries

### F-M6 — Destructive DELETE path never exercised by integration test
- **Found by:** wiring (F-wire-2)
- **File:** all 5 `dim-change.test.ts` cases run against fresh DB (no rows to DELETE)
- **Failure mode:** user-facing data-loss contract documented but unverified. A regression that broke DELETE silently (e.g., missing FK cascade behavior change) would not be caught
- **Recommended action:** add `dim-change.test.ts` case that seeds N rows → runs `runMigrations({ embeddingDim: 384 })` → asserts `(a) row count is 0 post-ALTER, (b) history table empty per cascade, (c) consolidation_history.kept_memory_id NULLed per SET NULL`

### F-M7 — T4.1 hotfix to apply dim change on push-flow DBs was empirically discovered, not RED-tested
- **Found by:** wiring (F-wire-3)
- **File:** `src/local/index.ts:944-953` (orphan-schema branch extension)
- **Inquebrável Rule 5 violation (TDD-first):** the push-flow fix was driven by manual smoke-test feedback at T4.1 live verification, not by a failing RED test
- **Recommended action:** add `dim-change.test.ts` case that simulates push-flow state (CREATE schema manually + no journal) → runs `runMigrations({ embeddingDim: 384 })` → asserts dim change DID apply

### F-M8 — Distill test asserts 200 + invocationId only; no `consolidation_history` SELECT
- **Found by:** tests (F-tests-2)
- **File:** `tests/integration/examples/chat-with-memory-local-openrouter.test.ts:122-161`
- **Plan reference:** T4.1 explicit AC line 918 — "a non-zero `consolidation_history` row count returned by the new endpoint"
- **Recommended action:** after the POST, SELECT count(*) from consolidation_history filtered by policy_name='last-write-wins' + user_id; assert ≥ 1

### F-M9 — No `/api/chat` end-to-end test
- **Found by:** tests (F-tests-3)
- **Plan reference:** plan T4.1 TDD #3 `test_api_chat_seeds_memory_with_384_dim_embedding`
- **Current coverage:** schema `atttypmod` check is a structural proxy (does the column have the right dim) but does not exercise the chat → embed → INSERT path
- **Recommended action:** add a `/api/chat` POST with a sample message; assert post-response that a new row in `memories` exists with `embedding` length 384 + scope `user_id` matching

### F-M10 — Stale block comment in dim-change.test.ts claims `atttypmod = N + 4`
- **Found by:** architecture (F-arch-3) + domain-db-migrations (F-dom-db-3) — 2 reviewers
- **File:** `tests/integration/migrations/dim-change.test.ts:18-19` (block comment) contradicts the body comment at lines 30-34 + the actual code (identity decoder)
- **Recommended action:** delete the stale block comment OR update to match the empirical correction documented at the implementation

### F-M11 — PgvectorStore positional `tracer` → options-object IS BREAKING for external callers
- **Found by:** architecture (F-arch-1)
- **File:** `src/local/pgvector-store.ts:146-149` — 2nd arg signature changed from `(pool, tracer?: Tracer)` to `(pool, options?: { embeddingDim?, tracer? })`
- **Backward-compat claim partial:** `new PgvectorStore(pool)` still works, but `new PgvectorStore(pool, tracer)` would silently ignore the tracer
- **CHANGELOG missing `**BREAKING:**` prefix** — Inquebrável Rule 6 violation
- **Mitigating fact:** SEPA pre-RED iter-2 grep verified ZERO positional-tracer callers across SDK + tests + examples + node_modules; semantic break exists only for hypothetical external consumers
- **Recommended action:** prefix the CHANGELOG entry with `**BREAKING (theoretical):** PgvectorStore 2nd arg widened from positional Tracer to options object; sweep confirmed zero in-tree callers, but any external consumer passing positional tracer would have it silently ignored — see migration note below.`

### F-M12 — 3 SHOULD TEST EC items unverified
- **Found by:** tests (F-tests-4, F-tests-5, F-tests-6)
- **EC-5 (empty string embed):** `src/embedders/__tests__/local.test.ts` has 7 tests; none probes `embed('')`
- **EC-7 (warmup network failure):** no test mocks the HF CDN to fail; CI on cold cache without internet would timeout instead of failing loud
- **EC-10 (`THEOMEM_DEMO_BACKEND=local-openrouter` without `OPENAI_BASE_URL` → console.warn):** silent-misroute regression unprotected
- **Recommended action:** these were declared SHOULD TEST in the edge-case review (not MUST FIX). User can defer to a follow-up or absorb opportunistically. Honestly surface in PR description as "deferred to follow-up F-T4-followup-1/2/3" if not addressed in this PR

### F-M13 — Orphan-schema warning log still says "skipping runMigrations()" but T4.1 fix made dim-change RUN
- **Found by:** domain-db-migrations (F-dom-db-7)
- **File:** `src/local/index.ts:939-942` console.warn text + architecture.md § 10.2 not updated
- **Recommended action:** update the warning to "schema present but journal missing. Skipping migrate(); applying explicit dim change only" OR equivalent honest wording

### F-M14 — `src/local/index.ts` file size budget breach (pre-existing acknowledged)
- **Found by:** cross-validation (F-xval-2)
- **File:** `src/local/index.ts` = 969 lines (+153 this cycle; was 816 pre-T0.1)
- **Per-file budget:** ≤ 500 lines per `architecture.md § Module hygiene`
- **Pre-existing context:** acknowledged at commit `e36faea` (T0.1 commit body) and recurring acknowledgment in subsequent commits. T4.1 follow-up added another ~80 LoC pushing total higher
- **Recommended action:** opportunistic refactor in a separate cycle (split `applyDimChange` + `runMigrations` into `src/local/migration-runner.ts` would land ~150 LoC under 500 budget). Not blocking this cycle's merge; document in followups

### F-M15 — `src/local/pgvector-store.ts` `insert*` / `update` methods lack dim guard symmetry
- **Found by:** domain-memory-layer (F-dom-2)
- **File:** `src/local/pgvector-store.ts` — `insert` / `insertBatch` / `insertDerivedMemory` / `update` do not assert query.length matches `this.embeddingDim` (only `search` does, line 236-area)
- **Failure mode:** caller passes wrong-dim vector → pg cast error (not the SDK's diagnostic message)
- **Recommended action:** add the same dim guard to write-path methods

---

## MINOR findings (12 after dedup)

- **F-Mi1** (arch F-arch-4): LocalTransformerEmbedder 0-arity constructor has no JSDoc explaining intentional minimalism
- **F-Mi2** (arch F-arch-5): embedBatch returns number[][] cast to readonly — DIP deep-readonly intent not enforced
- **F-Mi3** (arch F-arch-6): resolveBackendMode exported for unit-test access; module-boundary fuzzy (cosmetic)
- **F-Mi4** (arch F-arch-7): `validateEmbeddingDim` throws `InvalidScope` for dim error; conflates Scope errors with dim errors (plan said "defer naming")
- **F-Mi5** (dom-pgvector F-dom-pgvector-4): orphan-schema branch silently applies dim change with no schema.ts vs live drift warning
- **F-Mi6** (dom-pgvector F-dom-pgvector-5): PgvectorStore.search guard throws bare `Error` instead of typed `EmbeddingMismatch` (asymmetry with createLocalMemory probe)
- **F-Mi7** (dom-pgvector F-dom-pgvector-6): plan T0.3 §389 listed `src/local/__tests__/migrations.test.ts` unit target; file doesn't exist
- **F-Mi8** (dom-pgvector F-dom-pgvector-7): atttypmod probe assumes pgvector v0.5.1 encoding; no defensive `extversion` check
- **F-Mi9** (dom-db F-dom-db-6): runtime CREATE INDEX uses unquoted identifiers vs migration's quoted (functionally equivalent; latent risk)
- **F-Mi10** (dom-memory F-dom-4): `src/embedders/index.ts` barrel re-exports LocalTransformerEmbedder, defeating ADR D7's "subpath-only" intent (pre-existing for OpenAI; reaffirmed)
- **F-Mi11** (tests F-tests-7,8): "and" in test names (testing.md anti-pattern) at 2 test sites
- **F-Mi12** (tests F-tests-9): non-unique TEST_USER string in integration test

---

## INFO findings (4 after dedup)

- **F-I1** Wiring triad pillar (a)/(b)/(c) audit honest pass (7/7, 6/7, 1/1 declared); no dead branches
- **F-I2** DIP boundary clean; no cross-tier violations
- **F-I3** Mem0-shape domain anchors all preserved (8-phase write, 9-step search, ADD-only, 3-tier scope, embedder DIP, soft-delete)
- **F-I4** SEPA empirical correction (atttypmod = N, not N+4) honestly captured in code + sepa-iterations log

---

## Edge-case coverage report

**MUST FIX EC absorption (from plan v1.1 inline):**
| EC | Absorbed in | Test coverage | Status |
|---|---|---|---|
| EC-1 | T0.1 | 9 tests in `factory.test.ts` (NaN/float/Infinity/0/>MAX guards) | ✓ COVERED |
| EC-3 | T0.3 | **Structural code only — NO ROLLBACK test** | ⚠️ PARTIAL (F-M1) |
| EC-4 | T0.3 | `dim-change.test.ts` HNSW recreation test | ✓ COVERED |
| EC-11 | T2.1 | 5 unknown-value variants in `chat-with-memory-memory.test.ts` | ✓ COVERED |
| EC-13 | T2.1 | Path itself = self-proof (tests/unit/examples/) | ✓ COVERED |

**SHOULD TEST EC absorption:**
| EC | Coverage status |
|---|---|
| EC-2 | Per-task test (constructor-dim vs schema-dim) — DEFERRED in plan, not added |
| EC-5 | empty string embed — F-M12 (gap) |
| EC-7 | warmup network failure — F-M12 (gap) |
| EC-10 | missing OPENAI_BASE_URL warn — F-M12 (gap) |

**DOCUMENT EC absorption:** EC-6 (truncation), EC-8 (disk req), EC-12 (CI cache warmup) — all documented in README/JSDoc ✓

---

## Cross-validation summary

- Plan tasks: 9
- Fully implemented + committed: 9 (T0.1 + T0.2 + T0.3 + T1.1 + T1.2 + T2.1 + T2.2 + T3.1 + T4.1)
- Partially implemented (missing tests promised): 1 (T0.3 — EC-3 rollback test absent — F-M1)
- Missing: 0
- Diverged with documented rationale: 1 (T0.3 ADR D3 `USING NULL` → `DELETE FROM` — F-M2)
- Diverged with undocumented rationale: 0
- Plan defects logged-not-violated: 2 (F-xval-5 T0.2 § Files to edit #3 wrong; F-xval-6 ADR D7 framing)

---

## Quality gates summary

| Gate | Status | Notes |
|---|---|---|
| `npm test` (full contract) | PASS | 662/664 (2 skipped env-conditional pre-existing) |
| `npm run typecheck` | PASS | 0 errors |
| `npm run lint` | PASS | 0 warnings |
| Migration integration tests | PASS | 12/12 |
| T4.1 live integration tests | PASS | 5/5 (against live demo with `THEOMEM_DEMO_BACKEND=local-openrouter`) |
| Coverage on critical paths | n/a | not gated by /review per token-budget cost discipline; T0.1 probe + T0.3 ALTER + T1.1 embed all exercised |
| Wiring triad — pillar (a) | 7/7 PASS | honest sweep verified |
| Wiring triad — pillar (b) | 6/7 PASS | 1 defer (T2.1 → T4.1) honest |
| Wiring triad — pillar (c) | 1/1 PASS | T2.2 /api/info shape asserted |

---

## Spawned agents (audit trail)

```
.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02/
├── architecture.md
├── tests.md
├── wiring.md
├── cross-validation.md
├── domain-pgvector-schema.md
├── domain-memory-layer.md
├── domain-db-migrations.md
└── findings/
    ├── architecture.yaml         (329 lines)
    ├── tests.yaml                (402 lines)
    ├── wiring.yaml               (361 lines)
    ├── cross-validation.yaml     (549 lines)
    ├── domain-pgvector-schema.yaml (531 lines)
    ├── domain-memory-layer.yaml  (295 lines)
    └── domain-db-migrations.yaml (359 lines)
```

Paired knowledge skills auto-registered at `.claude/skills/review-adapters-openrouter-local-embedder-{role}-knowledge/SKILL.md` (7 skills).

---

## Handoff decision

**Verdict: NEEDS_FIXES**

**Hard gate (per cycle-review.md § Hard gates):** F-C1 CRITICAL must be resolved by either explicit ADR-style dismissal IN A PLAN V1.2 DOC documenting the broader data-loss envelope OR by FIX shipping the cascade honesty alignment (JSDoc + CHANGELOG + README + log + plan ADR D3 amendment).

**Soft gates (MAJOR findings — surface to human):**
- F-M1 (EC-3 rollback test) — recommended fix before merge; load-bearing invariant unverified
- F-M2 (ADR D3 stale) — resolved by same plan v1.2 amendment that closes F-C1
- F-M3 (schema.ts drift) — recommended fix before merge OR document constraint loudly
- F-M4 (asymmetric guard) — recommended fix before merge; small change
- F-M5 (rejected promise cache) — recommended fix before merge; small change
- F-M6 + F-M7 + F-M8 + F-M9 — test gaps; recommended addition before merge OR explicit defer-to-followup
- F-M10 (stale `N+4` comment) — recommended cleanup before merge; one-line fix
- F-M11 (BREAKING CHANGELOG) — recommended CHANGELOG amendment before merge
- F-M12 (3 SHOULD TEST EC gaps) — acceptable WITH_CAVEATS; declared SHOULD TEST in EC review, not MUST FIX
- F-M13 (misleading warning) — recommended fix before merge; small change
- F-M14 (file size budget) — pre-existing, acknowledged; opportunistic refactor in separate cycle
- F-M15 (insert/update dim guard symmetry) — recommended fix before merge; small symmetric addition

**Next step recommendation:** loop back to `/implement` for a fix-up sub-cycle addressing F-C1 + F-M1 through F-M15. The Goal-metric IS satisfied (T4.1 5/5 live PASS), but the destructive-operation honesty surface needs to align with the documented contract before this can `READY_TO_MERGE`. Estimated scope: ~5-8 commits (plan v1.2 + 4 test files + 4-6 doc/log/code touch-ups).
