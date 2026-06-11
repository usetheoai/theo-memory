DROP INDEX IF EXISTS "idx_memories_eviction_score";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_memories_eviction_score_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_memories_eviction_score_session";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score" ON "memories" USING btree ("agent_id") WHERE "t_invalid" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score_user" ON "memories" USING btree ("user_id") WHERE "t_invalid" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score_session" ON "memories" USING btree ("session_id") WHERE "t_invalid" IS NULL;
