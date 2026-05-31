# Followups — v0-4b-fixes-cycle (scope-creep avoided during implementation)

Tracking items observed during the halt-loop but DEFERRED to avoid scope creep per
`cycle-implement.md § Anti-pattern #7`. Add new entries below; archive when the
entry ships in its own follow-up plan or post-merge plan-archival step.

## F-T4.1-1 — `src/local/index.ts` 727 LoC breaches 500 budget (surfaced at iter 5 / T4.1)

After T4.1 wired `createLocalMemory({ eviction })` + the factory return widening
+ post-remember hook + `EvictionNotSupported` error, `src/local/index.ts` grew
from ~590 to 727 LoC — exceeds `architecture.md § 7` ≤500 LoC budget. The cap
was already breached pre-T4.1 (v0.6 added ~90 LoC at line 540-568 for
`memory.skills(repoId)`); T4.1 worsens but did not introduce the violation.

**Recommended owner:** T12.1 MINOR cluster absorption, OR a fast-follow split
commit. Mirror v0.6.1 F3 composition-extraction precedent: extract
`createLocalMemory` + `runMigrations` + `LocalEvictionConfig` factory logic
into a sibling `src/local/factory.ts`, keep `src/local/index.ts` as pure barrel
+ `LocalMemory` / `LocalScopedMemory` classes. Target ≤ 500 LoC parent.

## F-T4.1-EC6-strict — EC-6 test could exercise factory-CAPACITY-via-remember concurrent with manual TIME (surfaced at iter 5 / T4.1)

The shipped EC-6 absorption test
(`tests/integration/forgetting/createLocalMemory-eviction.test.ts` test #4)
exercises factory CONSTRUCTION + manual `new CapacityBasedTrigger(...)` + manual
`new TimeBasedTrigger(...)` firing concurrently — the lock-invariant
(`eviction_${kind}_${scopeKey}`, T3.1) is proven across both paths. A strictly
stronger version would drive the factory's PRIVATE `postRememberHook` via
`memory.agent(...).remember(...)` concurrently with the manual `TimeBasedTrigger
.tickNow()` — same lock, exercised through the natural opt-in surface.

**Recommended owner:** T12.1 MINOR cluster OR optional hardening pass before
T13.1 GATE. The lock invariant holds in both formulations; this is a strictness
delta, not a correctness gap.

## F3 — `drizzle-kit push` requires TTY (surfaced at iter 3 / T2.1)

Empirical observation during T2.1 GREEN: `npm run db:push` invokes
`drizzle-kit push` which on drizzle-kit 0.31.x renders an interactive
prompt requiring `process.stdin.isTTY === true` even when the `--force`
flag is passed. In non-interactive environments (CI, piped shells, the
`Bash` tool invocations used by this halt-loop), drizzle-kit errors with
`Interactive prompts require a TTY terminal`. The trigger-apply tail step
(`node scripts/apply-trigger-migrations.mjs`) runs cleanly non-interactively,
but the upstream drizzle-kit failure prevents schema provisioning so the
trigger has no `memories` table to attach to.

This is a pre-existing constraint of drizzle-kit 0.31 + the v0.1 `db:push`
script shape, NOT introduced by T2.1. Workaround during testing: provision
schema via `runMigrations(pool)` (non-interactive) then run the helper
directly — proven via integration test
`tests/integration/db-push/trigger-applied.test.ts` (3/3 PASS against real
pgvector) + manual smoke documented in T2.1 commit body.

**Recommended owner:** future halt-loop touching the `db:push` script
(likely v0.5 cloud runtime prep). Options:
- Bump drizzle-kit to a version that honors `--force` non-interactively (verify the release notes — drizzle-kit upstream tracks this).
- Replace `drizzle-kit push` in `db:push` with a programmatic
  `migrate()` call so dev + prod converge on the journal-driven path.
- Document the TTY requirement in `### Prerequisites` and let consumers
  run `db:push` from an interactive terminal.

## F2 — architecture.md generated-code exemption clause (surfaced at iter 1 / T0.1)

architecture.md § 7 Module hygiene + the implicit ≤500 LoC file-size budget
do not explicitly carve out an exemption for tooling-generated artifacts
(drizzle-kit snapshot JSON, ast-grep output, protoc-emitted types, etc.).

T0.1 commits `0003_snapshot.json` (562 LoC) + `0004_snapshot.json` (562 LoC),
both drizzle-kit-authored serializations of the Drizzle schema model state.
These are NOT human-maintained code; the budget conceptually applies to
hand-written modules where complexity correlates with file size.

**Recommended owner:** next halt-loop touching architecture.md OR a small
follow-up plan. One-line addendum to § 7:

> File-size budget (≤500 LoC) applies to human-authored source under `src/`
> and `tests/`. Tooling-generated artifacts (Drizzle snapshots, ast-grep
> output, protoc-emitted types, etc.) are exempt — measure complexity at the
> generating tool's schema, not the artifact.

## F1 — ADR D4 amendment opportunity (surfaced at iter 1 / T0.1)

Plan T0.1 § Deep Dives lines 200-202 + ADR D4 ("Generate, don't hand-author")
assume `drizzle-kit generate` produces both a `0003_snapshot.json` AND a
`0004_snapshot.json` incrementally. This is mechanically false for Drizzle ORM
v0.45: triggers are not modeled in `schema.ts` (verified — zero `pgTrigger` /
`pgFunction` declarations in `src/local/schema.ts`), so `drizzle-kit generate`
emits at most ONE migration per run for the column-tracked delta. The 0004
trigger migration has no schema-column delta and cannot be auto-snapshotted.

**Mechanism used in T0.1 (documented in commit body):**

1. `drizzle-kit generate --name=eviction_columns` against clean throwaway DB →
   produces `0003_eviction_columns.sql` (bare DDL) + `0003_snapshot.json` +
   journal entry idx=3.
2. Bare DDL overwritten with the existing committed `IF NOT EXISTS`-guarded
   content (EC-4 REVERSAL preserved — snapshot tracks schema state, not DDL
   details).
3. Identity-copy `0003_snapshot.json` → `0004_snapshot.json` with fresh UUID v7
   for `id` + repaired `prevId = 0003.id`. Snapshot is column-shape-identical
   pre/post trigger because triggers aren't tracked.
4. Manual journal entry idx=4 with tag `0004_eviction_half_life_trigger`.

ADR D4's spirit ("Drizzle is the snapshot author, not humans typing JSON from
scratch") is honored maximally; the identity-copy + pointer-surgery is the
least-divergent path given Drizzle's model gap.

**Recommended owner:** post-merge plan archival step (when moving
`v0-4b-fixes-cycle-plan.md` to `plans/completed/`, append a v1.4 note clarifying
that ADR D4 applies to column/index migrations only; trigger-only migrations
require identity-copy snapshots with manual `id`/`prevId` repair). Single 5-LoC
addendum.

**Cross-references:**

- SEPA iter 1 mid-GREEN adaptation brief — `.claude/knowledge-base/implementations/v0-4b-fixes-cycle/sepa-iterations/iteration-1-mid-green-adaptation.md`
- Plan v1.3 § T0.1 lines 169-240
- Plan v1.3 § ADR D4 line 95
