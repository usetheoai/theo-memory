# Review: v1-1-multi-peer-and-bi-temporal

**Date:** 2026-06-03
**Plan:** `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md` v1.2 (`/plan-confidence` 89.6/100 SHIPPABLE_WITH_CAVEATS)
**Branch:** `develop`
**Commits in scope:** `2341426..HEAD` (10 commits: `2e4da30 → 3669cb7`)
**Spawned agents:** 7 (4 baseline + 3 domain-specific)
**Mode:** report consolidated **manually** because `consolidate_findings.py` could not parse 3 of 7 YAMLs (embedded colons in unquoted scalars); raw findings YAMLs preserved at `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/findings/` for audit. Manual aggregation cross-checked against `grep` extraction of every finding id from all 7 files.

## Verdict

**NEEDS_FIXES** (3 v1.1-introduced MAJOR findings recommended before merge; 3 pre-existing-debt MAJOR can defer)

| Severity | Count | v1.1-introduced | Pre-existing debt |
|---|---|---|---|
| BLOCKER | 0 | 0 | 0 |
| CRITICAL | 0 | 0 | 0 |
| MAJOR | **8** | **5** | **3** |
| MINOR | 14 | 7 | 7 |
| INFO | 22 | — | — |

**Decision: not READY_TO_MERGE.** Two MAJOR findings (F-dom-dbmig-1 partial-index missing from `schema.ts`; F-xval-1/F-tests-1/F-wire-1 EC-9 skill+asOf unwired) are v1.1-introduced and ship contract gaps the plan EXPLICITLY required closed (AC items per task, EC absorption per Global DoD criterion 4). Three paper-name violations (F-arch-11/12/13) ship rule violations introduced by v1.1 commits — mechanical fixes (~3 single-line edits). The three remaining MAJOR (F-arch-2 ad-hoc structural type; F-arch-6 pgvector-store.ts LoC budget; F-arch-7 index.ts LoC budget) are pre-existing — surfaced honestly here but defer to a follow-up cycle.

## Quality gates summary (per `/implement-validate` 2026-06-03 retro-fit)

| Gate | Result | Notes |
|---|---|---|
| Unit + integration tests | ✅ PASS | 846/851 passed (5 skipped) |
| TypeScript typecheck | ✅ PASS | Zero errors |
| Lint | ✅ PASS | Zero warnings post-`373e540` |
| THE GOAL TEST | ✅ PASS | 7/7 against real `ankane/pgvector:v0.5.1` |
| Coverage | ⚠️ NOT RE-RUN | v0.4b/v0.6/v0.7 baseline ≥ 90%; v1.1 additive only |

Pre-existing pending failure (NOT v1.1-introduced, NOT blocking): `src/local/__tests__/reflection/threshold-policy.test.ts` failing at `beforeAll` with `TypeError: this.pool.query is not a function` — last touched 2026-05-29 commit `5b06370` (v0.4a), 5 days before v1.1 plan started. Logged for separate triage per implement-validate report.

## Findings — MAJOR

### v1.1-introduced (5) — fix recommended before merge

#### F-dom-dbmig-1 — Partial index not declared in `schema.ts`

- **Found by:** domain-db-migrations + domain-pgvector-schema (F-dom-pg-1 is the duplicate)
- **File:** `src/local/schema.ts:120-159` (memories table block); column added at line 87
- **Plan ref:** T1.1 § Acceptance Criteria #2 + #3; `architecture.md § 10.2`
- **Evidence:** Migration `0008_attributed_to.sql:3-6` defines:
  ```sql
  CREATE INDEX IF NOT EXISTS "idx_memories_user_attributed_to"
    ON "memories" ("user_id", "attributed_to")
    WHERE "attributed_to" IS NOT NULL;
  ```
  but `schema.ts` declares only the column, not the index. `architecture.md § 10.2` documents the drizzle-kit-push vs runMigrations flow: dev-time `db:push` introspects the live DB from `schema.ts`. Without the index declaration, push-flow developers silently miss the partial index — only `runMigrations()` (journal path) lands it correctly.
