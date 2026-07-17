-- Migration 0017: workspace members + roles (RBAC, Slice 2)
-- per plan `multi-tenant-rbac-and-slice1-completion` § T0.2 (ADR D1/D2/D3).
--
-- Non-destructive, idempotent recipe (mirrors 0016 + theo-rag 0004):
--   1. CREATE users + workspace_users (composite PK + role CHECK enum).
--   2. ADD COLUMN theo_api_keys.user_id (nullable — legacy keys have no member).
--   3. ADD the FKs (workspace_users -> workspaces/users cascade;
--      theo_api_keys.user_id -> users SET NULL) in duplicate-object-safe DO blocks.
--   4. SEED the 'default-owner' user + its 'default'-workspace owner membership
--      with ON CONFLICT DO NOTHING -- MUST precede the backfill so the FK target
--      exists. The 'default' workspace was seeded by 0016.
--   5. BACKFILL legacy keys' user_id -> 'default-owner' (every pre-0017 key
--      becomes the seeded owner so single-tenant deployments keep working).
--
-- No data is dropped. Re-running is a no-op at the SQL layer
-- (IF NOT EXISTS + DO duplicate_object guard + ON CONFLICT DO NOTHING).
-- Drizzle generated the baseline (CREATE TABLE + ADD COLUMN + FKs); this file
-- hand-edits idempotency guards + adds the seed + backfill (drizzle-kit cannot
-- model them). meta/0017_snapshot.json + the journal entry stay in parity.

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_users" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_users_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_users_role_check" CHECK ("workspace_users"."role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
ALTER TABLE "theo_api_keys" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "theo_api_keys" ADD CONSTRAINT "theo_api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
INSERT INTO "users" ("id", "email", "name") VALUES ('default-owner', 'owner@default.local', 'Default Owner') ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "workspace_users" ("workspace_id", "user_id", "role") VALUES ('default', 'default-owner', 'owner') ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "theo_api_keys" SET "user_id" = 'default-owner' WHERE "user_id" IS NULL;
