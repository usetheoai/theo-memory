-- T1.1 / ADR D2 + EC-2 + EC-6 — v1.1 multi-peer attribution: first-class
-- promoted column.
--
-- Adds `attributed_to text NULL` to the memories table + a partial composite
-- index `(user_id, attributed_to) WHERE attributed_to IS NOT NULL` for
-- O(log N) filter queries via the T2.2 recall API.
--
-- EC-6 absorbed: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS make
-- the migration idempotent — re-running runMigrations(pool) is a no-op once
-- the schema has converged. The partial WHERE clause keeps storage cost
-- proportional to populated rows ( promoted-key precedent per blueprint
-- Q3; ~70% of pre-v1.1 LLM extractions DID emit attributed_to but the
-- pipeline discarded it at payload composition — see EC-1 honest no-backfill
-- in ADR D2 Consequences).
--
-- EC-1 absorbed: NO `UPDATE memories SET attributed_to = (payload->>'...')`
-- statement here. Pre-v1.1 pipeline (`src/core/extraction/pipeline.ts:285`
-- `buildPayload(text, hash, filters, metadata)`) did NOT propagate
-- `extracted[i].attributed_to` to the payload jsonb — the value was discarded
-- at the payload composition phase. Backfill from payload would be a no-op.
-- Historical rows carry `attributed_to=NULL` permanently; consumers treat as
-- "unknown attribution".
--
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "attributed_to" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memories_user_attributed_to"
 ON "memories" ("user_id", "attributed_to")
 WHERE "attributed_to" IS NOT NULL;
