-- v0.4b T2.2 / EC-1: when llm_importance_score is UPDATEd to a different
-- value, reset half_life_seconds = NULL so the next TriadicScoringPolicy.score()
-- call re-backfills via the D14 formula. Enforced at the data layer so raw
-- SQL UPDATE paths (e.g., /reflect re-extraction) cannot bypass the invariant.
--
-- @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T2.2
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
