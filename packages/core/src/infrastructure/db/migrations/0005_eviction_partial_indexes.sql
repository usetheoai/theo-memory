CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score_user" ON "memories" USING btree ("user_id","last_accessed_at") WHERE "t_invalid" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score_session" ON "memories" USING btree ("session_id","last_accessed_at") WHERE "t_invalid" IS NULL;
