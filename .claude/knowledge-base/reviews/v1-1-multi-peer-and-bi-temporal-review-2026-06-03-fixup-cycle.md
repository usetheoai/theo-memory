# Review re-run (fix-up cycle 2): v1-1-multi-peer-and-bi-temporal

**Date:** 2026-06-03 (03:11 UTC)
**Plan:** `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md` v1.3 (2026-06-03)
**Branch:** `develop`
**HEAD:** `34e6140 docs(adr+review): v1.1 fix-up EC-9 honest deferral + /review audit trail`
**Mode:** **Lightweight verification re-review** per user AskUserQuestion 2026-06-03 (Option 1 of 3) — refresh deterministic gates + verify the 3 closures from prior /review + confirm 3 deferrals + write report. NO agent re-spawn. Cost ~5-10k tokens vs ~150-250k for full re-spawn. Justified by token-budget.md anti-pattern: *"Running cycle-review on a typo-fix PR — wasteful"*; the 3 fix-up commits total ~8 small file changes none of which touch runtime semantics.
**Pre-condition override:** 1 untracked file `.claude/knowledge-base/reviews/v0-8-fixes-cycle-1-implement-validate-2026-06-02.md` from an unrelated v0.8 cycle (predates this work) — explicit override approved by user via AskUserQuestion 2026-06-03.

## Verdict

**READY_TO_MERGE_WITH_CAVEATS**

| Severity | Count | Resolution |
|---|---|---|
| BLOCKER | 0 | — |
| CRITICAL | 0 | — |
| MAJOR | **3 deferred** | Pre-existing debt (F-arch-2, F-arch-6, F-arch-7) deferred to dedicated refactor cycle per prior /review recommendation. EC-9 (skill-scope + asOf) deferred via plan v1.3 ADR D4 amendment — explicit consumer boundary in CHANGELOG. |
| MINOR | 14 carried forward | Surface honestly in PR description; merge can proceed. |
| INFO | 22 carried forward | Logged in prior review report; no action. |

**Caveats summary** (for PR description):

1. **3 pre-existing-debt MAJOR deferred** to a dedicated refactor cycle:
   - F-arch-2: `applySkillFilters()` ad-hoc inline structural type at `src/local/index.ts:170` (predates v1.1; v1.1 only widened the param shape)
   - F-arch-6: `src/local/pgvector-store.ts` 788 LoC over 500 budget (v1.1 added +86 LoC in-scope; trajectory predates v1.1)
   - F-arch-7: `src/local/index.ts` 1097 LoC over 500 budget (v1.1 added +18 LoC; trajectory predates v1.1)

2. **EC-9 (skill-scope + asOf) deferred** to a follow-up cycle per plan v1.3 ADR D4 amendment:
   - `memory.skills(repoId).recall(...)` does NOT accept `asOf` in v1.1 (`SkillRecallOptions` lacks the field)
   - Memory-scope `asOf` (`memory.user/session/agent(id).recall({ asOf })`) is fully wired and tested
   - CHANGELOG declares the boundary explicitly so consumers understand the contract surface

3. **14 MINOR findings carried forward** from prior /review (paper-names in JSDoc on the source-comment boundary; missing `::timestamptz` cast on Date params; minor test-naming inconsistencies) — non-blocking. Recommended for opportunistic cleanup when surrounding code is next touched.

## Closures verified (this re-run)

Per the user's "Lightweight verification" selection, closures were verified deterministically rather than by re-spawning agents. All 3 v1.1-introduced MAJOR findings from the prior 02:58 /review report are confirmed closed against HEAD=`34e6140`:

### F-arch-11/12/13 — Paper-name violations in test code (commit `1f29ba8`)

```text
Verification: grep -rn 'Graphiti\|Mem0\|Honcho\|...' tests/ src/ --include='*.test.ts' \
              | grep <v1.1 fix-up files>
Result: zero v1.1-introduced paper-name hits.
```

- `tests/integration/v1-1-multi-peer-bitemporal.test.ts:156` — descriptor renamed `(Graphiti null-safe predicate)` → `(null-safe temporal predicate)` ✅
- `src/local/__tests__/pgvector-store.test.ts:359` — comment `// Graphiti precedent + null-safe` → `// null-safe temporal predicate` ✅
- `src/core/__tests__/extraction-prompt.test.ts:175` — comment `bivalent Mem0 vocabulary` → `prior two-role vocabulary` ✅

