-- Migration 0016: workspaces tenant boundary + denormalized workspace_id
-- per plan `multi-tenant-workspace-isolation` § T0.2 (ADR D1/D5 + EC-1/3/6/7).
--
-- Non-destructive single->multi-tenant recipe (ADR D5):
--   1. CREATE workspaces.
--   2. SEED the stable-id 'default' workspace (EC-6) with ON CONFLICT DO NOTHING
--      (EC-7 idempotent) -- MUST precede the FK so existing rows backfilled to
--      'default' have a valid parent.
--   3. ADD COLUMN workspace_id text DEFAULT 'default' NOT NULL on every directly-
--      queried table (D-LEAF / EC-1) -- Postgres backfills existing rows to
--      'default' atomically (PG 11+ metadata-only default); no separate backfill
--      UPDATE + no SET NOT NULL race (EC-3).
--   4. ADD the theo_api_keys -> workspaces FK (now valid: 'default' exists).
--   5. CREATE (workspace_id, <scope cols>) indexes for the hot listing paths
--      (R2R denormalized-tenant-column precedent).
--
-- No data is dropped. Re-running is a no-op at the SQL layer
-- (IF NOT EXISTS + ON CONFLICT DO NOTHING). Drizzle generated the baseline
-- (CREATE TABLE + ADD COLUMNs + FK); this file hand-edits the ORDER (seed before
-- FK) + adds the seed + indexes drizzle-kit cannot model. meta/0016_snapshot.json
-- + the journal entry stay in parity (schema.ts declares all of it).

CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "workspaces" ("id", "name") VALUES ('default', 'Default Workspace') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "consolidation_history" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "history" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "recall_cache" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "reflection_counters" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "theo_api_keys" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "theo_api_keys" ADD CONSTRAINT "theo_api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_workspace_user_idx" ON "memories" ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_workspace_session_idx" ON "memories" ("workspace_id","session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_workspace_agent_idx" ON "memories" ("workspace_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_cache_workspace_scope_idx" ON "recall_cache" ("workspace_id","scope_key");
