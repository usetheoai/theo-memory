-- explainable-recall T1.1 — accountable-forgetting recall trace (Slice 1).
-- Hand-authored (NOT drizzle-kit generated): `drizzle-kit generate` is broken
-- project-wide by a PRE-EXISTING bug (verified 2026-07-20) — an unclosed JSDoc
-- `/**` at schema.ts:155 swallows the `category: text('category')` column def
-- (:159), so the `memories_category_idx` index (:223) references a column that
-- does not exist, crashing drizzle-kit ("Cannot read properties of undefined
-- (reading 'name')") and tsc. See explainable-recall-followups.md. The runner
-- applies migrations by journal (`migrate()`), which needs only this .sql + the
-- _journal.json entry (no snapshot). Idempotent (IF NOT EXISTS) per the 0010
-- precedent so re-application is a no-op.
CREATE TABLE IF NOT EXISTS "recall_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recall_id" text NOT NULL,
	"workspace_id" text DEFAULT 'default' NOT NULL,
	"scope_key" text NOT NULL,
	"memory_id" text NOT NULL,
	"semantic" real NOT NULL,
	"bm25" real NOT NULL,
	"entity" real DEFAULT 0 NOT NULL,
	"composite" real,
	"threshold" real NOT NULL,
	"drop_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_traces_recall_id_idx" ON "recall_traces" USING btree ("recall_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_traces_ws_created_idx" ON "recall_traces" USING btree ("workspace_id","created_at");
