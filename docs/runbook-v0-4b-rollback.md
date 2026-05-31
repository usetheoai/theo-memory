# Runbook — Roll back v0.4b eviction schema

> **Audience:** on-call operator running TheMemory at scale who needs to revert the v0.4b forgetting-pipeline schema additions (migrations `0003_eviction_columns.sql` + `0004_eviction_half_life_trigger.sql` + the v0.4b-fixes `0005_eviction_partial_indexes.sql` + `0006_drop_dead_index_columns.sql`).
>
> **Scope:** local Postgres + pgvector runtime (the `@usetheo/memory` v0.4b shipped surface). Cloud-managed runtime (v0.5+) is out of scope here.
>
> **When to use:** rollback only when a production incident specifically traces to v0.4b eviction artifacts. The default response to v0.4b defects is `npm run db:repair-v0-4b-partial-state` (T11.1b), NOT a full rollback.

## TL;DR

1. **Stop** any process invoking `runMigrations(pool)` or calling `Memory.forget` / `CapacityBasedTrigger` / `TimeBasedTrigger`.
2. **Run the SQL block** in § 1 (single transaction).
3. **Run the journal cleanup** in § 2.
4. **Verify** via § 3.
5. If the rollback was triggered by a **cross-version partial-state** scenario (consumers applied `0003` manually via `psql -f` between v0.4b shipping and v0.4b-fixes shipping), follow § 4 BEFORE re-applying any migrations.

## § 1 — Drop the v0.4b eviction schema artifacts (atomic SQL block)

Run as a single transaction so the schema either fully rolls back or stays intact.

```sql
BEGIN;

-- v0.4b-fixes T9.1 / migration 0006: dead-index-column cleanup.
-- Eviction partial indexes were re-keyed without the dead `last_accessed_at`
-- column. Dropping them BEFORE the column-add migration (0003) so the
-- DROP COLUMN below does not have to cascade.
DROP INDEX IF EXISTS idx_memories_eviction_score;
DROP INDEX IF EXISTS idx_memories_eviction_score_user;
DROP INDEX IF EXISTS idx_memories_eviction_score_session;

-- v0.4b T2.2 / migration 0004: BEFORE UPDATE OF llm_importance_score trigger
-- + the function it executes. CREATE OR REPLACE semantics mean DROP TRIGGER
-- + DROP FUNCTION are the canonical reversal.
DROP TRIGGER IF EXISTS memories_reset_half_life_on_importance_update_trg ON memories;
DROP FUNCTION IF EXISTS memories_reset_half_life_on_importance_update();

-- v0.4b T0.1 / migration 0003: eviction column adds. The IF EXISTS guards
-- defend the cross-version recovery path (§ 4).
ALTER TABLE memories DROP COLUMN IF EXISTS last_accessed_at;
ALTER TABLE memories DROP COLUMN IF EXISTS access_count;
ALTER TABLE memories DROP COLUMN IF EXISTS half_life_seconds;

COMMIT;
```

**Expected output:** `BEGIN`, 3 × `DROP INDEX`, `DROP TRIGGER`, `DROP FUNCTION`, 3 × `ALTER TABLE`, `COMMIT`. Any error MUST roll the transaction back automatically; do NOT proceed to § 2 if § 1 errored.

## § 2 — Journal-entry removal

Drizzle's `runMigrations(pool)` reads the journal to decide what to apply. After § 1 the schema no longer reflects the v0.4b column/trigger/index state, so the journal entries for `0003`, `0004`, `0005`, and `0006` must be removed in lock-step or the next `runMigrations()` will fail with `relation already exists` once you re-attempt forward migration.

The journal lives in the `drizzle.__drizzle_migrations` table (NOT the on-disk `_journal.json` — that file is a build artifact). Remove the post-0002 entries:

```sql
DELETE FROM drizzle.__drizzle_migrations
 WHERE hash IN (
   -- Match by tag prefix; the hash column is the file-content hash but the
   -- `created_at` ordering is monotonic, so the equivalent shape is:
   SELECT hash FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 4
 );
```

**Verify** after the DELETE:

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;
-- Expect 3 (one row per migration 0000, 0001, 0002).
```

If the count is anything other than 3, STOP and escalate — the journal state has drifted from what this runbook anticipates and forward migration may not succeed.

## § 3 — Verify the rollback landed

```sql
-- Columns absent:
SELECT column_name
  FROM information_schema.columns
 WHERE table_name='memories'
   AND column_name IN ('last_accessed_at','access_count','half_life_seconds');
-- Expect 0 rows.

-- Trigger absent:
SELECT trigger_name
  FROM information_schema.triggers
 WHERE event_object_table='memories'
   AND trigger_name='memories_reset_half_life_on_importance_update_trg';
-- Expect 0 rows.

-- Indexes absent:
SELECT indexname
  FROM pg_indexes
 WHERE tablename='memories'
   AND indexname LIKE 'idx_memories_eviction_score%';
-- Expect 0 rows.

-- Function absent:
SELECT proname
  FROM pg_proc
 WHERE proname='memories_reset_half_life_on_importance_update';
-- Expect 0 rows.
```

All four queries returning 0 rows is the empirical confirmation that the v0.4b schema is fully reverted.

## § 4 — Cross-version partial-state recovery (EC-4 reversal absorption)

**When this applies:** if your environment ran `psql -f src/local/migrations/0003_eviction_columns.sql` (or hand-applied the trigger/indexes via psql) between v0.4b shipping (date X) and v0.4b-fixes shipping (2026-05-31), the on-disk schema state may not match the Drizzle journal. Symptoms:

- `runMigrations(pool)` errors with `column already exists` on next attempt.
- The schema has v0.4b columns/trigger/indexes BUT `drizzle.__drizzle_migrations` has only entries up to `0002`.

This is the exact scenario plan v1.1 EC-4 reversal anticipated when it KEPT the `IF NOT EXISTS` guards on `0003_eviction_columns.sql` and shipped the `db:repair-v0-4b-partial-state` script (T11.1b — see follow-up commit). The recommended order:

1. **PREFER:** run `npm run db:repair-v0-4b-partial-state` (T11.1b). The script detects the partial state and either repairs the journal automatically OR aborts with a pointer back to this runbook. The repair path is non-destructive.
2. **ONLY if `db:repair` aborts and you need to roll back:** apply § 1 + § 2 above. The `DROP ... IF EXISTS` guards in § 1 are EXACTLY the defense against this partial-state — they make the rollback safe regardless of whether the manual psql apply happened or not.
3. Re-run forward migration via `runMigrations(pool)` against the now-clean DB after rollback. Drizzle's journal-tracked path will re-apply 0003 → 0006 in order.

## Cross-references

- `src/local/migrations/0003_eviction_columns.sql` — column adds (kept `IF NOT EXISTS` guards per EC-4 reversal)
- `src/local/migrations/0004_eviction_half_life_trigger.sql` — BEFORE-UPDATE-OF trigger + function
- `src/local/migrations/0005_eviction_partial_indexes.sql` — per-tier partial indexes (v0.4b-fixes T3.1)
- `src/local/migrations/0006_drop_dead_index_columns.sql` — index re-keying without dead `last_accessed_at` (v0.4b-fixes T9.1)
- `scripts/db-repair-v0-4b-partial-state.ts` — automated cross-version recovery (T11.1b)
- Plan: `.claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md` § T11.1a + T11.1b + ADR D7 (BREAKING change context)