- **Recommended action:** Add the partial-index declaration to the `memoriesTable` builder block in `schema.ts`. Regenerate the Drizzle snapshot; verify journal sync; existing migration SQL stays unchanged (idempotency).

#### F-xval-1 + F-tests-1 + F-wire-1 — EC-9 (skill rows + asOf) NOT WIRED at public API

- **Found by:** cross-validation, tests, wiring (3 agents converged on the same gap)
- **Files:**
  - `src/core/skill.ts:102-114` — `SkillRecallOptions` defines `topK | threshold | includeSuperseded`, NO `asOf`
  - `src/local/scoped-skill-memory.ts:124-128` — `recall()` does not route `asOf` into Filters
  - `tests/integration/v1-1-multi-peer-bitemporal.test.ts` — no skill-scope asOf scenario exists
- **Plan ref:** T3.1 § Tasks step 10 (RED test mandatory); T3.1 § TDD (named test); Global DoD criterion 4 (EC-9 in 5 SHOULD TEST list)
- **Evidence:** Plan v1.2 § T3.1 step 10 verbatim: *"EC-9: Write RED integration test: skill row recall with `asOf` honors bi-temporal predicate."* T3.1 lists EC-9 in its AC. THE GOAL TEST exercises asOf via `memory.user(...).recall(...)` (memory scope) but NEVER `memory.skills(repoId).recall(..., {asOf})`. `SkillRecallOptions` is missing the `asOf` field entirely — so the public-API surface CANNOT accept asOf on the skill path even if a caller wanted to.
- **Recommended action options:**
  - **Option A (close the gap):** Add `asOf?: Date` to `SkillRecallOptions`; route through `applySkillFilters` (already widened — calling it from skill path needs verification); add RED integration test covering "soft-deleted skill recoverable via historical asOf". ~30-50 LoC across 3 files + 1 test.
  - **Option B (honest deferral):** Amend ADR D4 with explicit "EC-9 deferred — skill-scope asOf not supported in v1.1; CHANGELOG declares the boundary". No code change but updates plan v1.2 → v1.3 acknowledging the deferral. Requires re-running `/plan-confidence` for paper trail.

#### F-arch-11 — Paper-name in test descriptor

- **Found by:** architecture
- **File:** `tests/integration/v1-1-multi-peer-bitemporal.test.ts:156` (commit `42e2ace`)
- **Plan ref:** project rule `.claude/rules/no-paper-names-in-code.md` — applies to `tests/**` test names
- **Evidence:** test descriptor includes the literal `(Graphiti null-safe predicate)`. "Graphiti" is a paper/marketing name forbidden in test descriptors.
- **Recommended action:** Rename to drop the paper-name (e.g., `(null-safe temporal predicate)`). Single-line `Edit`.

#### F-arch-12 — Paper-name in inline test comment

- **Found by:** architecture
- **File:** `src/local/__tests__/pgvector-store.test.ts:359` (commit `8876fb3` / T3.1)
- **Evidence:** Comment includes "Graphiti precedent" introduced when wiring temporal-predicate tests.
- **Recommended action:** Replace with neutral wording (e.g., `// null-safe temporal predicate`) or remove entirely.

#### F-arch-13 — Paper-name in inline test comment

- **Found by:** architecture
- **File:** `src/core/__tests__/extraction-prompt.test.ts:175` (commit `7f4eb05` / T1.2)
- **Evidence:** Comment references "bivalent Mem0 vocabulary".
- **Recommended action:** Rewrite as `// pre-v1.1 vocabulary was constrained to two attribution roles; v1.1 widens to arbitrary peer ids`.

### Pre-existing debt (3) — recommended defer to follow-up cycle

#### F-arch-2 — `applySkillFilters()` ad-hoc inline structural type

- **File:** `src/local/index.ts:170`
- **Status:** pre-existing; v1.1 widened the parameter to absorb `attributedTo` + `asOf` but the underlying ad-hoc-type problem predates v1.1.
- **Recommendation:** Extract a named `SkillFilterOptions` interface in `src/core/scope.ts` in a separate refactor cycle. Defer.

#### F-arch-6 — `src/local/pgvector-store.ts` 788 LoC (over 500 budget)

