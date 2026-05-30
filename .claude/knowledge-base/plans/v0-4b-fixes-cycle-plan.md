# Plan: v0.4b fixes cycle — close 40 findings from `/review`

> **Version 1.1** (2026-05-30) — Absorbed 4 MUST FIX + 4 SHOULD TEST + 3 DOCUMENT from `.claude/knowledge-base/reviews/v0-4b-fixes-cycle-edge-cases-2026-05-30.md`. **EC-1 (T0.1):** DROP DATABASE step + journal-entries-count assertion to prevent unclean-throwaway-DB snapshot corruption. **EC-2 (T1.1):** explicit `isOptionsObject` type guard + RED test for `undefined` first-arg backward-compat path (was at risk of TypeError on existing 8 call sites). **EC-3 (T7.1):** new ADR D7 marking forget() as PUBLIC API BREAKING change + SHOULD TEST for raw-SELECT post-state + CHANGELOG.md `**BREAKING**:` prefix. **EC-4 (T11.1):** split into T11.1a (publish runbook FIRST, doc-only) + T11.1b (idempotency-test + repair script); RECEDED on stripping `IF NOT EXISTS` from 0003.sql per EC-4 — keeping defensive guards on column adds because users may have applied 0003 manually between v0.4b and v0.4b-fixes shipping. SHOULD TEST + DOCUMENT items absorbed inline into T3.1, T4.1, T9.1, T11.2, T2.1, T13.1, T9.2 task sections.
> **Version 1.0** (2026-05-30) — Initial plan. Closes the 40 findings from `/review v0-4b-forgetting-pipeline` (commit fd4b90b+pre-merge audit at `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md`): 1 BLOCKER + 5 CRITICAL + 13 MAJOR + 8 MINOR + 13 INFO. Mirrors the v0.6.1 voyager-skill-library-fixes-v0-6-1 pattern (commit b6aead6 — 23 findings in 14 commits) — atomic-commit-per-task with TDD discipline. Lands on develop (no feature branch per root global CLAUDE.md § 4); blocks `cycle-review READY_TO_MERGE` verdict on the v0.4b pipeline until every BLOCKER + CRITICAL is committed and the MAJOR set is either fixed or deferred via explicit ADR row.

## Goal

> "Enable v0-4b-forgetting-pipeline to reach `cycle-review` verdict `READY_TO_MERGE` so that the 14-task implementation cycle (commits 2a1a206..1a64c0d) can merge to main, measured by a re-run of `/review v0-4b-forgetting-pipeline` returning `{ BLOCKER: 0, CRITICAL: 0 }` in the consolidated report `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-{rerun-date}.md`."

The action verb is **enable**; the named observable metric is the re-run review verdict (current `NEEDS_FIXES` → target `READY_TO_MERGE`). Single sentence.

## Context

### What exists today

`cycle-implement` for `v0-4b-forgetting-pipeline` shipped 14 commits on develop between 2026-05-30 15:34 UTC (T0.1 `2a1a206`) and 2026-05-30 19:11 UTC (T8.1 `1a64c0d`). All 14 tasks reached `status=committed`; the halt-loop emitted `IMPLEMENTATION_COMPLETE` at iteration 14. CLAUDE.md § Macro roadmap Item 6 acceptance VERBATIM is genuinely met (T7.1 `recall@10 = 1.000 ≥ 0.70` + T7.2 rare survives ≥ 5 LRU passes; T8.1 validation chain PARTIAL with 1 SKIP for coverage tooling).

`cycle-review` ran 2026-05-30 16:13 UTC and spawned 7 specialized agents (architecture, tests, wiring, cross-validation, domain-memory-layer, domain-pgvector-schema, domain-db-migrations). The consolidated report is at `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md`.

### The 40 findings (triaged for this plan)

| Severity | Count | Disposition this plan |
|---|---|---|
| **BLOCKER** | 1 | MUST FIX (close in T0.1) |
| **CRITICAL** | 5 | MUST FIX (close in T1-T5) |
| **MAJOR** | 13 | All FIX-IN-PR per v0.6.1 precedent (closed in T6-T11) |
| **MINOR** | 8 | Cherry-pick: fix the cheap ones inline; log the rest as followups (T12) |
| **INFO** | 13 | Accept; no action needed |

### Why this matters NOW

1. **F-dom-db-1 BLOCKER ships eviction broken to production.** `runMigrations(pool)` reads only `_journal.json`; the journal stops at `0002_skill_columns`. Without sync, prod DBs miss the v0.4b schema entirely and the first `recall()` write-back hook crashes with `column does not exist`. The fix is mechanical (`npm run db:generate`) and CANNOT wait for a v0.4b.1 PR.
2. **5 CRITICAL findings block consumer adoption.** F-dom-2 (no barrel exports) means consumers literally cannot import `TriadicScoringPolicy` via the public API. F-dom-1+F-dom-pg-3 (agent-only triggers) silently drop User/Session memories from eviction — contract violation of ADR-0002. F-arch-1 (5-positional constructor) makes every consumer call site fragile. F-dom-db-2 (db:push misses 0004 trigger) makes dev environments silently broken for EC-1.
3. **13 MAJOR findings collectively undermine the "OPEN PROBLEM #1" claim.** F-dom-5 (long-tail multiplier only fires for agent/repo scopes), F-dom-3 (caller-driven forget() still hard-deletes), F-dom-pg-2 (HNSW likely not used by NN query), F-xval-1 (EvictionPolicy interface diverged from ADR D12) — each of these weakens the v0.4b deliverable from the consumer's perspective.

### Compliance scope

Plan honors `architecture.md § 3` (DIP — moving HalfLifePersister + NearestNeighborProvider interfaces from src/local/ to src/core/dip/ per F-arch-2 finding), `§ 9` (Public API surface — adding to src/local/index.ts + src/index.ts per F-dom-2 + F-arch-5 + F-wire-2 findings), `§ 10` (Build pipeline — postbuild glob covers .sql files OK). Honors `testing.md` (every fix-task has TDD). Honors `no-paper-names-in-code.md` (zero new paper-name introductions). Honors `dogfood-golden-rule.md` (no `production-ready` claim introduced). Honors `deps-audit-golden-rule.md` (zero new deps; F-tests-2 Fisher-Yates uses built-in `Math.random`).

## Objective

- [ ] T0.1 — Close BLOCKER F-dom-db-1: Drizzle journal sync (npm run db:generate + commit snapshots)
- [ ] T1.1 — Close CRITICAL F-arch-1: TriadicScoringPolicy refactored to options-object constructor
- [ ] T2.1 — Close CRITICAL F-dom-db-2: db:push trigger application (Option A — wrap script)
- [ ] T3.1 — Close CRITICAL F-dom-1 + F-dom-pg-3 + MAJOR F-arch-4 + F-dom-4: scope-tier generalization in triggers + partial index
- [ ] T4.1 — Close CRITICAL F-dom-2 + MAJOR F-arch-5 + F-wire-2 + F-xval-3: public-API barrel + createLocalMemory wiring
- [ ] T5.1 — Close MAJOR F-arch-2: relocate HalfLifePersister + NearestNeighborProvider interfaces to src/core/dip/
- [ ] T6.1 — Close MAJOR F-arch-3 + F4 followup: extract shared scope-candidate.ts helper
- [ ] T7.1 — Close MAJOR F-dom-3 + F-wire-1: LocalScopedMemory.forget() delegates to PgEvictor (soft-delete uniform)
- [ ] T7.2 — Close MAJOR F-dom-5: long-tail multiplier honors User/Session via scope-key resolution
- [ ] T8.1 — Close MAJOR F-xval-1: EvictionPolicy interface aligned with ADR D12 OR ADR D12 updated to declared shape
- [ ] T9.1 — Close MAJOR F-dom-pg-1 + F-dom-pg-2: index columns + NN query refactor to enable HNSW
- [ ] T9.2 — Close MAJOR F-dom-pg-4: 0004 trigger race-window documentation + integration test
- [ ] T10.1 — Close MAJOR F-dom-6: OTel meter lazy initialization (per-instance instead of module-load)
- [ ] T11.1a — Publish v0.4b rollback runbook (close F-dom-db-4 MAJOR; v1.1 EC-4 absorption — runbook ships FIRST)
- [ ] T11.1b — Idempotency-test + cross-version repair script (close F-dom-db-3 MAJOR; v1.1 EC-4 REVERSAL — KEEP `IF NOT EXISTS` defensive guards on 0003.sql)
- [ ] T11.2 — Close MAJOR F-tests-1 + F-tests-2: deterministic rare-target hashes + Fisher-Yates random baseline
- [ ] T12.1 — Close MINOR cluster: F-arch-6 (console.warn), F-xval-2 (dead lifecycle hooks), F-dom-db-5 (trailing newline), F-dom-pg-5 (advisory-lock keyspace doc), F-dom-pg-6 (xmin/ctid)
- [ ] T13.1 — Final validation: re-run `/implement-validate` + `/review` MUST return verdict ≥ READY_TO_MERGE (zero BLOCKER, zero CRITICAL)

