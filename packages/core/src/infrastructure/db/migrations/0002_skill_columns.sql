ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "code" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "code_language" varchar(20);--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT IF EXISTS "memories_superseded_by_memories_id_fk";--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_superseded_by_memories_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT IF EXISTS "memories_kind_derived_from_check";--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_kind_derived_from_check" CHECK (("memories"."kind" = 'extracted' AND "memories"."derived_from" IS NULL)
       OR ("memories"."kind" = 'derived' AND jsonb_array_length("memories"."derived_from") >= 1)
       OR ("memories"."kind" = 'skill' AND ("memories"."derived_from" IS NULL OR jsonb_array_length("memories"."derived_from") >= 1)));
