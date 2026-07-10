ALTER TABLE "entity_edges" ADD COLUMN "t_valid" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_edges" ADD COLUMN "t_invalid" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "entity_edges_active_idx" ON "entity_edges" USING btree ("source_entity_id") WHERE "entity_edges"."t_invalid" IS NULL;