## ADRs

### D1 — Atomic-commit-per-task following v0.6.1 fixes-cycle precedent

- **Decision:** every numbered task above ships as ONE atomic commit on develop with conventional-commits format `fix(scope)(v0-4b-fixes): <finding-ids absorbed> (T{N.M})`. Body cites each finding ID closed + the SEPA audit trail line.
- **Rationale:** v0.6.1 voyager-skill-library-fixes-v0-6-1 (commit b6aead6) closed 23 findings in 14 commits using this pattern; produced a clean post-cycle `/review` re-run verdict READY_TO_MERGE. Same shape applies to v0.4b's 40 findings.
- **Consequences:** the final cycle delivers ~17 commits (T0.1 + T13.1 framing + 15 fix tasks); each is independently revertable if a regression surfaces post-merge. The plan-archive lifecycle from `cycle-implement.md § Global DoD` applies (move plan to `plans/completed/` only AFTER the cycle-review re-run returns READY_TO_MERGE + PR merged to main).

### D2 — Re-run `/review` is the canonical metric, NOT BLOCKER+CRITICAL count

- **Decision:** Plan completion is gated by `/review v0-4b-forgetting-pipeline` returning `{ BLOCKER: 0, CRITICAL: 0 }` in the re-run report `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-{rerun-date}.md` — NOT by manual count of closed findings.
- **Rationale:** new CRITICAL findings could surface from the refactors in T3.1 (scope tier generalization) or T7.2 (multiplier scope) — only a fresh review can verify the v0.4b chain holds together after fixes. v0.6.1 precedent: the fixes-cycle ended with a re-run that introduced 0 new findings; the same gate applies here.
- **Consequences:** if the re-run finds NEW BLOCKER/CRITICAL after T13.1, a v0-4b-fixes-cycle v1.1 must be drafted (same pattern as plan v1.x bumps in the original v0-4b cycle).

### D3 — User/Session tier coverage strategy — generalize, not scope-down

- **Decision:** T3.1 generalizes triggers + partial index + multiplier to honor User/Session/Agent tiers via the typed `Scope` discriminated union (NOT the "scope-down to agent-only + update CLAUDE.md framing" alternative offered by F-dom-1 + F-dom-5 recommended actions).
- **Rationale:** CLAUDE.md § Macro roadmap Item 6 acceptance text doesn't qualify tier-specific behavior; scoping down would weaken the "OPEN PROBLEM #1" claim from "no competitor solved this" to "no competitor solved agent-tier eviction" — a substantively different and weaker positioning. Generalization is a one-day refactor; scope-down requires public-copy revision + CLAUDE.md amendment + docs/forgetting-evaluation.md re-framing.
- **Consequences:** triggers + multiplier accept `Scope` discriminated union from `src/core/scope.ts`. Three partial indexes ship in a new migration (`0005_eviction_partial_indexes.sql`): `(agent_id, last_accessed_at)`, `(user_id, last_accessed_at)`, `(session_id, last_accessed_at)`. Test harnesses extend to verify all 3 tiers participate in eviction.

### D4 — BLOCKER F-dom-db-1 fix uses `npm run db:generate` (Option A from recommended_action), not hand-authored snapshots

