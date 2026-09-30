-- The application role may read the bootstrap flag and consume it — nothing more.
--
-- 0032 left `admin_config` out of `themory_app` on purpose, calling it an operator
-- surface. The bootstrap flow contradicts that: `POST /v1/admin/keys` with
-- THEMORY_ADMIN_BOOTSTRAP_TOKEN runs on the request pool, reads
-- `admin_config.bootstrap_consumed` to decide whether the token is still valid, and
-- flips it in the same transaction that inserts the first admin key. Under the
-- application role both statements failed with `permission denied for table
-- admin_config` (SQLSTATE 42501), so the first key of a deployment could not be
-- minted at all (#227). The suite never saw it because it minted as the owner.
--
-- The grant is the least that flow needs: SELECT on the single-row table (which
-- holds only the flag and its timestamp), and UPDATE limited to those two columns.
-- No INSERT, no DELETE, no UPDATE of `id`, no DDL. `admin_config` carries no row
-- level security, so no policy is loosened by this.
--
-- Like 0030 and 0032, the role is provisioned by the operator; this only grants,
-- and only when the role exists.
--
-- @see 0013_admin_config.sql — the table
-- @see 0032_app_role_grants.sql — the grants this completes
-- @see packages/api/src/server/auth/bootstrap-token.ts — the two statements

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_app') THEN
        RAISE NOTICE 'themory_app absent: no admin_config grant issued.';
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'admin_config'
    ) THEN
        RETURN;
    END IF;

    EXECUTE 'GRANT SELECT ON public.admin_config TO themory_app';
    EXECUTE 'GRANT UPDATE (bootstrap_consumed, consumed_at) ON public.admin_config TO themory_app';
END $$;
