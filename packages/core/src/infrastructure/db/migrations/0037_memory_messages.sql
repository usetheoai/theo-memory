-- Immutable log of the raw messages each write received, and which memories they produced (ADR-0027).
CREATE TABLE IF NOT EXISTS memory_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  user_id text,
  session_id text,
  agent_id text,
  role text NOT NULL CONSTRAINT memory_messages_role_check CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  observed_at timestamptz,
  logged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_messages_scope_seq_idx
  ON memory_messages (workspace_id, user_id, session_id, agent_id, seq);
CREATE TABLE IF NOT EXISTS memory_message_sources (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES memory_messages(message_id) ON DELETE CASCADE,
  CONSTRAINT memory_message_sources_pkey PRIMARY KEY (workspace_id, memory_id, message_id)
);
CREATE INDEX IF NOT EXISTS memory_message_sources_message_idx
  ON memory_message_sources (workspace_id, message_id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['memory_messages','memory_message_sources'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_workspace_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (workspace_id = current_setting(''app.workspace_id'', true)) WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true))', t || '_workspace_isolation', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_app') THEN
      -- Append and erase only: the log is immutable, so the application role gets no UPDATE.
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I TO themory_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_worker_cross_workspace') THEN
        EXECUTE format('CREATE POLICY %I ON %I TO themory_worker USING (true) WITH CHECK (true)', t || '_worker_cross_workspace', t);
      END IF;
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I TO themory_worker', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_app') THEN
    GRANT USAGE ON SEQUENCE memory_messages_seq_seq TO themory_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') THEN
    GRANT USAGE ON SEQUENCE memory_messages_seq_seq TO themory_worker;
  END IF;
END $$;
--> statement-breakpoint
-- Physically deleting a memory erases the messages that produced it, in the same transaction,
-- whatever the delete path (hard forget, expiry purge, scope erasure). Soft forget does not delete.
CREATE OR REPLACE FUNCTION erase_memory_source_messages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM memory_messages m
   USING memory_message_sources s
   WHERE s.workspace_id = OLD.workspace_id AND s.memory_id = OLD.id
     AND m.message_id = s.message_id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS memories_erase_source_messages ON memories;
CREATE TRIGGER memories_erase_source_messages BEFORE DELETE ON memories
  FOR EACH ROW EXECUTE FUNCTION erase_memory_source_messages();
