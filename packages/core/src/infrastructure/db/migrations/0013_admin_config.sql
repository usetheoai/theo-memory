-- Migration 0013: admin_config single-row table for ADR D7 bootstrap
-- self-revoke (EC-3 absorption) per plan
-- `theo-memory-faang-auth-lifecycle` § T2.2.1.
--
-- Single-row invariant: PRIMARY KEY default 1 + CHECK (id = 1) means
-- the table can hold at most one row, and ON CONFLICT DO NOTHING during
-- INSERT seeds the row idempotently on first run.
--
-- `bootstrap_consumed` flips to TRUE atomically with the first admin-key
-- INSERT (T2.2.1 handler logic). Subsequent bootstrap-token uses are
-- rejected by the bootstrap-token layer with 401 BOOTSTRAP_CONSUMED —
-- closes the EC-3 silent-backdoor exploit.
--

CREATE TABLE IF NOT EXISTS "admin_config" (
	"id" integer DEFAULT 1 PRIMARY KEY NOT NULL,
	"bootstrap_consumed" boolean DEFAULT false NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "admin_config_single_row" CHECK (id = 1)
);
--> statement-breakpoint
INSERT INTO "admin_config" (id) VALUES (1) ON CONFLICT DO NOTHING;
