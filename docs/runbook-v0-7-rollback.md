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

- Plan: `.claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T0.1 + ADR D3`
- Edge cases: `.claude/knowledge-base/reviews/v0-7-distillation-pipeline-edge-cases-2026-06-01.md § EC-3 + EC-9`
- Repair script: `scripts/db-repair-v0-7-partial-state.mjs`
- Precedent: v0.4b-fixes `T11.1a` rollback runbook + `T11.1b` repair script
