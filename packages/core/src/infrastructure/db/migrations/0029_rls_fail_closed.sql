-- Tenant isolation enforced by the database.
--
-- BEFORE THIS MIGRATION there was no database-level barrier between workspaces
-- at all: no policies, no row security, no session context. Isolation rested
-- entirely on the `workspace_id = $n` predicate written by hand in each of 43
-- statements across 27 files. A single omission returned another workspace's
-- memories with no error, no log line and no failing test.
--
-- The same shape of defect was measured in the engine on 2026-08-14, where the
-- policies did exist but were inert. Here they did not exist.
--
-- WHAT THIS ESTABLISHES
--   * every workspace-scoped table gets ENABLE + FORCE ROW LEVEL SECURITY
--   * one fail-closed policy per table, reading `app.workspace_id`
--   * no permissive disjunct: an unset context matches NOTHING, rather than
--     everything. Zero rows is a visible bug; every tenant's rows is a breach.
--
-- HOW THE CONTEXT ARRIVES. `tenantScopedPool` sets `app.workspace_id` on every
-- connection it hands out, from the request-bound scope in workspace-scope.ts.
-- Data-access code did not change.
--
-- FORCE is on and the owner gets NO maintenance policy — unlike the engine,
-- where migrations and the request path use separate roles. This package runs
-- everything through one role, so exempting the owner would exempt the whole
-- application. DDL is unaffected by RLS, so migrations keep working.
--
-- Genuinely workspace-spanning work (platform maintenance, cross-workspace
-- analytics) requires a dedicated `themory_worker` role: the maintenance
-- policies below are granted only to it, and only if it exists. Without that
-- role, such work must iterate workspace by workspace — which is the safer
-- default and the reason this is opt-in rather than assumed.

DO $$
DECLARE
    t             text;
    has_worker    boolean;
    scoped_tables text[] := ARRAY[
        'workspace_users',
        'routing_policies',
        'routing_audit',
        'memories',
        'reflection_counters',
        'entities',
        'entity_edges',
        'history',
        'consolidation_history',
        'recall_cache',
        'scope_usage_counters',
        'recall_traces'
    ];
    -- DELIBERATELY ABSENT: the API-key table.
    --
    -- Credential resolution is what DISCOVERS the workspace: the lookup runs
    -- before any tenant context can exist, keyed by the hash of the presented
    -- secret. Scoping that table by workspace is circular — you would need the
    -- workspace to read the row that tells you the workspace — and the practical
    -- effect is that authentication fails closed for every request, including
    -- legitimate ones.
    --
    -- What protects it instead: the lookup is by secret hash (not enumerable),
    -- the row is never returned to a caller, and the admin listing routes filter
    -- by the Principal's workspace. That last one is a WHERE clause rather than
    -- a policy — the weaker guarantee this migration exists to replace — so it
    -- is registered as follow-up work: a dedicated auth role holding a
    -- SELECT-only cross-workspace policy would close it without the circularity.

    -- Derived from the catalog, not from the ORM schema: `users` and
    -- `admin_config` carry NO workspace_id and are deliberately absent.
    -- `users` is global by design — one person belongs to many workspaces
    -- through `workspace_users`, which IS scoped — so a workspace policy on it
    -- would be wrong, not merely redundant.
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') INTO has_worker;

    FOREACH t IN ARRAY scoped_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            RAISE NOTICE 'skipping %: table not present', t;
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_workspace_isolation', t);
        EXECUTE format($f$
            CREATE POLICY %I ON public.%I
              USING      (workspace_id = current_setting('app.workspace_id', true))
              WITH CHECK (workspace_id = current_setting('app.workspace_id', true))
        $f$, t || '_workspace_isolation', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_worker_cross_workspace', t);
        IF has_worker THEN
            EXECUTE format($f$
                CREATE POLICY %I ON public.%I
                  TO themory_worker
                  USING (true) WITH CHECK (true)
            $f$, t || '_worker_cross_workspace', t);
        END IF;
    END LOOP;
END $$;
--> statement-breakpoint

-- `workspaces` is the self-table: scoped by its own id.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'workspaces'
    ) THEN
        ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS workspaces_self_isolation ON public.workspaces;
        CREATE POLICY workspaces_self_isolation ON public.workspaces
          USING      (id = current_setting('app.workspace_id', true))
          WITH CHECK (id = current_setting('app.workspace_id', true));

        DROP POLICY IF EXISTS workspaces_worker_cross_workspace ON public.workspaces;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') THEN
            CREATE POLICY workspaces_worker_cross_workspace ON public.workspaces
              TO themory_worker
              USING (true) WITH CHECK (true);
        END IF;
    END IF;
END $$;
--> statement-breakpoint

-- `memory_entities` is a junction table with no workspace_id of its own. It is
-- scoped through the memory it links, and because `memories` is itself policed,
-- the EXISTS below inherits that filter rather than re-deriving it — one place
-- defines what a workspace can see, and this table follows it.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'memory_entities'
    ) THEN
        ALTER TABLE public.memory_entities ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.memory_entities FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS memory_entities_workspace_isolation ON public.memory_entities;
        CREATE POLICY memory_entities_workspace_isolation ON public.memory_entities
          USING (EXISTS (
            SELECT 1 FROM public.memories m WHERE m.id = memory_entities.memory_id
          ))
          WITH CHECK (EXISTS (
            SELECT 1 FROM public.memories m WHERE m.id = memory_entities.memory_id
          ));

        DROP POLICY IF EXISTS memory_entities_worker_cross_workspace ON public.memory_entities;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') THEN
            CREATE POLICY memory_entities_worker_cross_workspace ON public.memory_entities
              TO themory_worker
              USING (true) WITH CHECK (true);
        END IF;
    END IF;
END $$;
