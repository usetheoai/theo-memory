-- Application records: exact IDs and acknowledged writes, independent of vector memory.
CREATE TABLE IF NOT EXISTS wishlist_items (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  user_id text NOT NULL,
  item_id text NOT NULL,
  item_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,user_id,item_id)
);
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlist_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wishlist_workspace_isolation ON wishlist_items;
CREATE POLICY wishlist_workspace_isolation ON wishlist_items
  USING(workspace_id=current_setting('app.workspace_id',true))
  WITH CHECK(workspace_id=current_setting('app.workspace_id',true));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='themory_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON wishlist_items TO themory_app;
  END IF;
END $$;