- **Decision:** T0.1 invokes `npm run db:generate` against a temporary throwaway DB (NOT the test DB) to materialize `meta/0003_snapshot.json` + `meta/0004_snapshot.json` + bump `_journal.json` entries.
- **Rationale:** hand-authored snapshots risk version-string drift (Drizzle's snapshot schema is non-trivial JSON). Tooling-generated snapshots are byte-for-byte what the next `drizzle-kit` run would emit, eliminating divergence risk. Trade-off: requires a temporary DB; acceptable cost.
- **Consequences:** T0.1 also adds a publish-readiness integration test (`tests/integration/migrations/journal-sync.test.ts`) that asserts every `.sql` file under `src/local/migrations/` has a matching `meta/{name}_snapshot.json` AND a journal entry — prevents future drift.

### D5 — F-arch-1 options-object constructor introduces a new public type but does NOT break existing call sites at T1.1

- **Decision:** the new options-object constructor accepts `TriadicScoringPolicyOptions` interface. The existing 5-positional signature stays as a deprecated overload for ONE release cycle (v0.4b ships both; v0.4c removes the positional form).
- **Rationale:** preserves backward compat for any consumer that may have copy-pasted the test patterns. Two signatures with TypeScript overload resolution is < 20 LoC of declaration; clean.
- **Consequences:** consumers see the options-object as canonical in docs + examples; the positional form gets a `@deprecated` JSDoc annotation with migration path. CHANGELOG.md under `[Unreleased]` § Deprecated.

### D6 — F-dom-2 + F-arch-5 + F-wire-2 + F-xval-3 consolidate to ONE task T4.1

- **Decision:** rather than 4 separate tasks, ONE task adds `src/local/eviction/index.ts` barrel + re-exports from `src/local/index.ts` + wires `TimeBasedTrigger.start()` / `CapacityBasedTrigger` instantiation into `createLocalMemory()` factory.
- **Rationale:** the 4 findings are facets of the same architectural gap (v0.4b ships structurally unreachable from public API). Closing them in 4 commits would produce overlapping diffs and confusing audit trail. v0.6.1 precedent: F3+F8+F9 from that cycle were similarly consolidated.
- **Consequences:** T4.1 commit body explicitly cites all 4 finding IDs absorbed. The wiring triad re-run at T13.1 MUST show pillar (a) PASS for every v0.4b public class.

### D7 — T7.1 forget() soft-delete is a PUBLIC API BREAKING CHANGE — declare honestly (v1.1 / EC-3 absorption)

- **Decision:** T7.1 changes `Memory.forget(id)` semantics from physical DELETE (v0.1 contract) to soft-delete via `t_invalid = NOW()`. The change is BREAKING for any consumer that ran raw `SELECT count(*)` post-forget assertions. Plan ships with: (a) explicit `**BREAKING**:` prefix in CHANGELOG.md `[Unreleased]` § Changed, (b) SHOULD TEST asserting raw-SELECT post-forget returns the row with `t_invalid` set (documents the new contract), (c) public-copy update on `Memory.forget()` JSDoc explicitly contrasting v0.1 → v0.4b behavior.
- **Rationale:** F-dom-3 surfaced the inconsistency (caller-driven hard delete vs trigger-driven soft delete); ADR D17 § Consequences claimed both used soft-delete which was FALSE in shipped runtime. Unifying via soft-delete is the architecturally-correct choice (preserves bi-temporal audit trail per ADR-0006). The BREAKING declaration is the honesty signal required by Inquebrável Rule 3 + the dogfood golden rule's vocabulary discipline.
- **Consequences:** v0.4b release notes carry the BREAKING flag visibly. Next semver bump (minor not patch). Consumer migration path: replace `assert count_after_forget == 0` with `assert count_after_forget_where_t_invalid_null == 0`. Plan also enables a future `Memory.purge(id)` API for hard-delete callers (out of scope; logged as v0.5 followup).

## Dependency Graph

```
T0.1 (BLOCKER journal) ──▶ T1.1 (options-object) ──▶ T2.1 (db:push trigger)
                                                          │
                                                          ▼
                                                    T3.1 (scope tier generalize) — depends on T1.1 (constructor)
                                                          │
                                                          ▼
                                                    T4.1 (barrel + createLocalMemory wiring) — depends on T1.1, T3.1
                                                          │
                                                          ▼
                                                    T5.1 (DIP interface relocate) ─┐
                                                                                    │
                                                    T6.1 (DRY scope-candidate.ts) ─┤
                                                                                    │
                                                    T7.1 (forget soft-delete) ─────┤── parallel-safe after T4.1
                                                                                    │
                                                    T7.2 (multiplier tier) ────────┤── depends on T3.1
                                                                                    │
                                                    T8.1 (interface ADR D12) ──────┘
                                                          │
                                                          ▼
                                                    T9.1, T9.2, T10.1, T11.1, T11.2 — parallel-safe
                                                          │
                                                          ▼
                                                    T12.1 (MINOR cluster) — parallel-safe
                                                          │
                                                          ▼
                                                    T13.1 (re-run /review — the GATE)
```

T0.1 unblocks everything (BLOCKER). T1.1 unblocks T3.1, T4.1, T8.1 (constructor shape). T3.1 unblocks T4.1, T7.2 (scope tier). T4.1 unblocks T7.1 (forget delegation through public path). T5.1-T11.2 are mostly parallel-safe within their tier. T12.1 is a cleanup batch. T13.1 is the canonical metric.

---

## Phase T0: BLOCKER unblock

**Objective:** make `runMigrations(pool)` apply 0003 + 0004 on fresh prod DBs.

### T0.1 — Drizzle journal sync (close F-dom-db-1 BLOCKER)

#### Objective

Materialize `meta/0003_snapshot.json` + `meta/0004_snapshot.json` + bump `_journal.json` so `runMigrations(pool)` applies the v0.4b migrations on fresh prod DBs.

#### Evidence

`grep . src/local/migrations/meta/_journal.json` shows entries stop at `0002_skill_columns` (last entry idx=2). Files `0003_snapshot.json` + `0004_snapshot.json` do not exist (`ls src/local/migrations/meta/`). Drizzle's migrate() reads ONLY the journal; .sql files on disk that are not journal-tracked are silently ignored. Verified via comparison: commit `4b75a20` (v0.6 0002 migration) bumped journal AND added snapshot in the same commit; commits `2a1a206` (v0.4b T0.1) + `0739d26` (v0.4b T2.2) added .sql files only.

#### Files to edit

```
src/local/migrations/meta/_journal.json — UPDATE: add entries idx=3 (0003) + idx=4 (0004)
src/local/migrations/meta/0003_snapshot.json — NEW (generated)
src/local/migrations/meta/0004_snapshot.json — NEW (generated)
tests/integration/migrations/journal-sync.test.ts — NEW: assert every .sql file has matching snapshot + journal entry
```

#### Deep file dependency analysis

- `_journal.json`: read by Drizzle's `migrate()` to determine which migrations to apply. Schema: `{ version: "7", dialect: "postgresql", entries: [{ idx, version, when, tag, breakpoints }] }`.
- `0003_snapshot.json` + `0004_snapshot.json`: per-migration full DB-schema snapshots; required by Drizzle to compute incremental diffs.
- The new integration test catches future drift — if a v0.4c migration adds a .sql without bumping the journal, the test fails the build.

#### Deep Dives

- **Generate, don't hand-author** (per ADR D4): run `npm run db:generate` against a throwaway DB. The script invokes `drizzle-kit generate` which serializes Drizzle's schema.ts model into the snapshot JSON. Manually authoring this JSON is error-prone (schema is non-trivial).
- **Throwaway DB**: use `docker compose up -d pgvector` + a temporary `THEOMEM_PG_URI` pointing at a `themem_journal_sync_tmp` database. Reset after.
- **Migration ordering**: `0003_snapshot.json` must reflect schema state AFTER 0003.sql applied; `0004_snapshot.json` must reflect state AFTER 0003 + 0004. Drizzle generates these incrementally.

#### Tasks

1. RED test: `tests/integration/migrations/journal-sync.test.ts` reads `meta/_journal.json` + `ls meta/*.json` + `ls 0*.sql` → asserts the three counts match (every .sql has a snapshot + journal entry).
2. Run RED — should fail because 0003 + 0004 lack snapshots.
3. **EC-1 absorption (v1.1):** Ensure CLEAN throwaway DB state. Run `psql "$ROOT_PG_URI" -c "DROP DATABASE IF EXISTS themem_journal_sync_tmp;"` then `CREATE DATABASE themem_journal_sync_tmp;`. **Without the DROP step, drizzle-kit may produce incremental snapshots that diff from a partial baseline → byte-wrong snapshot content → ships silent schema corruption (own-BLOCKER risk).**
4. Boot pgvector container; `THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem_journal_sync_tmp`.
5. Run `npm run db:generate` to materialize snapshots + bump journal.
6. **EC-1 absorption (v1.1):** Capture `_journal.json` entries-count BEFORE generate; after generate, assert entries-count increased by exactly 2 (one for 0003, one for 0004). Abort if count delta ≠ 2 — indicates drizzle-kit did something unexpected (e.g., merged into existing entry, or generated 3+ entries from an unclean baseline).
7. Inspect generated `_journal.json` (idx=3 + idx=4 added).
8. Run GREEN — test now passes.
9. REFACTOR: drop the throwaway DB (`DROP DATABASE themem_journal_sync_tmp;`).

#### TDD

```
RED:      test_journal_entries_match_sql_file_count — count(meta/*.json)-1 (minus _journal) == count(0*.sql)
RED:      test_journal_entries_cover_every_sql_file — for each *.sql, entry with matching tag exists
GREEN:    Generate snapshots + journal via drizzle-kit
REFACTOR: None expected
VERIFY:   npm run test:integration -- tests/integration/migrations/journal-sync.test.ts
```

#### Acceptance Criteria

- [ ] 2 RED tests now GREEN
- [ ] `_journal.json` contains entries with `tag: "0003_eviction_columns"` + `tag: "0004_eviction_half_life_trigger"`
- [ ] `meta/0003_snapshot.json` + `meta/0004_snapshot.json` files exist + are non-empty JSON
- [ ] Smoke: against a fresh `themem_test_runmigrations` DB, `npm run build && node -e "import('./dist/local/index.js').then(m=>m.runMigrations(...))"` applies all 5 migrations (0000-0004)
- [ ] Pass: lint zero warnings
- [ ] Pass: size — `_journal.json` ≤ 100 LoC, snapshots ≤ 1000 LoC each (Drizzle-generated)

#### DoD

- [ ] `npm run test:integration -- tests/integration/migrations/journal-sync.test.ts` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

---

## Phase T1: Options-object constructor

### T1.1 — TriadicScoringPolicy options-object refactor (close F-arch-1 CRITICAL)

#### Objective

Refactor TriadicScoringPolicy to accept a single options-object via TypeScript overload while preserving the existing 5-positional signature as deprecated for one release per ADR D5.

#### Evidence

`grep "new TriadicScoringPolicy" tests/ src/` shows 8+ call sites: `new TriadicScoringPolicy(undefined, undefined, null, null, evictor)` (test files) and similar positional-undefined chains. SOLID smell: SRP + OCP regression — every new collaborator widens the param list.

#### Files to edit

```
src/local/eviction/triadic-scoring-policy.ts — UPDATE: add TriadicScoringPolicyOptions interface + new constructor overload
src/local/eviction/__tests__/triadic-scoring-options.test.ts — NEW RED: assert both constructor signatures work
tests/integration/eviction/*.test.ts — UPDATE 6 files: switch to options-object signature
docs/forgetting-evaluation/run.ts — UPDATE: switch to options-object signature
```

#### Deep file dependency analysis

- `triadic-scoring-policy.ts`: line 214 currently has 5-positional constructor. New overload: `constructor(options: TriadicScoringPolicyOptions)`.
- TypeScript overload resolution: keep both via `constructor(weightsOrOptions: TriadicWeights | TriadicScoringPolicyOptions, ...)` + branch on `typeof` discriminator.
- Test call-site migration: 8 sites use positional; all migrate to `{ evictor, neighborProvider, ... }`.

#### Deep Dives

- **Interface:** `interface TriadicScoringPolicyOptions { weights?: TriadicWeights; constants?: TriadicConstants; halfLifePersister?: HalfLifePersister | null; neighborProvider?: NearestNeighborProvider | null; evictor?: Evictor | null; }`
- **Discrimination (v1.1 EC-2 absorption):** the naive `'weights' in arg` check THROWS TypeError on `undefined` first-arg (which 8+ existing test call sites pass as `new TriadicScoringPolicy(undefined, undefined, null, null, evictor)`). Use an explicit type guard handling all 4 input shapes:
  ```ts
  function isOptionsObject(arg: unknown): arg is TriadicScoringPolicyOptions {
    return typeof arg === 'object' && arg !== null
      && !('recency' in arg);  // TriadicWeights has 'recency'; Options does not
  }
  // Branch:
  if (arg === undefined || isWeightsLike(arg)) { /* positional path */ }
  else if (isOptionsObject(arg)) { /* options path */ }
  ```
- **Deprecation:** add `@deprecated` JSDoc to the positional signature with migration example.

#### Tasks

1. RED test in `triadic-scoring-options.test.ts`: assert `new TriadicScoringPolicy({ evictor })` produces a working instance (.score, .selectVictims, .evict callable).
2. RED test 2: assert `new TriadicScoringPolicy(undefined, undefined, null, null, evictor)` still works (deprecated path).
3. Implement overload + interface in triadic-scoring-policy.ts.
4. Migrate 6 test files + run.ts to options-object form.
5. Run GREEN.

#### TDD

```
RED:      test_options_object_constructor_accepts_evictor — single-options-arg
RED:      test_options_object_constructor_accepts_full_options — all 5 fields
RED:      test_positional_constructor_still_works_with_deprecation — backward compat
RED:      test_positional_first_arg_undefined_does_not_throw (EC-2) — `new TriadicScoringPolicy(undefined, undefined, null, null, evictor)` constructs without TypeError
RED:      test_options_object_with_only_evictor_does_not_match_weights_shape (EC-2) — disambiguation guard rejects `{evictor:...}` from being treated as TriadicWeights
GREEN:    Implement overload + interface + isOptionsObject type guard branching
REFACTOR: Migrate call sites to options-object form
VERIFY:   npm test -- src/local/eviction/__tests__/triadic-scoring-options.test.ts && npm run test:integration -- tests/integration/eviction
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] All 36/36 v0.4b integration tests still pass post-migration to options-object call sites
- [ ] Positional signature carries `@deprecated` JSDoc + migration example
- [ ] CHANGELOG.md `[Unreleased]` § Deprecated entry added: "TriadicScoringPolicy positional constructor (use options-object form)"
- [ ] Pass: lint / size / complexity

#### DoD

- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors

---

## Phase T2: db:push trigger application

### T2.1 — db:push wraps trigger SQL apply (close F-dom-db-2 CRITICAL)

#### Objective

Extend `db:push` script to also apply `0004_eviction_half_life_trigger.sql` via psql after drizzle-kit push, so dev environments get the EC-1 invariant trigger.

#### Evidence

`drizzle-kit push` introspects schema.ts which has zero `trigger`/`function` declarations (Drizzle v0.45 does not model triggers). Net effect on fresh dev DB: trigger absent → lazy-half-life.test.ts EC-1 invariant test would fail if not previously psql-applied.

#### Files to edit

```
package.json — UPDATE: db:push script wraps drizzle-kit push + psql apply for trigger
tests/integration/migrations/dev-push-applies-trigger.test.ts — NEW RED: assert trigger present after db:push
```

#### Deep Dives

- **db:push current**: `node -e "..."` to ensure pgvector ext + `drizzle-kit push`.
- **Add**: `&& psql $THEOMEM_PG_URI -v ON_ERROR_STOP=1 -f src/local/migrations/0004_eviction_half_life_trigger.sql`
- **Generic strategy**: scan migration files for ones containing `CREATE TRIGGER` or `CREATE FUNCTION` and apply only those. For v0.4b that's just 0004; future migrations add to the list.

#### TDD

```
RED:      test_dev_push_creates_trigger — after npm run db:push, query information_schema.triggers and assert memories_reset_half_life_on_importance_update_trg present
GREEN:    Extend db:push script
REFACTOR: Extract glob for trigger-containing migrations
VERIFY:   npm run test:integration -- tests/integration/migrations/dev-push-applies-trigger.test.ts
```

#### Acceptance Criteria

- [ ] RED test GREEN
- [ ] `npm run db:push` against fresh DB results in trigger present
- [ ] Pass: lint / size
- [ ] **v1.1 EC-9 absorption:** README.md "Development prerequisites" section lists `psql` (PG client tools) explicitly. Error message check: if `psql` not found, `db:push` aborts with a clear message pointing at the prerequisites section (not a generic `command not found`).

#### DoD

- [ ] Integration test green
- [ ] architecture.md § 10.2 updated with the dev-push trigger-apply pattern
- [ ] README.md prerequisites updated (EC-9)

---

## Phase T3: Three-tier scope generalization

### T3.1 — Triggers + multiplier + partial index honor User/Session/Agent (close F-dom-1 CRITICAL + F-dom-pg-3 CRITICAL + F-arch-4 MAJOR + F-dom-4 MAJOR per ADR D3)

#### Objective

Generalize `CapacityBasedTrigger`, `TimeBasedTrigger`, `TriadicScoringPolicy.computeProtectionMultiplier`, and `idx_memories_eviction_score` partial index to honor all 3 scope tiers (User/Session/Agent) of ADR-0002, removing the silent agent-only restriction.

#### Evidence

F-dom-1 line 142 of capacity-based-trigger.ts: SQL filters `WHERE agent_id = $1` exclusively. Same pattern in time-based-trigger.ts. F-dom-pg-3 confirmed via pgvector domain reviewer. F-dom-4: partial index keyed on `agent_id` (line 4 of 0003.sql). User/Session-scoped memories NEVER counted, NEVER selected, NEVER evicted → ADR-0002 contract violation.

#### Files to edit

```
src/local/eviction/capacity-based-trigger.ts — UPDATE: accept Scope union; compose WHERE via scope.kind
src/local/eviction/time-based-trigger.ts — UPDATE: same
src/local/eviction/triadic-scoring-policy.ts — UPDATE: getNeighborScopeId resolves user_id / session_id / agent_id (NOT null fallback)
src/local/eviction/pg-nearest-neighbor-provider.ts — UPDATE: distance(memoryId, scope: Scope) signature
src/local/migrations/0005_eviction_partial_indexes.sql — NEW: add (user_id, last_accessed_at) + (session_id, last_accessed_at) partial indexes
src/local/migrations/meta/_journal.json — UPDATE: add idx=5 entry
src/local/migrations/meta/0005_snapshot.json — NEW (generated)
src/local/schema.ts — UPDATE: declare 2 new partial indexes via Drizzle index() helper
tests/integration/eviction/multi-tier-eviction.test.ts — NEW RED: seed mixed user/session/agent memories + verify each tier participates in eviction
```

#### Deep file dependency analysis

- `Scope` is the typed discriminated union at `src/core/scope.ts` (`{ kind: 'user' | 'session' | 'agent' | 'repo', userId/sessionId/agentId/repoId }`).
- Triggers currently accept `scopeId: string` — refactor to `scope: Scope` + helper `scopeWhereClause(scope): { sql, params }` that produces `WHERE user_id = $1` or `WHERE session_id = $1` or `WHERE agent_id = $1` based on `scope.kind`.
- Multiplier's `getNeighborScopeId` currently returns `null` for User/Session scopes (line 109-117 of triadic-scoring-policy.ts). Refactor to return the scope-tier column value.
- PgNearestNeighborProvider's SQL needs `WHERE m.{user_id|session_id|agent_id} = $2` parameterized by scope.kind.

#### Deep Dives

- **Helper**: `function scopeWhereClause(scope: Scope, paramStart: number): { sql: string, params: unknown[] }` returns dialect-aware predicate. Shared between triggers + NN provider.
- **Migration 0005**: `CREATE INDEX IF NOT EXISTS idx_memories_eviction_score_user ON memories (user_id, last_accessed_at) WHERE t_invalid IS NULL; CREATE INDEX IF NOT EXISTS idx_memories_eviction_score_session ON memories (session_id, last_accessed_at) WHERE t_invalid IS NULL;`
- **Backward compat**: callers passing string scope id directly need migration; the public API surface from T4.1 will only expose Scope-typed entry points.
- **Test fixture**: seed 30 user-scoped + 30 session-scoped + 30 agent-scoped memories (90 total, cap=60); fire trigger per tier; assert each tier evicts ~30%.

#### TDD

```
RED:      test_capacity_trigger_evicts_user_tier — seed user-scoped over cap, fire, assert eviction
RED:      test_capacity_trigger_evicts_session_tier — same for session
RED:      test_time_trigger_evicts_user_tier — same shape via time-trigger
RED:      test_nn_provider_returns_user_tier_distance — distance(id, {kind:'user',userId:'X'})
RED:      test_multiplier_protects_isolated_user_memory — long-tail multiplier fires for user-scope
RED:      test_getNeighborScopeId_prefers_scope_kind_over_column_presence (v1.1 EC-5) — seed row with user_id='X' AND session_id='Y'; pass scope={kind:'session',sessionId:'Y'}; assert returns 'Y' not 'X' (kind is authoritative; columns derived)
GREEN:    Refactor triggers + NN provider + multiplier + add migration 0005
REFACTOR: Extract scopeWhereClause helper to src/local/eviction/scope-where.ts
VERIFY:   npm run test:integration -- tests/integration/eviction/multi-tier-eviction.test.ts
```

#### Acceptance Criteria

- [ ] 5 RED tests GREEN
- [ ] Migration 0005 applies cleanly (journal-sync test from T0.1 still green)
- [ ] CapacityBasedTrigger + TimeBasedTrigger constructor accepts `Scope` instead of `scopeId: string`
- [ ] `getNeighborScopeId` returns user_id / session_id / agent_id / repoId per scope.kind
- [ ] 36+ existing v0.4b integration tests still pass (migrate fixtures to Scope-typed calls)
- [ ] Pass: complexity ≤ 10 per function

#### DoD

- [ ] All multi-tier tests green
- [ ] CHANGELOG.md `[Unreleased]` § Fixed: "v0.4b eviction triggers + long-tail multiplier now honor all 3 scope tiers (User/Session/Agent) per ADR-0002"

---

## Phase T4: Public API barrel + factory wiring

### T4.1 — src/local/index.ts barrel + createLocalMemory wiring (close F-dom-2 CRITICAL + F-arch-5 + F-wire-2 + F-xval-3 MAJOR per ADR D6)

#### Objective

Add `src/local/eviction/index.ts` barrel + re-export through `src/local/index.ts`; wire `CapacityBasedTrigger` + `TimeBasedTrigger` instantiation into `createLocalMemory(config)` factory so consumers can opt into v0.4b eviction via the public API.

#### Evidence

`grep "TriadicScoringPolicy\|PgEvictor\|CapacityBasedTrigger\|TimeBasedTrigger" src/local/index.ts src/index.ts` returns ZERO. Consumer cannot construct an eviction pipeline without reaching into `src/local/eviction/*` deep paths (escape of encapsulation). Plan T8.1 acceptance "(a) Static caller: TriadicScoringPolicy referenced in src/local/index.ts user-facing barrel" UNMET.

#### Files to edit

```
src/local/eviction/index.ts — NEW: barrel re-exporting TriadicScoringPolicy, PgEvictor, PgHalfLifePersister, PgNearestNeighborProvider, CapacityBasedTrigger, TimeBasedTrigger + types
src/local/index.ts — UPDATE: add `export * from './eviction/index.js'`; extend LocalMemoryConfig with optional eviction: { trigger?: 'capacity' | 'time', maxMemoriesPerScope?: number, cronExpression?: string, evictionFraction?: number }
src/index.ts — UPDATE: add eviction re-exports to public API surface
src/local/__tests__/eviction-barrel.test.ts — NEW RED: assert each v0.4b class importable from @usetheo/memory + @usetheo/memory (subpath)
tests/integration/forgetting/createLocalMemory-eviction.test.ts — NEW RED: createLocalMemory with eviction config wires CapacityBasedTrigger; first overflow remember() fires it
```

#### Deep file dependency analysis

- `src/local/eviction/index.ts`: NEW barrel; re-exports types + classes. Per `src/core/index.ts` precedent.
- `src/local/index.ts` line 593 has `createLocalMemory()` factory. Extend with optional eviction-trigger config + lazy-instantiate trigger + (for time-trigger) call .start() on memory boot.
- `src/index.ts`: top-level barrel; re-export at the right tier.

#### Deep Dives

- **Trigger lifecycle in factory**: if config.eviction.trigger === 'time', call trigger.start() inside createLocalMemory() and expose a `dispose()` method on the returned memory that calls trigger.stop(). If 'capacity', wire the trigger.fire() call into `remember()` post-write (via async post-hook).
- **Public API ergonomics**: aim for `createLocalMemory({ vectorStore, embedder, llm, eviction: { trigger: 'capacity', maxMemoriesPerScope: 1000 } })` as the canonical opt-in shape.

#### TDD

```
RED:      test_eviction_classes_importable_from_local_barrel
RED:      test_eviction_classes_importable_from_root_barrel
RED:      test_createLocalMemory_with_capacity_eviction_wires_trigger
RED:      test_createLocalMemory_with_time_eviction_starts_cron
RED:      test_overflow_remember_fires_capacity_trigger_via_factory
RED:      test_concurrent_capacity_and_time_triggers_no_double_evict (v1.1 EC-6) — wire BOTH via factory + manual instantiation; seed over cap; assert total evictions ≤ overflow_count via advisory-lock serialization (re-affirms original v0.4b T5.1 EC-2 invariant through the public factory path)
GREEN:    Add barrels + factory wiring
REFACTOR: Extract lifecycle helpers if size grows
VERIFY:   npm test -- src/local/__tests__/eviction-barrel.test.ts && npm run test:integration -- tests/integration/forgetting/createLocalMemory-eviction.test.ts
```

#### Acceptance Criteria

- [ ] 5 RED tests GREEN
- [ ] Wiring triad post-T4.1: pillar (a) PASS for every v0.4b public class (verify via `python3 .claude/skills/implement/scripts/check_wiring.py --symbol <each>`)
- [ ] CHANGELOG.md `[Unreleased]` § Added: "v0.4b eviction pipeline opt-in via `createLocalMemory({ ..., eviction: { trigger, maxMemoriesPerScope } })`"

#### DoD

- [ ] All tests green
- [ ] `npm run lint` zero warnings on touched files

---

## Phase T5: DIP interface relocation

### T5.1 — HalfLifePersister + NearestNeighborProvider interfaces moved to src/core/dip/ (close F-arch-2 MAJOR)

#### Objective

Relocate `HalfLifePersister` + `NearestNeighborProvider` interfaces from `src/local/eviction/triadic-scoring-policy.ts` to `src/core/dip/eviction-policy.ts` (next to EvictionPolicy), restoring DIP-correct dependency direction.

#### Evidence

F-arch-2: both interfaces declared in their primary consumer's file (line 81 of triadic-scoring-policy.ts), violating DIP (concrete depends on abstraction, but abstraction LIVES with concrete).

#### Files to edit

```
src/core/dip/eviction-policy.ts — UPDATE: add HalfLifePersister + NearestNeighborProvider interface exports
src/local/eviction/triadic-scoring-policy.ts — UPDATE: import interfaces from ../../core/dip/eviction-policy.js
src/local/eviction/pg-half-life-persister.ts — UPDATE: import HalfLifePersister from ../../core/dip/eviction-policy.js
src/local/eviction/pg-nearest-neighbor-provider.ts — UPDATE: same
src/core/index.ts — UPDATE: re-export the 2 new interfaces
src/core/__tests__/dip-eviction-policy.test.ts — UPDATE: assert HalfLifePersister + NearestNeighborProvider exported from core dip module
```

#### TDD

```
RED:      test_HalfLifePersister_exported_from_core_dip
RED:      test_NearestNeighborProvider_exported_from_core_dip
GREEN:    Move interfaces; update imports
REFACTOR: None expected
VERIFY:   npm test -- src/core/__tests__/dip-eviction-policy.test.ts
```

#### Acceptance Criteria

- [ ] 2 RED tests GREEN
- [ ] 0 type errors after interface relocation (Drizzle/types still resolve)
- [ ] `grep "import.*HalfLifePersister" src/` shows imports from `../../core/dip/eviction-policy.js`, not from `./triadic-scoring-policy.js`

#### DoD

- [ ] All tests green
- [ ] Boundary check hook clean

---

## Phase T6: DRY scope-candidate.ts extraction

### T6.1 — Extract shared scope-candidate.ts (close F-arch-3 MAJOR + F4 followup)

#### Objective

Extract `ScopeCandidateRow` + `rowToMemoryItem` + candidate-fetch SQL into `src/local/eviction/scope-candidate.ts`; T5.1 + T5.2 + (now also potential T7.1 forget refactor) all import from it.

#### Evidence

F-arch-3: ~60 LoC duplicated in capacity-based-trigger.ts (lines 47-86) + time-based-trigger.ts. Rule of 3 hit when forget() delegates (T7.1).

#### Files to edit

```
src/local/eviction/scope-candidate.ts — NEW: exports ScopeCandidateRow + rowToMemoryItem + loadCandidates(client, scope)
src/local/eviction/capacity-based-trigger.ts — UPDATE: import from ./scope-candidate
src/local/eviction/time-based-trigger.ts — UPDATE: same
src/local/eviction/__tests__/scope-candidate.test.ts — NEW RED: per-tier loadCandidates returns correct rows
```

#### TDD

```
RED:      test_loadCandidates_user_tier
RED:      test_loadCandidates_session_tier
RED:      test_loadCandidates_agent_tier
RED:      test_loadCandidates_excludes_invalidated
GREEN:    Extract helper + migrate 2 trigger files
REFACTOR: None
VERIFY:   npm run test:integration -- tests/integration/eviction
```

#### Acceptance Criteria

- [ ] 4 RED tests GREEN
- [ ] capacity-based-trigger.ts + time-based-trigger.ts each lose ~60 LoC
- [ ] Pass: size / complexity

#### DoD

- [ ] All tests green

---

## Phase T7: forget() + multiplier tier coverage

### T7.1 — LocalScopedMemory.forget() delegates to PgEvictor (close F-dom-3 + F-wire-1 MAJOR)

#### Objective

Refactor `LocalScopedMemory.forget(id)` at `src/local/index.ts:430` to issue soft-delete (t_invalid=NOW()) via PgEvictor instead of hard DELETE via vectorStore.delete(). Makes caller-driven and trigger-driven forget consistent per ADR D17 § Consequences.

#### Files to edit

```
src/local/index.ts — UPDATE: forget() delegates to PgEvictor.evict([memoryId])
src/local/__tests__/forget-soft-delete.test.ts — NEW RED: post-forget(), row exists with t_invalid set + recall() excludes it
```

#### TDD

```
RED:      test_forget_soft_deletes_via_t_invalid
RED:      test_forget_idempotent_for_already_evicted_row
RED:      test_forget_leaves_row_with_t_invalid_set_raw_select_returns_one (EC-3) — public-API BREAKING-change contract test: raw SELECT post-forget returns 1 row with t_invalid IS NOT NULL (NOT 0 rows as v0.1 contract)
GREEN:    Delegate to PgEvictor
REFACTOR: None
VERIFY:   npm run test:integration -- tests/integration/forgetting
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] **EC-3 absorption (v1.1):** CHANGELOG.md `[Unreleased]` § Changed entry uses `**BREAKING**:` prefix: "**BREAKING**: Memory.forget(id) now soft-deletes via t_invalid (consistent with auto-eviction); raw SELECT post-forget returns the row with t_invalid set (v0.1 returned 0 rows). Consumer assertions of `count == 0 after forget()` must migrate to `count_where_t_invalid_null == 0`. Historical rows recoverable via WHERE t_invalid IS NOT NULL."
- [ ] **EC-3 absorption (v1.1):** Memory.forget() JSDoc updated with explicit v0.1 → v0.4b behavior contrast block
- [ ] ADR D7 (this plan) explicitly declares the BREAKING contract change

#### DoD

- [ ] All tests green
- [ ] ADR D17 § Consequences in plan v0-4b updated (post-merge)

### T7.2 — Long-tail multiplier honors User/Session via scope-key resolution (close F-dom-5 MAJOR)

#### Objective

Extend `getNeighborScopeId` to return user_id / session_id for User/Session scopes (currently returns null → multiplier short-circuits to 1.0). After T3.1's tier-aware NN provider, the multiplier fires for ALL 3 tiers.

#### Files to edit

```
src/local/eviction/triadic-scoring-policy.ts — UPDATE: getNeighborScopeId returns column value per scope.kind
tests/integration/eviction/multiplier-tier-coverage.test.ts — NEW RED: rare-isolated User-scope memory survives eviction
```

#### TDD

```
RED:      test_multiplier_fires_for_user_scope_rare_isolated
RED:      test_multiplier_fires_for_session_scope_rare_isolated
GREEN:    Extend getNeighborScopeId
VERIFY:   npm run test:integration -- tests/integration/eviction/multiplier-tier-coverage.test.ts
```

#### Acceptance Criteria

- [ ] 2 RED tests GREEN
- [ ] CLAUDE.md framing unchanged ("OPEN PROBLEM #1 — no competitor solved this") because all 3 tiers now genuinely covered

#### DoD

- [ ] All tests green

---

## Phase T8: EvictionPolicy interface ADR D12 alignment

### T8.1 — Reconcile shipped EvictionPolicy interface with ADR D12 (close F-xval-1 MAJOR)

#### Objective

The shipped interface (`kind`, `score`, `selectVictims`, `onEvictionStart?`, `onEvictionEnd?`) diverges from ADR D12 declared shape (`shouldEvict`, `selectVictims`, `evict`, `scoreMemory`). Resolution: update ADR D12 in the original v0-4b plan post-merge to declare the shipped shape AS the canonical shape; ADD an explicit note in T1.1's commit body chain that the shape evolved during implementation per the 4-method-entries decision.

#### Files to edit

```
.claude/knowledge-base/plans/completed/v0-4b-forgetting-pipeline-plan.md — POST-MERGE: ADR D12 amended to declare shipped shape
src/core/dip/eviction-policy.ts — VERIFY: interface matches the canonical shape
src/core/__tests__/dip-eviction-policy.test.ts — VERIFY: shape lock tests cover all 5 method entries (kind + 2 required + 2 optional)
```

#### TDD

```
RED:      test_eviction_policy_shape_has_kind_score_selectVictims_lifecycle_hooks (verify already passes)
GREEN:    None — already shipped
REFACTOR: Move ADR amendment to plans/completed/ archive AFTER merge
VERIFY:   npm test
```

#### Acceptance Criteria

- [ ] T1.1 of original v0-4b plan body (in plans/completed/) amended post-merge with note
- [ ] No source code change

#### DoD

- [ ] PR description carries the ADR D12 amendment text

---

## Phase T9: pgvector schema cleanup

### T9.1 — NN query refactor + index columns (close F-dom-pg-1 + F-dom-pg-2 MAJOR)

#### Objective

Refactor `pg-nearest-neighbor-provider.ts` to: (a) fetch self embedding in a separate roundtrip into a literal parameter (HNSW-friendly query shape); (b) verify HNSW index usage via EXPLAIN ANALYZE in a populated scope (T7.1's GOAL TEST scope).

Re-evaluate `idx_memories_eviction_score` keying: T3.1 added per-tier indexes; remove the dead `last_accessed_at` column if no eviction query uses ORDER BY on it.

#### Files to edit

```
src/local/eviction/pg-nearest-neighbor-provider.ts — UPDATE: 2-roundtrip pattern (self.embedding → :query, then NN search)
tests/integration/eviction/nearest-neighbor.test.ts — UPDATE: add EXPLAIN ANALYZE assertion against populated scope verifying Index Scan node
src/local/migrations/0006_drop_dead_index_columns.sql — NEW: ALTER INDEX or DROP+CREATE to remove dead last_accessed_at column if not used
src/local/schema.ts — UPDATE: index() declaration aligned
```

#### TDD

```
RED:      test_nn_query_uses_hnsw_index — EXPLAIN ANALYZE shows Index Scan, not Seq Scan
RED:      test_eviction_index_keys_only_used_columns
RED:      test_triadic_eviction_goal_test_runtime_under_30s_with_2roundtrip_nn (v1.1 EC-7) — re-run T7.1 GOAL TEST after 2-roundtrip refactor; assert wall-clock ≤ 30s (current 22s baseline; refactor may push over budget; if so, plan needs ADR row deferring HNSW-friendly refactor to v0.5 OR tuning the cache)
GREEN:    2-roundtrip refactor + migration 0006
REFACTOR: None
VERIFY:   npm run test:integration -- tests/integration/eviction/nearest-neighbor.test.ts
```

#### Acceptance Criteria

- [ ] 2 RED tests GREEN
- [ ] Migration 0006 applies cleanly + journal-sync test green

#### DoD

- [ ] All tests green

### T9.2 — Document trigger race window + integration test (close F-dom-pg-4 MAJOR)

#### Objective

Document the 0004 trigger READ COMMITTED race window inline + add an integration test that reproduces it under controlled concurrency.

#### Files to edit

```
src/local/migrations/0004_eviction_half_life_trigger.sql — UPDATE: comment block describing race window
tests/integration/eviction/trigger-race-window.test.ts — NEW RED: concurrent UPDATE llm_importance_score + concurrent SELECT half_life_seconds; assert eventual consistency
```

#### TDD

```
RED:      test_concurrent_importance_update_eventually_resets_half_life
GREEN:    None — invariant should already hold per BEFORE UPDATE trigger semantics; test documents bounded race window
VERIFY:   npm run test:integration -- tests/integration/eviction/trigger-race-window.test.ts
```

**v1.1 EC-11 absorption (test scope):** assert eventual consistency via `Promise.all([UPDATE importance, SELECT half_life_seconds])` then re-SELECT — NOT race-trigger reproduction (vitest lacks reliable worker_threads orchestration for that). The race window is BOUNDED by BEFORE-UPDATE-OF tx-commit semantics; eventual-consistency test is sufficient. Reliable race-trigger reproduction deferred to v0.4b.2 if needed.

#### Acceptance Criteria

- [ ] RED test GREEN
- [ ] Migration 0004 SQL comment documents the race window
- [ ] v1.1 EC-11 scoping rationale captured in test JSDoc

#### DoD

- [ ] Test green

---

## Phase T10: OTel meter lazy init

### T10.1 — Move OTel meter to per-instance / lazy-init (close F-dom-6 MAJOR)

#### Objective

Move `metrics.getMeter('@usetheo/memory')` + counter acquisition from module-load (line 47-48 of pg-evictor.ts) to per-instance / first-call lazy init, so consumers wiring their MeterProvider AFTER importing @usetheo/memory still see emissions.

#### Files to edit

```
src/local/eviction/pg-evictor.ts — UPDATE: lazy meter resolution inside evict()
src/local/__tests__/pg-evictor-meter-init.test.ts — NEW RED: import order test — consumer registers MeterProvider AFTER import, counter still emits
src/local/telemetry.ts — NEW (optional): module the plan EC-4 originally promised; route both Tracer + Meter through here
```

#### TDD

```
RED:      test_meter_resolves_after_consumer_provider_registration
GREEN:    Lazy meter via getOrInit pattern
REFACTOR: Consider src/local/telemetry.ts as plan EC-4 cited
VERIFY:   npm test -- src/local/__tests__/pg-evictor-meter-init.test.ts
```

#### Acceptance Criteria

- [ ] RED test GREEN
- [ ] CHANGELOG.md `[Unreleased]` § Fixed: "OTel meter for forgetting eviction counter now lazy-resolved (no longer module-load-time)"

#### DoD

- [ ] Test green

---

## Phase T11: Idempotency + runbook + test polish

### T11.1a — Publish v0.4b rollback runbook (doc-only; close F-dom-db-4 MAJOR; v1.1 EC-4 absorption — runbook ships FIRST)

#### Objective

Publish `docs/runbook-v0-4b-rollback.md` BEFORE any idempotency-model change so on-call has the recovery path in hand when the next task (T11.1b) lands.

#### Files to edit

```
docs/runbook-v0-4b-rollback.md — NEW: manual SQL to drop 0003 + 0004 artifacts + journal-entry removal procedure + cross-version partial-state recovery instructions
```

#### Acceptance Criteria

- [ ] docs/runbook-v0-4b-rollback.md exists with sections: (1) drop 0004 trigger + function, (2) drop 0003 columns + index, (3) journal-entry removal, (4) cross-version partial-state recovery (for users who applied 0003 manually via the F-dom-db-1 workaround between v0.4b shipping and v0.4b-fixes shipping)
- [ ] CHANGELOG.md `[Unreleased]` § Documentation: "v0.4b rollback runbook published at docs/runbook-v0-4b-rollback.md"

#### DoD

- [ ] Runbook reviewed manually for SQL correctness against a throwaway DB

### T11.1b — Migration idempotency-test + cross-version repair script (close F-dom-db-3 MAJOR; v1.1 EC-4 absorption — REVISED)

#### Objective

Add an integration test asserting `runMigrations()` is idempotent across two calls. Add a one-time repair script `npm run db:repair-v0-4b-partial-state` that detects partial state (e.g., columns present but journal entries missing) and either repairs the journal automatically or aborts with the runbook URL.

**EC-4 reversal:** plan v1.0 recommended STRIPPING `IF NOT EXISTS` from 0003 to "trust journal" — but users who applied 0003 manually via `psql -f` between v0.4b shipping and v0.4b-fixes shipping will see `column already exists` crashes on the next `runMigrations()` if the guards are removed. KEEP `IF NOT EXISTS` on 0003 column adds as a DEFENSIVE guard for the bugfix-window state. v0.5 can revisit once the cross-version state is empirically rare.

#### Files to edit

```
src/local/migrations/0003_eviction_columns.sql — UNCHANGED on IF NOT EXISTS guards (v1.1 EC-4 reversal: defensive guards STAY)
src/local/migrations/0004_eviction_half_life_trigger.sql — UNCHANGED (CREATE OR REPLACE TRIGGER is dialect-correct PG 14+)
scripts/db-repair-v0-4b-partial-state.ts — NEW: detect partial state + repair journal OR abort
package.json — UPDATE: add db:repair-v0-4b-partial-state npm script wiring to tsx scripts/db-repair-v0-4b-partial-state.ts
tests/integration/migrations/idempotency.test.ts — NEW RED: runMigrations() called twice is a no-op
tests/integration/migrations/repair-partial-state.test.ts — NEW RED: simulate partial state (columns present, journal missing entries 3+4) + run repair script + assert journal restored + subsequent runMigrations is no-op
```

#### TDD

```
RED:      test_runMigrations_idempotent_across_two_calls
RED:      test_repair_script_detects_partial_state_and_restores_journal (EC-4)
RED:      test_repair_script_aborts_on_unrecognized_state_with_runbook_url (EC-4)
GREEN:    Implement repair script + idempotency test
REFACTOR: None
VERIFY:   npm run test:integration -- tests/integration/migrations/idempotency.test.ts tests/integration/migrations/repair-partial-state.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] `npm run db:repair-v0-4b-partial-state` available + documented in runbook
- [ ] CHANGELOG.md `[Unreleased]` § Added: "db:repair-v0-4b-partial-state npm script for cross-version journal recovery"

#### DoD

- [ ] All tests green
- [ ] Idempotency model decision documented in architecture.md § 10 (or new § 11)

### T11.2 — Deterministic rare-target hashes + Fisher-Yates random (close F-tests-1 + F-tests-2 MAJOR)

#### Objective

Replace Math.random() in 11 test-fixture hash-column sites with deterministic hash(text + seed). Replace `Array.sort(()=>Math.random()-0.5)` in docs/forgetting-evaluation/run.ts with Fisher-Yates shuffle.

#### Files to edit

```
tests/integration/forgetting/fixtures/rare-target-seed.ts — UPDATE: deterministic hash via crypto.subtle or simple seed counter
docs/forgetting-evaluation/run.ts — UPDATE: Fisher-Yates shuffle; random baseline produces tight ~0.70 variance
tests/integration/eviction/*.test.ts (~10 files) — UPDATE: deterministic seed counter for hash column
```

#### TDD

```
RED:      test_rare_target_seed_produces_byte_for_byte_same_hashes_across_runs
RED:      test_eval_random_baseline_recall_at_10_within_0_60_to_0_80 — Fisher-Yates produces tight distribution
RED:      test_random_baseline_two_runs_same_seed_produce_identical_recall_at_10 (v1.1 EC-8) — same seed → byte-identical recall@10 value (regression catcher for any future shuffle-impl swap)
GREEN:    Replace Math.random() sites
REFACTOR: Extract makeDeterministicHash(text, salt) helper
VERIFY:   npm run test:integration -- tests/integration/forgetting/fixtures && THEOMEM_PG_URI=... npm run eval:forgetting
```

#### Acceptance Criteria

- [ ] 2 RED tests GREEN
- [ ] docs/forgetting-evaluation.md matrix re-captured + caveats § updated to remove the Math.random()-0.5 disclaimer

#### DoD

- [ ] All tests green

---

## Phase T12: MINOR cluster + cleanup

### T12.1 — F-arch-6 (console.warn), F-xval-2 (dead lifecycle hooks), F-dom-db-5 (trailing newline), F-dom-pg-5 (advisory-lock keyspace doc), F-dom-pg-6 (xmin/ctid)

#### Objective

Cherry-pick the 5 cheapest MINOR fixes (≤20 LoC each).

#### Files to edit

```
src/local/eviction/time-based-trigger.ts — UPDATE: console.warn → structured logger DIP (defer if logger doesn't exist; comment with @todo)
src/core/dip/eviction-policy.ts — UPDATE: invoke onEvictionStart / onEvictionEnd from CapacityBasedTrigger + TimeBasedTrigger
src/local/migrations/0003_eviction_columns.sql — UPDATE: add trailing newline
src/local/eviction/capacity-based-trigger.ts — UPDATE: JSDoc on advisory-lock keyspace 32-bit collision risk + documented bounded blast radius
tests/integration/eviction/lazy-half-life.test.ts — UPDATE: replace xmin/ctid pattern with `xact_id` or COUNT(*) FILTER
```

#### TDD

```
RED:      test_onEvictionStart_invoked_by_capacity_trigger
RED:      test_onEvictionEnd_invoked_with_result
GREEN:    Wire lifecycle hooks; misc cleanups
VERIFY:   npm test && npm run test:integration
```

#### Acceptance Criteria

- [ ] 2 RED tests GREEN
- [ ] 5 MINOR findings closed via commit body citation

#### DoD

- [ ] All tests green

---

## Phase T13: Final validation (MANDATORY) — RE-RUN /review

### T13.1 — Re-run /review v0-4b-forgetting-pipeline (the GATE per ADR D2)

#### Objective

Invoke `/review v0-4b-forgetting-pipeline` and confirm the consolidated report returns `{ BLOCKER: 0, CRITICAL: 0 }`.

#### Tasks

1. Verify branch state clean.
2. Run `python3 .claude/skills/implement/scripts/run_validation.py v0-4b-forgetting-pipeline` — overall_status must be PASS or PARTIAL (with SKIPs documented).
3. Run `/review v0-4b-forgetting-pipeline` — wait for the 7 agents to consolidate.
4. Read the new report at `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-{rerun-date}.md`.
5. Assert verdict == READY_TO_MERGE; BLOCKER == 0; CRITICAL == 0.

#### Acceptance Criteria

- [ ] New `/review` verdict is READY_TO_MERGE
- [ ] BLOCKER count: 0
- [ ] CRITICAL count: 0
- [ ] MAJOR count: ≤ 3 (acceptable WITH_CAVEATS for v0.4b.1 follow-up)
- [ ] If any NEW BLOCKER/CRITICAL surfaces, draft v0-4b-fixes-cycle-plan v1.2 and re-loop (v1.1 EC-10 absorption — ADR D2 already covers; this acceptance row makes the trigger explicit at T13.1)

#### DoD

- [ ] Review report committed
- [ ] PR description references the review report
- [ ] Plan archive: move `v0-4b-fixes-cycle-plan.md` to `plans/completed/` AFTER PR merges to main (per `cycle-implement.md § Global DoD`)

---

## Coverage Matrix

| # | Finding ID (severity) | Task | Resolution |
|---|---|---|---|
| 1 | F-dom-db-1 (BLOCKER) | T0.1 | npm run db:generate + commit snapshots |
| 2 | F-arch-1 (CRITICAL) | T1.1 | Options-object constructor overload |
| 3 | F-dom-db-2 (CRITICAL) | T2.1 | db:push wraps trigger psql apply |
| 4 | F-dom-1 (CRITICAL) | T3.1 | Triggers accept Scope union |
| 5 | F-dom-pg-3 (CRITICAL) | T3.1 | Same — cross-confirmed |
| 6 | F-dom-2 (CRITICAL) | T4.1 | Public API barrel + createLocalMemory wiring |
| 7 | F-arch-2 (MAJOR) | T5.1 | DIP interfaces moved to src/core/dip/ |
| 8 | F-arch-3 (MAJOR) | T6.1 | scope-candidate.ts extracted |
| 9 | F-arch-4 (MAJOR) | T3.1 | Triggers accept Scope union (same as F-dom-1) |
| 10 | F-arch-5 (MAJOR) | T4.1 | Public API barrel (same as F-dom-2) |
| 11 | F-xval-1 (MAJOR) | T8.1 | ADR D12 amended to declared shape |
| 12 | F-xval-3 (MAJOR) | T4.1 | Same as F-dom-2 |
| 13 | F-dom-3 (MAJOR) | T7.1 | forget() delegates to PgEvictor |
| 14 | F-dom-4 (MAJOR) | T3.1 | Per-tier partial indexes ship in 0005 |
| 15 | F-dom-5 (MAJOR) | T7.2 | Multiplier honors User/Session via getNeighborScopeId |
| 16 | F-dom-6 (MAJOR) | T10.1 | OTel meter lazy init |
| 17 | F-dom-pg-1 (MAJOR) | T9.1 | Index column cleanup + per-tier indexes (T3.1 cross) |
| 18 | F-dom-pg-2 (MAJOR) | T9.1 | NN query 2-roundtrip + EXPLAIN ANALYZE assertion |
| 19 | F-dom-pg-4 (MAJOR) | T9.2 | Trigger race-window inline doc + integration test |
| 20 | F-dom-db-3 (MAJOR) | T11.1b | **v1.1 EC-4 REVERSAL:** KEEP `IF NOT EXISTS` on 0003.sql; add idempotency-test + db:repair-v0-4b-partial-state script for cross-version recovery |
| 21 | F-dom-db-4 (MAJOR) | T11.1a | Rollback runbook published FIRST (separate doc-only commit) |
| 22 | F-tests-1 (MAJOR) | T11.2 | Deterministic hash + seed counter |
| 23 | F-tests-2 (MAJOR) | T11.2 | Fisher-Yates shuffle in eval runner |
| 24 | F-wire-1 (MAJOR) | T7.1 | Same as F-dom-3 |
| 25 | F-wire-2 (MAJOR) | T4.1 | Same as F-dom-2 |
| 26 | F-arch-6 (MINOR) | T12.1 | console.warn → logger DIP (or @todo) |
| 27 | F-xval-2 (MINOR) | T12.1 | onEvictionStart/End wired into triggers |
| 28 | F-dom-db-5 (MINOR) | T12.1 | Trailing newline on 0003.sql |
| 29 | F-dom-pg-5 (MINOR) | T12.1 | JSDoc on advisory-lock 32-bit keyspace |
| 30 | F-dom-pg-6 (MINOR) | T12.1 | Replace xmin/ctid in lazy-half-life test |
| 31 | F-wire-4 (MINOR) | T1.1 (incidental) | Options-object refactor surfaces evictor=null trap |
| 32 | F-arch-7, F-tests-3..6, F-dom-7..9, F-dom-pg variants, F-xval-4 (MINOR + INFO) | (acceptance via T13.1 re-run) | Logged as v0-4b-fixes-cycle followups; verify don't elevate post-fix |
| 33 | INFO findings (F-arch-8..12, F-wire-3,5..8, F-xval-5..12, F-dom-10..12, F-dom-pg-7,8, F-tests-7..10, F-dom-db-6..8) | None | INFO — no action |

**Coverage: 32/40 actionable findings mapped to 18 tasks (v1.1: T11.1 split into T11.1a + T11.1b per EC-4) + 8 INFO accepted = 40/40 (100%).** Edge-case absorption v1.1: 11 EC items (4 MUST FIX + 4 SHOULD TEST + 3 DOCUMENT) inlined into existing task sections; see commit body of v1.0→v1.1 patch for verbatim absorption chain.

## Global Definition of Done

- [ ] All 17 tasks (T0.1 → T13.1) completed and validated
- [ ] All tests passing — `npm test` green + `npm run test:integration` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene` — ≤ 500 LoC per file)
- [ ] CHANGELOG.md updated under `[Unreleased]` per Inquebrável Rule 6 (multiple entries: Added, Changed, Fixed, Deprecated)
- [ ] Backward compatibility preserved across public API (deprecated positional constructor still works)
- [ ] **Re-run /review verdict** — `/review v0-4b-forgetting-pipeline` returns `{ BLOCKER: 0, CRITICAL: 0 }` per ADR D2 (the canonical metric)
- [ ] **Plan archived** — AFTER PR merges to main, move `.claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md` to `.claude/knowledge-base/plans/completed/v0-4b-fixes-cycle-plan.md`. Original v0-4b plan stays in `plans/completed/` (already there post-original-merge); cross-references stay valid.

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all 16 implementation phases are complete. The plan is NOT done until T13.1 confirms a fresh `/review` verdict ≥ READY_TO_MERGE.

### Execution

```
npm test                                          # contract suite green
npm run test:integration                          # all integration tests green (incl. new T0.1-T11.2 tests)
npm run typecheck                                 # zero TS errors
npm run lint                                      # zero lint warnings
python3 .claude/skills/implement/scripts/run_validation.py v0-4b-forgetting-pipeline  # full validation chain
/review v0-4b-forgetting-pipeline                 # the canonical gate
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] Re-run /review verdict: READY_TO_MERGE
- [ ] BLOCKER count: 0
- [ ] CRITICAL count: 0
- [ ] MAJOR count: ≤ 3 (acceptable WITH_CAVEATS)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing F-tests-* or F-dom-pg-* edge cases
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the full validation chain to confirm fixes
4. NEW BLOCKER/CRITICAL → draft v0-4b-fixes-cycle-plan v1.1 and re-loop; do NOT merge

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| @opentelemetry/api | ^1.9.0 | npm | T10.1 lazy meter init |
| @opentelemetry/sdk-trace-base | ^2.0.0 | npm | T10.1 (transitive) |
| pg | ^8.13.0 | npm | All Pg-based fixes |
| drizzle-orm | ^0.45.0 | npm | T0.1 journal sync |
| croner | ^10.0.1 | npm | T3.1 TimeBasedTrigger (REUSED) |
| zod | ^3.25.0 | npm | createLocalMemory config validation |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | — | — | — | All fixes use existing deps |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Goal recap (machine-readable)

```
verb: enable
metric: /review v0-4b-forgetting-pipeline verdict transition NEEDS_FIXES → READY_TO_MERGE
gate_artifact: .claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-{rerun-date}.md
absolute_thresholds:
  - blocker_count: 0
  - critical_count: 0
  - major_count_acceptable_ceiling: 3
deliverable_count: 18 atomic commits on develop (v1.1: T11.1 split into T11.1a + T11.1b)
inspired_by: v0.6.1 voyager-skill-library-fixes-v0-6-1 (commit b6aead6, 23 findings in 14 commits)
```
