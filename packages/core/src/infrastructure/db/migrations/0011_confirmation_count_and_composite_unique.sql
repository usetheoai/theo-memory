-- Migration 0011: confirmation_count column + composite UNIQUE for scope-aware dedup
--
-- Closes 2 honest gaps surfaced by principles-alignment-hardening 2026-06-04 audit:
--
--  (1) Princípio 1 (CLAUDE.md § IMPORTANTE) — score contínuo de importância
--      requires a `confirmação` factor. ADR D1 adds an INTEGER column tracking
--      how many times the SAME hash was asserted within the SAME scope.
--      DEFAULT 1 means pre-cycle rows are treated as "1 confirmation" — EC-4
--      absorption: this is honest historical floor, NOT fabricated count.
--
--  (2) ADR D5 (EC-1 MUST-FIX absorption) — v0.1 schema's global UNIQUE on
--      `memories.hash` is a pre-existing cross-scope dedup bug: when alice
--      writes "I like coffee" and bob writes the same text, the global UNIQUE
--      silently rejects bob's INSERT, leaving the row with alice. Bob would
--      receive alice's memoryId — a cross-scope data leak via dedup that
--      violates the ADR-0002 three-scope contract. The composite UNIQUE on
--      `(hash, user_id, session_id, agent_id)` (with COALESCE() to handle
--      NULL scope columns as the empty string for uniqueness purposes) makes
--      dedup scope-scoped: same fact text from different scopes produces
--      independent rows.
--
-- Backward-compat: pre-cycle rows keep their existing ids; the v0.1 UNIQUE
-- made cross-scope collisions impossible, so any pre-cycle DB has at most
-- 1 row per hash — the composite index installs cleanly.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + DROP INDEX IF EXISTS + CREATE INDEX
-- IF NOT EXISTS — re-running the migration against an already-migrated DB
-- is a no-op at the SQL layer.
--
-- @see CLAUDE.md § IMPORTANTE — Princípio 1 (confirmação)

-- (a) ADD COLUMN confirmation_count — Princípio 1 confirmação factor
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "confirmation_count" INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint

-- (b) DROP v0.1 global UNIQUE (the cross-scope leak bug per ADR D5 / EC-1)
DROP INDEX IF EXISTS "memories_hash_unique_idx";
--> statement-breakpoint

-- (c) CREATE composite UNIQUE — scope-aware dedup per ADR D5.
-- COALESCE() converts NULL scope columns to empty string so the UNIQUE constraint
-- treats (hash, NULL, NULL, NULL) and (hash, NULL, NULL, NULL) as duplicates
-- (correct: both are "no-scope" writes of the same text).
CREATE UNIQUE INDEX IF NOT EXISTS "memories_hash_scope_unique_idx"
  ON "memories" ("hash", COALESCE("user_id", ''), COALESCE("session_id", ''), COALESCE("agent_id", ''));
