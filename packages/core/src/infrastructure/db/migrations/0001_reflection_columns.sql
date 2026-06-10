CREATE TABLE "reflection_counters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope_user_id" text,
	"scope_session_id" text,
	"scope_agent_id" text,
	"count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflection_counters_scope_not_all_null_check" CHECK (NOT ("reflection_counters"."scope_user_id" IS NULL AND "reflection_counters"."scope_session_id" IS NULL AND "reflection_counters"."scope_agent_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "kind" varchar(20) DEFAULT 'extracted' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "derived_from" jsonb;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "llm_importance_score" real;--> statement-breakpoint
CREATE UNIQUE INDEX "reflection_counters_scope_unique_idx" ON "reflection_counters" USING btree ("scope_user_id","scope_session_id","scope_agent_id");--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_kind_derived_from_check" CHECK (("memories"."kind" = 'extracted' AND "memories"."derived_from" IS NULL)
       OR ("memories"."kind" = 'derived' AND jsonb_array_length("memories"."derived_from") >= 1));