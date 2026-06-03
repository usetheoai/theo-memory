-- v1.1 fix-up: snapshot parity migration (closes F-dom-dbmig-1).
-- The index was already declared idempotently in 0008_attributed_to.sql; this
-- migration only updates the Drizzle snapshot so `drizzle-kit push` reproduces
-- the same end state from schema.ts. Both migrations use `IF NOT EXISTS`, so
-- replaying either against an already-migrated DB is a no-op.
CREATE INDEX IF NOT EXISTS "idx_memories_user_attributed_to" ON "memories" USING btree ("user_id","attributed_to") WHERE "memories"."attributed_to" IS NOT NULL;