-- Physically deleting a memory also erases what was derived from it, in the same transaction and
-- whatever the delete path (hard forget, expiry purge, scope erasure). A soft forget deletes
-- nothing, so it triggers none of this.
--
-- A reflection summary restates its sources: one that outlives a source keeps the erased content
-- recoverable. Each deleted summary fires this trigger again, so a summary of a summary goes too.
-- The free-text reason of a consolidation audit row can restate the memory as well; the row and
-- its ids stay as the record that a decision was made, and the reason is replaced. The trigger runs
-- after the delete: the foreign key of the audit row updates that same row, and a trigger that
-- ran before it would collide with it.
CREATE OR REPLACE FUNCTION erase_memory_derivatives() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM memories d
   WHERE d.kind = 'derived'
     AND d.workspace_id = OLD.workspace_id
     AND d.derived_from ? OLD.id::text;
  UPDATE consolidation_history h
     SET reason = '[erased]'
   WHERE h.reason <> '[erased]'
     AND (h.kept_memory_id = OLD.id
       OR h.rejected_memory_ids ? OLD.id::text
       OR h.original_episode_ids ? OLD.id::text);
  RETURN OLD;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS memories_erase_derivatives ON memories;
--> statement-breakpoint
CREATE TRIGGER memories_erase_derivatives AFTER DELETE ON memories
  FOR EACH ROW EXECUTE FUNCTION erase_memory_derivatives();
