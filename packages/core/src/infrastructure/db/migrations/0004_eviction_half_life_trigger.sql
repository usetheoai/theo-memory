-- v0.4b T2.2 / EC-1: when llm_importance_score is UPDATEd to a different
-- value, reset half_life_seconds = NULL so the next TriadicScoringPolicy.score()
-- call re-backfills via the D14 formula. Enforced at the data layer so raw
-- SQL UPDATE paths (e.g., /reflect re-extraction) cannot bypass the invariant.
--
-- ============================================================================
-- READ COMMITTED race-window discussion (v0.4b-fixes T9.1 / F-dom-pg-4 doc)
-- ============================================================================
-- PostgreSQL's default isolation level is READ COMMITTED. The BEFORE UPDATE OF
-- trigger executes within the UPDATE statement's snapshot. Three race-window
-- scenarios to be aware of:
--
-- 1. Concurrent reads on the OLD value: a SELECT running in another tx that
--    started BEFORE the UPDATE committed will see the OLD llm_importance_score
--    AND the OLD half_life_seconds (no reset visible) until the writer
--    commits. This is the standard MVCC behavior — readers never observe
--    half-updated rows.
--
-- 2. Concurrent UPDATEs on the same row: PG serializes via row-level locks
--    acquired at UPDATE time. The second UPDATE blocks until the first
--    commits, then re-reads the row and the trigger fires AGAIN on the
--    second writer's NEW vs (now-updated) OLD comparison. So if two writers
--    set the same llm_importance_score back-to-back, the second's trigger
--    no-ops (OLD == NEW post-commit-1). Correct behavior.
--
-- 3. Read-modify-write on half_life_seconds: a tx that reads half_life_seconds
--    and writes back to it without re-reading risks staleness. The trigger
--    does NOT lock half_life_seconds — it only fires on llm_importance_score
--    updates. Callers that compute half_life_seconds externally MUST use the
--    persister's WHERE half_life_seconds IS NULL guard (PgHalfLifePersister).
--
-- The race window is BOUNDED by the BEFORE-UPDATE-OF semantics + READ
-- COMMITTED snapshot semantics — eventual consistency is guaranteed within
-- the transaction commit horizon. See
-- tests/integration/eviction/trigger-race-window.test.ts for the
-- eventual-consistency invariant test (v0.4b-fixes T9.2 / EC-11 absorption:
-- vitest lacks reliable worker_threads orchestration for race-trigger
-- reproduction; test exercises eventual consistency via Promise.all UPDATE +
-- SELECT then re-SELECT).
--
CREATE OR REPLACE FUNCTION memories_reset_half_life_on_importance_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.llm_importance_score IS DISTINCT FROM OLD.llm_importance_score THEN
    NEW.half_life_seconds := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER memories_reset_half_life_on_importance_update_trg
BEFORE UPDATE OF llm_importance_score ON "memories"
FOR EACH ROW
EXECUTE FUNCTION memories_reset_half_life_on_importance_update();
