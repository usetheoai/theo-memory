ALTER TABLE "memories" DROP CONSTRAINT "memories_kind_derived_from_check";--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_kind_derived_from_check" CHECK (("memories"."kind" = 'extracted' AND "memories"."derived_from" IS NULL)
       OR ("memories"."kind" = 'derived' AND "memories"."derived_from" IS NOT NULL AND jsonb_array_length("memories"."derived_from") >= 1)
       OR ("memories"."kind" = 'skill' AND ("memories"."derived_from" IS NULL OR jsonb_array_length("memories"."derived_from") >= 1)));