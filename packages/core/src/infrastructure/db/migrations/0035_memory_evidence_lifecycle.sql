-- Preserve historical versions while making active facts unique within their scope.
ALTER TABLE memories ADD COLUMN expires_at timestamptz;
ALTER TABLE memories ADD COLUMN distinct_source_count integer;
DROP INDEX memories_hash_scope_unique_idx;
CREATE UNIQUE INDEX memories_hash_scope_unique_idx ON memories
  (workspace_id, hash, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,''))
  WHERE t_invalid IS NULL;
--> statement-breakpoint
CREATE TABLE memory_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES workspaces(id),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  origin_source_id text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, memory_id, origin_source_id)
);
CREATE INDEX memory_evidence_page_idx ON memory_evidence(workspace_id, memory_id, created_at, evidence_id);
CREATE TABLE memory_write_receipts (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  scope_key text NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id, scope_key, request_key, memory_id)
);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['memory_evidence','memory_write_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING (workspace_id=current_setting(''app.workspace_id'',true)) WITH CHECK (workspace_id=current_setting(''app.workspace_id'',true))',t||'_workspace_isolation',t);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='themory_app') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO themory_app',t);
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='themory_worker') THEN
      EXECUTE format('CREATE POLICY %I ON %I TO themory_worker USING(true) WITH CHECK(true)',t||'_worker_cross_workspace',t);
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO themory_worker',t);
    END IF;
  END LOOP;
END $$;