- **Status:** pre-existing trajectory. v1.1 added +86 LoC (T2.1 hoist + T2.2 attribution filter + T3.1 composeTemporalWhere — all in-scope per plan).
- **Recommendation:** Refactor cycle to extract `pgvector-temporal-composer.ts` (v0.6 split precedent). Defer.

#### F-arch-7 — `src/local/index.ts` 1097 LoC (2.2× over 500 budget)

- **Status:** pre-existing. v1.1 added +18 LoC.
- **Recommendation:** Same as F-arch-6. Defer to a dedicated refactor plan.

## Findings — MINOR (14)

Non-blocking; merge can proceed after MAJOR fixes.

- **F-xval-2** — Stale-refs audit undercounted (EC-4 close-out report claimed 4 hits; 19 actual). Action: regenerate the audit with full count.
- **F-tests-2/3/4** — Minor naming nits; AAA structure inconsistent in 1 scenario; ConstantEmbedder choice not documented in test file header.
- **F-dom-dbmig-2/3/4** — Migration file lacks `-- statement-breakpoint` separator (cosmetic); journal timestamp ordering verified OK; no rollback script (consistent with project precedent).
- **F-dom-mem-1/2** — Knowledge-base citations OK but "Graphiti precedent" appears in JSDoc at `pgvector-store.ts:99,359`, `options.ts:51`, `scope.ts:122`. Source comments (not test code) but still on the paper-name boundary. Recommend re-wording in the same fix-up commit as F-arch-11/12/13.
- **F-dom-pg-4/5/6/8** — Date binding without explicit `::timestamptz` cast (gap with file's `$N::vector` discipline); composeFilters parameter-index threading verified clean; HNSW index intact.

## Findings — INFO (22)

Architectural verification of SOLID compliance (`composeTemporalWhere` SRP-clean; `insertBatch` hoist OCP-clean), DIP boundaries (`src/core/` does NOT import from `src/local/` — verified by `grep`), naming conventions, ADR alignment with ADR-0011, etc. Full inventory in raw findings YAMLs.

## Cross-validation summary

| Plan task | Fully implemented | Partial | Missing | Diverged (honest) |
|---|---|---|---|---|
| T0.1 (ADR-0011 + ADR-0006 amendment + EC-4 audit) | ✅ | — | — | divergence-3 stale-refs grep 4 intentional hits (undercount per F-xval-2) |
| T1.1 (migration + schema + DTO + RememberOptions) | ✅ | partial-index in `schema.ts` (F-dom-dbmig-1) | — | divergence-1 hand-authored 0008; divergence-2 absorbed AC from T2.1 |
| T1.2 (LLM prompt N-valent) | ✅ | — | — | — |
| T2.1 (hoist + projection + pipeline wiring) | ✅ | — | EC-10 concurrent-remember test (F-dom-pg-2) | — |
| T2.2 (recall filter + WHERE) | ✅ | — | — | — |
| T3.1 + T3.2 (BiTemporal lift + asOf SQL composer) | ✅ | EC-9 skill+asOf (F-xval-1/F-tests-1/F-wire-1) | — | — |
| T4.1 (THE GOAL TEST 7/7 + CHANGELOG) | ✅ | — | — | divergence-4 ConstantEmbedder; divergence-6 defensive ADD COLUMN; divergence-5 raw ralph-loop + retro-fit |

7 honest divergences (all documented; none silent).

## Edge-case coverage (from `edge_case_coverage.py`)

Raw ratio 0.067 (3 covered / 45 total). **This metric is largely spurious for this plan shape:** the script extracts every `[ ]` bullet from `### Acceptance Criteria` sections — most are prose claims ("ADR-0006 carries SUPERSEDED IN PART annotation") not testable edge cases. The actual EC-1..EC-13 absorption is tracked by implement-validate criterion 4 (all 13 ECs marked absorbed). Recommendation: do not auto-block on this number; cross-check against criterion 4.

## Wiring triad summary (per `check_wiring.py` re-validation)

| Symbol | (a) static caller | (b) integration test | (c) runtime metric |
|---|---|---|---|
| `MemoryItem.attributedTo` | ✅ pgvector-store.rowToResult + retrieval/pipeline | ✅ Scenario 1 GOAL TEST | n/a per plan |
| `RememberOptions.attributedTo` | ✅ extraction/pipeline runInferFalsePath | ✅ Scenario 1 GOAL TEST | n/a |
| `RecallOptions.attributedTo` | ✅ local/index.ts ScopedMemory.recall → applySkillFilters | ✅ Scenario 1 | n/a |
| `RecallOptions.asOf` (lifted) | ✅ local/index.ts → applySkillFilters → composeTemporalWhere | ✅ Scenario 2 | n/a |
| `composeTemporalWhere()` | ✅ pgvector-store.search + keyword path | ✅ Scenario 2.1+2.3+3.1 | n/a |
| Migration 0008 | ✅ runMigrations idempotent | ✅ Scenario 4 | n/a |
| **`SkillRecallOptions.asOf`** | ❌ **field does not exist** | ❌ **no integration test** | n/a |
| **`memory.skills(repoId).recall({asOf})`** | ❌ not in API surface | ❌ not exercised | n/a |

Wiring pillar (c) n/a globally per plan Global DoD ("no new runtime counters introduced; existing `pgvector_recall_duration_ms` continues to fire and is observable via existing integration tests"). The skill+asOf wiring gap is the primary v1.1-introduced contract miss (F-xval-1/F-tests-1/F-wire-1).

## Spawned agents (audit trail)

- `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/architecture.md` (17 findings)
- `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/tests.md` (4 findings)
- `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/wiring.md` (2 findings)
- `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/cross-validation.md` (2 named findings + 6 honest divergences)
- `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/domain-memory-layer.md` (10 findings)
- `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/domain-db-migrations.md` (5 findings)
- `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/domain-pgvector-schema.md` (8 findings)

Raw findings at `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/findings/*.yaml` — 3 files (`cross-validation.yaml`, `domain-db-migrations.yaml`, `tests.yaml`) have YAML parse errors (embedded colons in unquoted scalars); `consolidate_findings.py` silently dropped them; manual aggregation cross-checked via `grep` extraction of every `id:` / `severity:` field.

## Honest disclosures (Inquebrável Rule 3)

1. **3 of 7 findings YAMLs failed `yaml.safe_load()`** at the consolidator. Raw content is intact; aggregation done by hand + `grep` extraction. Future `/review` cycles should fix the YAML emit format in spawned agents (block-scalar `|` for multi-line evidence with `:` characters, OR explicit quoting).
2. **4 of 7 agents hit API rate-limit on first dispatch** and required retry. Retries succeeded; no findings lost.
3. **`edge_case_coverage.py` reported 0.067** — the metric extracts every plan bullet as a "case"; for v1.1 the actual EC absorption is tracked by implement-validate criterion 4. Do not interpret the ratio as a coverage gap.
4. **`/implement` was driven via raw ralph-loop**, not the canonical `/implement` skill — implement-validate report retro-fit during `/review` Step 1 (commit context preserves the audit trail).
5. **5 pre-existing skipped tests + 1 pre-existing failing `beforeAll`** in the contract suite remain — not v1.1 regressions, logged for separate triage.

## Handoff decision

**Verdict: NEEDS_FIXES**

Recommended fix-up before merge to `develop` HEAD:

1. **F-arch-11/12/13** — 3 mechanical paper-name edits (~5 minutes; no test changes needed)
2. **F-dom-dbmig-1** — add partial-index declaration to `schema.ts`; regenerate Drizzle snapshot
3. **F-xval-1/F-tests-1/F-wire-1** — pick **Option A** (close the EC-9 gap: widen `SkillRecallOptions`, route through skill recall path, add integration RED test) OR **Option B** (honest ADR D4 deferral amendment + plan v1.3 bump + `/plan-confidence` re-score)

Defer to follow-up refactor cycle:

- **F-arch-2** — `applySkillFilters` ad-hoc type
- **F-arch-6** — `pgvector-store.ts` LoC budget
- **F-arch-7** — `src/local/index.ts` LoC budget

Surface 14 MINOR findings honestly in the merge PR description; merge can proceed after MAJOR resolution.

NOT auto-merging per cycle-review § Anti-pattern #6 (final merge is human decision).
