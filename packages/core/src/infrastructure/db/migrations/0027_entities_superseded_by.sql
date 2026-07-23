-- M13 (llm-entity-reextraction T2.1, #111) — auditable entity supersede.
-- A re-typed entity SUPERSEDES its mechanism-labeled predecessor: the old row
-- gains a pointer (never DELETE — Princípio 3) and drops out of listings via
-- `superseded_by IS NULL`. Additive + idempotent.
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "superseded_by" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "entities" ADD CONSTRAINT "entities_superseded_by_entities_id_fk"
    FOREIGN KEY ("superseded_by") REFERENCES "public"."entities"("id") ON DELETE SET NULL ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_live_idx" ON "entities" USING btree ("workspace_id") WHERE "superseded_by" IS NULL;
