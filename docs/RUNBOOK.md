# Runbooks — Operational rollback & recovery

Consolidated operational runbooks. Each section is a self-contained recovery procedure.

---

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

---

# Runbook: v0.7 Distillation Pipeline Rollback

**Scope:** rollback of migration `0007_distillation_columns` introduced by plan `v0-7-distillation-pipeline` (T0.1 / ADR D3).

**Forward-only design:** Drizzle migrations are forward-only by convention. This runbook documents the manual rollback path for operations contexts (failed release, data-recovery, GDPR audit).

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> Before running ANY destructive command in this runbook, verify the rationale. Coordinate with the team. Capture a full backup of the database via `pg_dump` first.

## What 0007 introduces

| Artifact | Type |
|---|---|
| `consolidation_history` table | New |
| `idx_consolidation_history_kept` index | New |
| `idx_consolidation_history_created` index | New |
| FK `consolidation_history.kept_memory_id → memories(id) ON DELETE SET NULL` | New |
| `_journal.json` entry idx=7, tag `0007_distillation_columns` | New |

What 0007 does NOT change (EC-9 honesty fix per plan v1.1):

- `memories.derived_from` is ALREADY a JSONB array column (shipped v0.4a per `src/local/pgvector-store.ts:71`). v0.7 only adds the new audit table; no `memories` schema change.

## Rollback procedure (manual; operator-driven)

### Step 1 — Backup

```bash
# Capture full dump first
pg_dump "$THEOMEM_PG_URI" --schema=public --no-owner > backup-pre-v0-7-rollback-$(date +%Y%m%d-%H%M%S).sql
```

### Step 2 — Verify no live consumers

Audit upstream code paths to confirm no live caller is writing to `consolidation_history` (look for `INSERT INTO consolidation_history` AND for the `LlmJudgedMergeConflictPolicy.consolidate()` path in `src/core/conflict-resolution/`). If a consumer is wired up, rolling back the table will break it — first revert the consumer code commit, then proceed.

### Step 3 — Snapshot audit rows (regulatory preservation)

```bash
psql "$THEOMEM_PG_URI" -c "COPY (
  SELECT id, kept_memory_id, rejected_memory_ids, reason, policy_name,
         original_episode_ids, created_at
    FROM consolidation_history
) TO STDOUT WITH (FORMAT csv, HEADER)" > consolidation-history-archive-$(date +%Y%m%d).csv
```

If your compliance regime requires retaining the audit trail beyond table-drop, this CSV is the archive.

### Step 4 — Drop indexes + table

```bash
psql "$THEOMEM_PG_URI" <<SQL
DROP INDEX IF EXISTS idx_consolidation_history_created;
DROP INDEX IF EXISTS idx_consolidation_history_kept;
DROP TABLE IF EXISTS consolidation_history;
SQL
```

### Step 5 — Clean Drizzle journal

Remove the `idx=7` entry from `src/local/migrations/meta/_journal.json`:

```diff
   {
     "idx": 6,
     "version": "7",
     "when": 1780243549731,
     "tag": "0006_drop_dead_index_columns",
     "breakpoints": true
-  },
-  {
-    "idx": 7,
-    "version": "7",
-    "when": 1748808000000,
-    "tag": "0007_distillation_columns",
-    "breakpoints": true
   }
 ]
}
```

Delete the snapshot:

```bash
rm src/local/migrations/meta/0007_snapshot.json
rm src/local/migrations/0007_distillation_columns.sql
```

Commit the revert as a chore (NEVER `--no-verify`; NEVER on `main`):

```bash
git switch develop
git add src/local/migrations/meta/_journal.json
git rm src/local/migrations/meta/0007_snapshot.json src/local/migrations/0007_distillation_columns.sql
git commit -m "revert(db)(v0-7): rollback migration 0007 — consolidation_history table dropped per runbook-v0-7-rollback.md"
```

### Step 6 — Verify

```bash
THEOMEM_PG_URI=... node scripts/db-repair-v0-7-partial-state.mjs
# Expect: STATE: HEALTHY (table absent, journal absent — consistent)
```

## Partial-state recovery

If the rollback is interrupted mid-step (table dropped but journal still claims `idx=7`, or vice versa), run:

```bash
THEOMEM_PG_URI=... node scripts/db-repair-v0-7-partial-state.mjs
```

The script reports the divergence and lists which step to re-run. It does NOT auto-correct.

## GDPR alignment note

The `kept_memory_id ON DELETE SET NULL` FK (EC-3) was designed precisely so `forget(memId, { hard: true })` (v0.4b `T7.1`) does NOT need to be coordinated with this rollback. Hard-delete of a memory referenced as `kept_memory_id` nullifies the FK column but preserves the audit row — regulatory by design. If the rollback drops the entire table, that audit trail is gone; export via Step 3 first.

## Related

- Repair script: `scripts/db-repair-v0-7-partial-state.mjs`
- Precedent: v0.4b-fixes `T11.1a` rollback runbook + `T11.1b` repair script

## Importing Claude Code file-based memory (M12)

```bash
# dry-run (default — writes nothing; prints scanned/would-import/redacted/skipped)
node ~/.claude/hooks/migrate-claude-code.mjs   # kit machines (installer ships the engine)
# commit (endpoint/token resolve from THEOMEM_MIGRATE_* / THEOMEM_MEMORY_* env or ~/.claude/theo-memory.env)
node ~/.claude/hooks/migrate-claude-code.mjs --commit [--source <dir>]   # kit machines
# from a checkout: node dist/agent-tools/cli.js import claude-code --commit
```

Idempotent (re-runs report `deduped`); secrets are scrubbed fail-closed BEFORE any write (the same
deny-list as the kit hooks — byte-parity-guarded). Agent-native flow: the kit skill
`/migrate-theo-memory` orchestrates dry-run → report → confirmation → commit → recall verification.
Back-compat: `node scripts/migrate-claude-code-memory.mjs` still works (re-export shim).