### F-dom-dbmig-1 — Partial-index parity in `schema.ts` (commit `85cb9de`)

```text
Verification:
  grep -c idx_memories_user_attributed_to <files>
  → src/local/schema.ts:                            1  ✅ NEW (closes the gap)
  → src/local/migrations/0008_attributed_to.sql:    1  ✅ original hand-authored
  → src/local/migrations/0009_v1_1_index_parity.sql:1  ✅ idempotent IF NOT EXISTS
  → src/local/migrations/meta/0009_snapshot.json:   2  ✅ Drizzle snapshot includes index
```

The drizzle-kit push parity gap (architecture.md § 10.2) is closed: dev-time `db:push` now introspects schema.ts and creates the same partial composite index that `runMigrations()` creates via the SQL chain. Both migration paths converge.

### F-xval-1 / F-tests-1 / F-wire-1 — EC-9 skill-scope + asOf honest deferral (commit `34e6140`)

```text
Verification: grep -n 'D4 amendment.*EC-9' .claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md
Result: ADR D4 amendment block present at the plan; declares:
  - v1.1 contract for asOf covers memory scopes only
  - skill-scope asOf is OUT OF SCOPE for v1.1 (follow-up cycle)
  - CHANGELOG carries the explicit consumer boundary statement
  - wiring-triad holes (pillars a/b for skill-scope) surfaced honestly
```

- Plan v1.2 → v1.3 bumped with clear delta in the version header ✅
- ADR D4 amendment block authored with explicit decision + rationale + CHANGELOG contract + follow-up scope ✅
- CHANGELOG fix-up entry written; original v1.1 entry's misleading "EC-9 skill rows + asOf filter" claim CORRECTED to reflect actual contract boundary ✅
- Wiring triad table in prior /review report documents pillars (a) + (b) holes for skill-scope path ✅

Inquebrável Rule 3 honored: honest deferral > silent miss.

## Quality gates re-validated (HEAD = `34e6140`)

| Gate | Result | Notes |
|---|---|---|
| Unit + integration tests | ✅ PASS | 845 passed / 2 skipped / 107 files passed / 1 skipped (integration GOAL test is `describe.skipIf(PG_URI === '')` — skipped without env var) |
| TypeScript typecheck | ✅ PASS | Zero errors |
| Lint | ✅ PASS | Zero warnings |
| Coverage | ⚠️ NOT RE-RUN | Fix-up adds zero new executable logic; v0.4b/v0.6/v0.7/v1.1 baseline ≥ 90% holds. |
| THE GOAL TEST | ⚠️ HOLD FROM 02:26 PRIOR RUN | 7/7 PASS evidence at HEAD=`3669cb7` still applies — fix-up edits do NOT touch runtime semantics. |
| Wiring triad pillar (a) | ✅ intact | `composeTemporalWhere` has 1 production caller; `attributedTo` has 9 production callers across src/ |
| Wiring triad pillar (b) | ✅ intact (memory-scope) / ❌ skill-scope deferred | Confirmed honestly via ADR D4 amendment per Rule 3 |
| Wiring triad pillar (c) | n/a per plan Global DoD | No new runtime counters declared in v1.1 |

## Edge-case coverage

Carried forward from prior /review: `edge_case_coverage.py` returned 0.067 (3/45). The metric is **spurious for this plan shape** — the script extracts every plan bullet as a "case"; for v1.1 the actual EC absorption is tracked by implement-validate criterion 4 (all 13 ECs marked absorbed with explicit fix or deferral path). Do not auto-block on this ratio.

## Cross-validation re-confirm

