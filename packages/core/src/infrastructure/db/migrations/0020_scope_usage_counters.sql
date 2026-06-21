CREATE TABLE "scope_usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'default' NOT NULL,
	"user_id" text,
	"session_id" text,
	"agent_id" text,
	"recall_count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scope_usage_counters_scope_uq" ON "scope_usage_counters" USING btree ("workspace_id",COALESCE("user_id", ''),COALESCE("session_id", ''),COALESCE("agent_id", ''));