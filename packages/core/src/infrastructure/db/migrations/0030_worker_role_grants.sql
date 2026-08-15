-- Privileges for the cross-workspace role, so its policies mean something.
--
-- Migration 0029 grants `themory_worker` the `*_worker_cross_workspace`
-- policies. A policy is not a privilege: it decides which ROWS a role may see
-- once it is allowed to touch the table at all. Nothing in 0029 issued a single
-- GRANT, and this package's tables are owned by the application role — so a
-- freshly created `themory_worker` reaches the retention sweep and gets
-- `permission denied for table recall_traces`.
--
-- That failure is loud, which is why it is a bug and not an incident. But it
-- would strand the boot guard in a strange place: the guard would confirm the
-- reach exists (the policy is right there in pg_policies) and the first tick
-- would still fail. Reach and permission have to arrive together.
--
-- SCOPED TO THE SAME TABLE SET as 0029, deliberately. The worker exists for
-- workspace-spanning maintenance over tenant data; it has no business in
-- `users`, `admin_config` or the API-key table, and this migration leaves it
-- with no privilege on them. `theo_api_keys` in particular stays untouched.
--
-- Idempotent and conditional, like 0029: without the role, nothing happens.

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
        'recall_traces',
        'workspaces',
        'memory_entities'
    ];
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') INTO has_worker;
    IF NOT has_worker THEN
        RAISE NOTICE 'themory_worker absent: no grants issued (cross-workspace work stays opt-in)';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA public TO themory_worker';

    FOREACH t IN ARRAY scoped_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            CONTINUE;
        END IF;
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO themory_worker', t
        );
    END LOOP;
END $$;
