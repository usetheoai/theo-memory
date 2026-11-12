-- Idempotent: scripts/apply-trigger-migrations.mjs re-applies trigger-bearing migrations on db:push.
CREATE TABLE IF NOT EXISTS memory_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES workspaces(id),
  requester_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  input jsonb,
  drafts jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  result_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(workspace_id,requester_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS memory_jobs_claim_idx ON memory_jobs(status,available_at,created_at);
ALTER TABLE memory_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_jobs_workspace_isolation ON memory_jobs;
CREATE POLICY memory_jobs_workspace_isolation ON memory_jobs
  USING(workspace_id=current_setting('app.workspace_id',true))
  WITH CHECK(workspace_id=current_setting('app.workspace_id',true));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='themory_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON memory_jobs TO themory_app;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='themory_worker') THEN
    DROP POLICY IF EXISTS memory_jobs_worker_cross_workspace ON memory_jobs;
    CREATE POLICY memory_jobs_worker_cross_workspace ON memory_jobs TO themory_worker USING(true) WITH CHECK(true);
    GRANT SELECT,INSERT,UPDATE,DELETE ON memory_jobs TO themory_worker;
  END IF;
END $$;

--> statement-breakpoint
-- Hard erasure must not leave reconstructable content in completed extraction jobs.
CREATE OR REPLACE FUNCTION redact_erased_memory_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE memory_jobs SET input=NULL,drafts=NULL
    WHERE workspace_id=OLD.workspace_id AND result_memory_ids @> jsonb_build_array(OLD.id::text);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS memories_redact_jobs ON memories;
CREATE TRIGGER memories_redact_jobs BEFORE DELETE ON memories
  FOR EACH ROW EXECUTE FUNCTION redact_erased_memory_jobs();