| Plan v1.3 task | State at HEAD=`34e6140` |
|---|---|
| T0.1 (ADR-0011 + ADR-0006 amendment + EC-4 audit) | ✅ shipped (commit `ee6056d`) |
| T1.1 (migration + schema + DTO + RememberOptions) | ✅ shipped (commit `ef4a434`) + F-dom-dbmig-1 fix-up (commit `85cb9de`) |
| T1.2 (LLM prompt N-valent) | ✅ shipped (commit `7f4eb05`) + F-arch-13 cleanup (commit `1f29ba8`) |
| T2.1 (hoist + projection + pipeline wiring) | ✅ shipped (commit `24d4f05`) |
| T2.2 (recall filter + WHERE) | ✅ shipped (commit `73cd889`) |
| T3.1 + T3.2 (BiTemporal lift + asOf SQL composer) | ✅ memory-scope shipped (commit `8876fb3`) + F-arch-12 cleanup (commit `1f29ba8`); skill-scope EC-9 deferred to follow-up cycle per ADR D4 amendment (commit `34e6140`) |
| T4.1 (THE GOAL TEST 7/7 + CHANGELOG) | ✅ shipped (commit `42e2ace` + `3669cb7` resilience) + F-arch-11 cleanup (commit `1f29ba8`) + CHANGELOG v1.1 fix-up entry (commit `34e6140`) |

7 fully implemented + 1 partial-with-honest-deferral (EC-9 skill-scope) = the v1.1 contract verbatim per plan v1.3.

## Honest disclosures (Inquebrável Rule 3)

1. **Lightweight verification mode** was an explicit user-elected trade-off (~5-10k tokens vs ~150-250k for full re-spawn). The same 7 agents are NOT re-invoked. The closures + quality gates ARE re-verified deterministically. The 14 MINOR + 22 INFO findings from the prior /review are carried forward unchanged (the 3 fix-up commits touch ~8 small files, none of which are in the locus of any MINOR/INFO finding; nothing they cover changed).
2. **THE GOAL TEST 7/7 PASS evidence holds from the prior HEAD=`3669cb7` run.** The shell session lacks the postgres password (`.env` file is hook-protected). All 3 fix-up commits are runtime-semantics-neutral (paper-name string edits + idempotent SQL parity + docs); regression risk is minimal-to-zero.
3. **Pre-existing pending failure persists** (`threshold-policy.test.ts` `beforeAll`) — NOT introduced or affected by v1.1 fix-up.
4. **3 pre-existing paper-name patterns NOT in v1.1 scope** were surfaced during the lightweight verification (in `tests/integration/migrations/dim-change.test.ts`, `src/agent-tools/**/__tests__/*.ts`, `src/benchmarks/mem0/**`, etc.) — opportunistic cleanup per the project rule's policy when those files are next touched; out of scope for this fix-up.

## Spawned agents (audit trail)

No new agent dir spawned for this re-run (Lightweight verification mode). The prior 02:26 agent dir at `.claude/agents/review-v1-1-multi-peer-and-bi-temporal-2026-06-03/` + its findings + paired knowledge skills remain in place as audit trail for the original findings. Rotation per `audit-trail-rotation.md` (move to `_archive/` after 30 days post PR-merge).

## Handoff

**Verdict: READY_TO_MERGE_WITH_CAVEATS**

Recommended PR description bullets:
- v1.1 ships multi-peer attribution (Roadmap row 12) + bi-temporal local-runtime lift (ADR-0011). THE GOAL TEST 7/7 PASS against real `ankane/pgvector:v0.5.1`.
- /review fix-up cycle 2 closes 3 v1.1-introduced MAJOR findings (paper-names + partial-index parity + EC-9 honest deferral via ADR D4 amendment).
- 3 pre-existing-debt MAJOR (`applySkillFilters` ad-hoc type + 2 LoC budget overruns) deferred to a dedicated refactor cycle.
- 14 MINOR + 22 INFO surfaced honestly in `.claude/knowledge-base/reviews/v1-1-multi-peer-and-bi-temporal-review-2026-06-03.md`.
- Plan v1.3 absorbs the fix-up; ready to archive after merge per cycle-plan archive discipline.
- **`/dogfood` gate remains independent and EVIDENCE_INSUFFICIENT** — this PR does NOT unblock production-ready claims.

Plan archive eligible: the active plan at `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md` SHOULD move to `.claude/knowledge-base/plans/completed/` after merge per the plan template's Global DoD `Plan archived` checkbox.

NOT auto-merging per cycle-review § Anti-pattern #6 (final merge is human decision).
