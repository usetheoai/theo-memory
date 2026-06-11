ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "last_accessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "access_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "half_life_seconds" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score" ON "memories" USING btree ("agent_id","last_accessed_at") WHERE "t_invalid" IS NULL;
