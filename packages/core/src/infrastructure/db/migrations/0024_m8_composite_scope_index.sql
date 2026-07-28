-- M8 T3.1 — composite scope index backing the (workspace_id, user_id[, session_id])
-- isolation filter. Pre-M8 only single-column indexes existed (0000_crazy_mimic.sql
-- memories_user_id_idx/session_id_idx/agent_id_idx), so the per-read composite filter
-- was a partial-index-or-scan. This applies the partition-key-in-every-index
-- discipline to the (workspace, user, session) key.
-- Partial on `t_invalid IS NULL` — live rows only, matching the recall/list default.
CREATE INDEX IF NOT EXISTS "memories_ws_user_session_idx" ON "memories" USING btree ("workspace_id","user_id","session_id") WHERE "t_invalid" IS NULL;
