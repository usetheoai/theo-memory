# Followups — v0-4b-fixes-cycle (scope-creep avoided during implementation)

Tracking items observed during the halt-loop but DEFERRED to avoid scope creep per
`cycle-implement.md § Anti-pattern #7`. Add new entries below; archive when the
entry ships in its own follow-up plan or post-merge plan-archival step.

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
