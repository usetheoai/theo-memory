-- T0.1 / ADR D3 + EC-3 + EC-9 — v0.7 episodic→semantic distillation
--
-- Adds the new `consolidation_history` audit table backing
-- `Memory.reflect({ conflictResolution: <Policy> })`. EC-3 absorbed:
-- `kept_memory_id` declares ON DELETE SET NULL so GDPR
-- `forget(memId, { hard: true })` (v0.4b T7.1) physical DELETE survives
-- the audit row (regulatory trail preserved; only the FK reference is
-- nullified). EC-9 honesty fix: `memories.derived_from` is ALREADY a
-- JSONB array column shipped at v0.4a (`src/local/pgvector-store.ts:71`);
-- no schema change to `memories` is required.
--
CREATE TABLE IF NOT EXISTS "consolidation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kept_memory_id" uuid,
	"rejected_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"policy_name" text NOT NULL,
	"original_episode_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
-- FK added via ALTER for true idempotency: CREATE TABLE IF NOT EXISTS
-- skips the whole statement when the table exists, dropping any embedded
-- FK clause. Split-step ALTER guarded by NOT EXISTS catalog probe so
-- re-running the migration is a true no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
     WHERE constraint_name = 'consolidation_history_kept_memory_id_fkey'
  ) THEN
    ALTER TABLE "consolidation_history"
      ADD CONSTRAINT "consolidation_history_kept_memory_id_fkey"
      FOREIGN KEY ("kept_memory_id") REFERENCES "memories"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consolidation_history_kept" ON "consolidation_history" USING btree ("kept_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consolidation_history_created" ON "consolidation_history" USING btree ("created_at" DESC);
