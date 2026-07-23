-- M13 /review F-dom-db-4 — partial index on the entities.superseded_by FK column.
-- Serves the pointee anchor guard (`NOT EXISTS (SELECT 1 FROM entities o WHERE
-- o.superseded_by = e.id)`) on the hard-forget GC + retire hot paths, and the
-- ON DELETE enforcement scan — otherwise a seq scan per evaluation. Additive.
CREATE INDEX IF NOT EXISTS "entities_superseded_by_idx"
  ON "entities" USING btree ("superseded_by") WHERE "superseded_by" IS NOT NULL;
